set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table labor_rate_versions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  location_id uuid,
  labor_product_id uuid not null,
  price_kind varchar(16) not null check (price_kind in ('internal_cost','selling_price')),
  version bigint not null check (version > 0),
  amount numeric(14,4) check (amount is null or amount >= 0),
  currency varchar(3) check (currency is null or currency ~ '^[A-Z]{3}$'),
  previous_version_id uuid,
  reason varchar(500) not null check (char_length(btrim(reason)) between 2 and 500),
  created_by uuid not null references user_profiles(id) on delete restrict,
  idempotency_key varchar(160) not null check (char_length(idempotency_key) between 8 and 160),
  request_hash char(64) not null check (request_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  constraint labor_rate_amount_currency check (
    (amount is null and currency is null) or (amount is not null and currency is not null)
  ),
  constraint labor_rate_product_fk foreign key (company_id,labor_product_id)
    references local_labor_products(company_id,id) on delete restrict,
  constraint labor_rate_location_fk foreign key (company_id,location_id)
    references locations(company_id,id) on delete restrict,
  constraint labor_rate_previous_fk foreign key (company_id,previous_version_id)
    references labor_rate_versions(company_id,id) on delete restrict,
  unique (company_id,id),
  unique (company_id,id,labor_product_id,price_kind),
  unique (company_id,created_by,idempotency_key)
);

create unique index labor_rate_company_version_unique
  on labor_rate_versions(company_id,labor_product_id,price_kind,version)
  where location_id is null;
create unique index labor_rate_location_version_unique
  on labor_rate_versions(company_id,location_id,labor_product_id,price_kind,version)
  where location_id is not null;
create index labor_rate_current_idx
  on labor_rate_versions(company_id,labor_product_id,price_kind,location_id,version desc);

create table workorder_labor_price_snapshots (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  workorder_id uuid not null,
  labor_product_id uuid not null,
  rate_version_id uuid not null,
  selection varchar(16) not null check (selection in ('internal_cost','selling_price')),
  hours numeric(8,2) not null check (hours > 0 and hours <= 9999),
  unit_price numeric(14,4) not null check (unit_price >= 0),
  total_price numeric(18,4) not null check (total_price >= 0),
  currency varchar(3) not null check (currency ~ '^[A-Z]{3}$'),
  created_by uuid not null references user_profiles(id) on delete restrict,
  reason varchar(500) not null check (char_length(btrim(reason)) between 2 and 500),
  idempotency_key varchar(160) not null check (char_length(idempotency_key) between 8 and 160),
  request_hash char(64) not null check (request_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  constraint labor_price_workorder_fk foreign key (company_id,workorder_id)
    references operational_workorders(company_id,id) on delete restrict,
  constraint labor_price_product_fk foreign key (company_id,labor_product_id)
    references local_labor_products(company_id,id) on delete restrict,
  constraint labor_price_rate_fk foreign key (company_id,rate_version_id,labor_product_id,selection)
    references labor_rate_versions(company_id,id,labor_product_id,price_kind) on delete restrict,
  unique (company_id,id),
  unique (company_id,created_by,idempotency_key)
);

create index workorder_labor_price_history
  on workorder_labor_price_snapshots(company_id,workorder_id,created_at desc,id desc);

comment on table labor_rate_versions is
  'Append-only locally configured hourly internal and selling rates. A current Unknown location rate masks the company default; Odoo references never overwrite these rates.';
comment on table workorder_labor_price_snapshots is
  'Immutable Office/Admin Workorder labor-price decision using the selected local rate version and recorded hours.';
