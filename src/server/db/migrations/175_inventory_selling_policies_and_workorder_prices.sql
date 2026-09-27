set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table inventory_part_selling_policy_versions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  location_id uuid,
  catalog_part_id uuid not null,
  version bigint not null check (version > 0),
  method varchar(24) not null check (method in ('fixed','markup_percent','markup_amount')),
  value numeric(14,4) not null check (value >= 0),
  currency varchar(3),
  previous_version_id uuid,
  reason varchar(500) not null check (char_length(btrim(reason)) between 2 and 500),
  created_by uuid not null references user_profiles(id) on delete restrict,
  idempotency_key varchar(120) not null check (char_length(idempotency_key) between 8 and 120),
  request_hash char(64) not null check (request_hash ~ '^[0-9a-f]{64}$'),
  effective_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint inventory_selling_policy_catalog_fk foreign key(company_id,catalog_part_id)
    references parts_catalog(company_id,id) on delete cascade,
  constraint inventory_selling_policy_location_fk foreign key(company_id,location_id)
    references locations(company_id,id) on delete restrict,
  constraint inventory_selling_policy_previous_fk foreign key(company_id,previous_version_id)
    references inventory_part_selling_policy_versions(company_id,id) on delete restrict,
  constraint inventory_selling_policy_currency_shape check (
    (method='markup_percent' and currency is null)
    or (method in ('fixed','markup_amount') and currency ~ '^[A-Z]{3}$')
  ),
  unique(company_id,id),
  unique(company_id,created_by,idempotency_key)
);

create unique index inventory_selling_policy_company_version_unique
  on inventory_part_selling_policy_versions(company_id,catalog_part_id,version)
  where location_id is null;
create unique index inventory_selling_policy_location_version_unique
  on inventory_part_selling_policy_versions(company_id,location_id,catalog_part_id,version)
  where location_id is not null;
create index inventory_selling_policy_current_idx
  on inventory_part_selling_policy_versions(company_id,catalog_part_id,location_id,version desc);

insert into inventory_part_selling_policy_versions(
  company_id,location_id,catalog_part_id,version,method,value,currency,reason,created_by,idempotency_key,request_hash,effective_at,created_at
)
select company_id,location_id,catalog_part_id,1,'fixed',amount,currency,
  'Migrated configured selling price',created_by,
  'selling-policy-migration-'||id::text,
  encode(digest('selling-policy-migration-'||id::text,'sha256'),'hex'),effective_at,created_at
from (
  select distinct on(company_id,catalog_part_id,location_id) *
  from inventory_part_price_versions
  where price_kind='selling' and amount is not null
  order by company_id,catalog_part_id,location_id,version desc
) selling;

create table workorder_part_price_snapshots (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  workorder_id uuid not null,
  serialized_usage_id uuid,
  aggregate_usage_id uuid,
  selection varchar(24) not null check(selection in ('batch_cost','selling_price')),
  unit_price numeric(14,4) not null check(unit_price >= 0),
  quantity numeric(18,3) not null check(quantity > 0),
  total_price numeric(18,4) not null check(total_price >= 0),
  currency varchar(3) not null check(currency ~ '^[A-Z]{3}$'),
  receipt_line_id uuid,
  selling_policy_version_id uuid,
  created_by uuid not null references user_profiles(id) on delete restrict,
  reason varchar(500) not null check(char_length(btrim(reason)) between 2 and 500),
  idempotency_key varchar(160) not null check(char_length(idempotency_key) between 8 and 160),
  request_hash char(64) not null check(request_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  constraint workorder_part_price_workorder_fk foreign key(company_id,workorder_id)
    references operational_workorders(company_id,id) on delete restrict,
  constraint workorder_part_price_serial_usage_fk foreign key(company_id,serialized_usage_id)
    references workorder_serialized_part_usages(company_id,id) on delete restrict,
  constraint workorder_part_price_aggregate_usage_fk foreign key(company_id,aggregate_usage_id)
    references workorder_aggregate_part_usages(company_id,id) on delete restrict,
  constraint workorder_part_price_receipt_line_fk foreign key(company_id,receipt_line_id)
    references inventory_receipt_lines(company_id,id) on delete restrict,
  constraint workorder_part_price_policy_fk foreign key(company_id,selling_policy_version_id)
    references inventory_part_selling_policy_versions(company_id,id) on delete restrict,
  constraint workorder_part_price_usage_shape check(
    (serialized_usage_id is not null and aggregate_usage_id is null)
    or (serialized_usage_id is null and aggregate_usage_id is not null)
  ),
  constraint workorder_part_price_source_shape check(
    (selection='batch_cost' and receipt_line_id is not null and selling_policy_version_id is null)
    or (selection='selling_price' and selling_policy_version_id is not null)
  ),
  unique(company_id,id)
);

create index workorder_part_price_serial_history
  on workorder_part_price_snapshots(company_id,serialized_usage_id)
  where serialized_usage_id is not null;
create index workorder_part_price_aggregate_history
  on workorder_part_price_snapshots(company_id,aggregate_usage_id)
  where aggregate_usage_id is not null;
create unique index workorder_part_price_command_unique
  on workorder_part_price_snapshots(company_id,created_by,idempotency_key);

comment on table inventory_part_selling_policy_versions is
  'Append-only selling rules. Batch cost remains on the receipt line and is never overwritten by a selling rule.';
comment on table workorder_part_price_snapshots is
  'Office/Admin-selected immutable price evidence for an exact inventory usage. Missing batch lineage is never replaced by latest or average cost.';
