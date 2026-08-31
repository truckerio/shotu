set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table workorder_aggregate_part_usages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  workorder_id uuid not null,
  location_id uuid not null,
  catalog_part_id uuid not null,
  quantity numeric(18,3) not null check (quantity > 0),
  adjustment_total numeric(18,3) not null default 0,
  uom_code text not null references units_of_measure(code),
  status text not null default 'reserved'
    check (status in ('reserved','installed_pending_approval','consumed','released','reversed')),
  repair_order text not null default '',
  created_by_user_id uuid not null references user_profiles(id) on delete restrict,
  finalized_by_user_id uuid references user_profiles(id) on delete restrict,
  idempotency_key text not null,
  request_hash text not null,
  evidence_id uuid not null default gen_random_uuid(),
  reserved_at timestamptz not null default now(),
  pending_at timestamptz,
  consumed_at timestamptz,
  released_at timestamptz,
  reversed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workorder_aggregate_usage_workorder_company_fk
    foreign key (company_id, workorder_id) references operational_workorders(company_id, id) on delete restrict,
  constraint workorder_aggregate_usage_location_company_fk
    foreign key (company_id, location_id) references locations(company_id, id) on delete restrict,
  constraint workorder_aggregate_usage_catalog_company_fk
    foreign key (company_id, catalog_part_id) references parts_catalog(company_id, id) on delete restrict,
  constraint workorder_aggregate_usage_state_shape check (
    (status='reserved' and pending_at is null and consumed_at is null and released_at is null and reversed_at is null)
    or (status='installed_pending_approval' and pending_at is not null and consumed_at is null and released_at is null and reversed_at is null)
    or (status='consumed' and pending_at is not null and consumed_at is not null and released_at is null and reversed_at is null)
    or (status='released' and consumed_at is null and released_at is not null and reversed_at is null)
    or (status='reversed' and consumed_at is not null and reversed_at is not null)
  ),
  constraint workorder_aggregate_usage_effective_quantity_check
    check (quantity + adjustment_total >= 0)
);

create unique index workorder_aggregate_usage_idempotency_uidx
  on workorder_aggregate_part_usages (company_id, created_by_user_id, idempotency_key);
create unique index workorder_aggregate_usage_evidence_uidx
  on workorder_aggregate_part_usages (company_id, evidence_id);
create unique index workorder_aggregate_usage_company_id_uidx
  on workorder_aggregate_part_usages (company_id, id);
create index workorder_aggregate_usage_workorder_idx
  on workorder_aggregate_part_usages (company_id, workorder_id, status, created_at, id);

create table workorder_aggregate_part_usage_events (
  id uuid primary key default gen_random_uuid(),
  event_ordinal bigint generated always as identity,
  company_id uuid not null references companies(id) on delete cascade,
  usage_id uuid not null,
  event_type text not null check (event_type in ('reserved','installed_pending_approval','consumed','released','reversed','adjusted')),
  quantity_delta numeric(18,3) not null,
  actor_id uuid references user_profiles(id) on delete restrict,
  idempotency_key text,
  request_hash text,
  details jsonb not null default '{}',
  created_at timestamptz not null default now(),
  constraint workorder_aggregate_usage_event_usage_fk
    foreign key (company_id, usage_id) references workorder_aggregate_part_usages(company_id, id) on delete restrict
);

create unique index workorder_aggregate_usage_event_idempotency_uidx
  on workorder_aggregate_part_usage_events (company_id, actor_id, idempotency_key)
  where idempotency_key is not null;
create unique index workorder_aggregate_usage_event_ordinal_uidx
  on workorder_aggregate_part_usage_events (company_id, usage_id, event_ordinal);

alter table inventory_stock_movements
  add column aggregate_usage_id uuid,
  drop constraint inventory_stock_movements_serial_usage_shape,
  add constraint inventory_stock_movements_aggregate_usage_company_fk
    foreign key (company_id, aggregate_usage_id)
    references workorder_aggregate_part_usages(company_id, id) on delete restrict,
  add constraint inventory_stock_movements_usage_shape check (
    (movement_type in ('issue','return') and (
      (unit_id is not null and usage_id is not null and aggregate_usage_id is null
        and workorder_id is not null and asset_id is not null)
      or
      (unit_id is null and usage_id is null and aggregate_usage_id is not null
        and workorder_id is not null and asset_id is null)
    ))
    or movement_type not in ('issue','return')
  );

create index inventory_stock_movements_aggregate_usage_idx
  on inventory_stock_movements (company_id, aggregate_usage_id, created_at, id)
  where aggregate_usage_id is not null;

comment on table workorder_aggregate_part_usages is
  'Canonical aggregate measured-consumable reservation and approval lifecycle; never serialized and never sourced from freeform Parts JSON.';
comment on column workorder_aggregate_part_usages.evidence_id is
  'Stable evidence identity retained across append-only lifecycle events.';
