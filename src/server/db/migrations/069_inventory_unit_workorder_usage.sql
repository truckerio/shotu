set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table workorder_serialized_part_usages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  workorder_id uuid not null,
  asset_id uuid not null,
  location_id uuid not null,
  unit_id uuid not null,
  catalog_part_id uuid not null,
  uom_code text not null references units_of_measure(code),
  status varchar(16) not null default 'issued' check (status in ('issued', 'installed', 'returned')),
  issued_by_user_id uuid not null references user_profiles(id) on delete restrict,
  issued_at timestamptz not null default now(),
  issue_idempotency_key varchar(120) not null check (char_length(issue_idempotency_key) between 8 and 120),
  issue_request_hash char(64) not null check (issue_request_hash ~ '^[0-9a-f]{64}$'),
  finalized_by_user_id uuid references user_profiles(id) on delete restrict,
  finalized_at timestamptz,
  finalize_idempotency_key varchar(120),
  finalize_request_hash char(64),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workorder_serialized_usage_workorder_company_fk
    foreign key (company_id, workorder_id) references operational_workorders(company_id, id) on delete restrict,
  constraint workorder_serialized_usage_asset_company_fk
    foreign key (company_id, asset_id) references assets(company_id, id) on delete restrict,
  constraint workorder_serialized_usage_location_company_fk
    foreign key (company_id, location_id) references locations(company_id, id) on delete restrict,
  constraint workorder_serialized_usage_unit_company_fk
    foreign key (company_id, unit_id) references inventory_serialized_units(company_id, id) on delete restrict,
  constraint workorder_serialized_usage_catalog_company_fk
    foreign key (company_id, catalog_part_id) references parts_catalog(company_id, id) on delete restrict,
  constraint workorder_serialized_usage_final_state check (
    (status = 'issued' and finalized_by_user_id is null and finalized_at is null
      and finalize_idempotency_key is null and finalize_request_hash is null)
    or
    (status in ('installed', 'returned') and finalized_by_user_id is not null and finalized_at is not null
      and finalize_idempotency_key is not null and char_length(finalize_idempotency_key) between 8 and 120
      and finalize_request_hash is not null and finalize_request_hash ~ '^[0-9a-f]{64}$')
  ),
  constraint workorder_serialized_usage_issue_idempotency_key
    unique (company_id, issued_by_user_id, issue_idempotency_key),
  unique (company_id, id)
);

create unique index workorder_serialized_usage_one_unresolved_unit_idx
  on workorder_serialized_part_usages (company_id, unit_id)
  where status = 'issued';
create unique index workorder_serialized_usage_finalize_key_idx
  on workorder_serialized_part_usages (company_id, finalized_by_user_id, finalize_idempotency_key)
  where finalize_idempotency_key is not null;
create index workorder_serialized_usage_workorder_history_idx
  on workorder_serialized_part_usages (company_id, workorder_id, issued_at desc, id);

alter table inventory_unit_events drop constraint inventory_unit_events_event_type_check;
alter table inventory_unit_events
  add constraint inventory_unit_events_event_type_check check (
    event_type in (
      'receipt_staged', 'receipt_confirmed', 'receipt_recorded',
      'reconciliation_required', 'issued', 'installed', 'returned', 'void'
    )
  ),
  add column usage_id uuid,
  add column workorder_id uuid,
  add column asset_id uuid,
  add constraint inventory_unit_events_usage_company_fk
    foreign key (company_id, usage_id) references workorder_serialized_part_usages(company_id, id) on delete restrict,
  add constraint inventory_unit_events_workorder_company_fk
    foreign key (company_id, workorder_id) references operational_workorders(company_id, id) on delete restrict,
  add constraint inventory_unit_events_asset_company_fk
    foreign key (company_id, asset_id) references assets(company_id, id) on delete restrict,
  add constraint inventory_unit_events_workorder_shape check (
    (event_type in ('issued', 'installed', 'returned') and usage_id is not null and workorder_id is not null and asset_id is not null)
    or
    (event_type not in ('issued', 'installed', 'returned') and usage_id is null and workorder_id is null and asset_id is null)
  );

alter table inventory_stock_movements
  add column unit_id uuid,
  add column usage_id uuid,
  add column workorder_id uuid,
  add column asset_id uuid,
  add constraint inventory_stock_movements_unit_company_fk
    foreign key (company_id, unit_id) references inventory_serialized_units(company_id, id) on delete restrict,
  add constraint inventory_stock_movements_usage_company_fk
    foreign key (company_id, usage_id) references workorder_serialized_part_usages(company_id, id) on delete restrict,
  add constraint inventory_stock_movements_workorder_company_fk
    foreign key (company_id, workorder_id) references operational_workorders(company_id, id) on delete restrict,
  add constraint inventory_stock_movements_asset_company_fk
    foreign key (company_id, asset_id) references assets(company_id, id) on delete restrict,
  add constraint inventory_stock_movements_serial_usage_shape check (
    (movement_type in ('issue', 'return') and unit_id is not null and usage_id is not null and workorder_id is not null and asset_id is not null)
    or movement_type not in ('issue', 'return')
  );

create unique index inventory_stock_movements_usage_action_idx
  on inventory_stock_movements (company_id, usage_id, movement_type)
  where usage_id is not null and movement_type in ('issue', 'return');

comment on table workorder_serialized_part_usages is
  'Exact local serialized-unit issue and final disposition for one workorder asset. Events and stock movements are append-only evidence.';
