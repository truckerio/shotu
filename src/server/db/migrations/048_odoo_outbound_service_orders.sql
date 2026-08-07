set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Labor is measured time, not a countable inventory unit. PostgreSQL numeric
-- scale remains two decimals for billing-facing labor preparation.
alter table units_of_measure drop constraint if exists units_of_measure_category_check;
alter table units_of_measure
  add constraint units_of_measure_category_check check (category in (
    'count', 'packaging', 'liquid_volume', 'mass', 'gas_volume', 'length', 'time'
  ));

insert into units_of_measure (
  code, label, symbol, category, decimal_scale, reference_code,
  conversion_factor, odoo_name, active, updated_at
) values ('hr', 'Hour', 'hr', 'time', 2, 'hr', 1, 'Hours', true, now())
on conflict (code) do update set
  label = excluded.label,
  symbol = excluded.symbol,
  category = excluded.category,
  decimal_scale = excluded.decimal_scale,
  reference_code = excluded.reference_code,
  conversion_factor = excluded.conversion_factor,
  odoo_name = excluded.odoo_name,
  active = true,
  updated_at = now();

-- Read-only provider discovery. suggested_asset_id is advisory only;
-- app_asset_id is populated exclusively by explicit Admin confirmation.
create table odoo_vehicles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  external_id text not null,
  display_name text not null default '',
  unit_number text not null default '',
  vin text not null default '',
  license_plate text not null default '',
  customer_external_id text not null default '',
  customer_display_name text not null default '',
  active boolean not null default true,
  app_asset_id uuid,
  suggested_asset_id uuid,
  suggestion_basis text not null default '',
  mapping_status text not null default 'unmatched'
    check (mapping_status in ('unmatched', 'suggested', 'mapped', 'ignored')),
  confirmed_by_user_id uuid references user_profiles(id) on delete restrict,
  confirmed_at timestamptz,
  provider_updated_at timestamptz,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint odoo_vehicles_external_nonempty_check check (btrim(external_id) <> ''),
  constraint odoo_vehicles_asset_company_fkey
    foreign key (company_id, app_asset_id)
    references assets(company_id, id)
    on delete restrict,
  constraint odoo_vehicles_suggested_asset_company_fkey
    foreign key (company_id, suggested_asset_id)
    references assets(company_id, id)
    on delete set null (suggested_asset_id),
  constraint odoo_vehicles_mapping_truth_check check (
    (mapping_status = 'mapped' and app_asset_id is not null and suggested_asset_id is null
      and confirmed_by_user_id is not null and confirmed_at is not null)
    or (mapping_status = 'suggested' and app_asset_id is null and suggested_asset_id is not null
      and btrim(suggestion_basis) <> '' and confirmed_by_user_id is null and confirmed_at is null)
    or (mapping_status in ('unmatched', 'ignored') and app_asset_id is null
      and suggested_asset_id is null and confirmed_by_user_id is null and confirmed_at is null)
  ),
  unique (company_id, external_id),
  unique (company_id, id)
);

create unique index odoo_vehicles_confirmed_asset_uidx
  on odoo_vehicles(company_id, app_asset_id)
  where mapping_status = 'mapped';
create index odoo_vehicles_review_idx
  on odoo_vehicles(company_id, mapping_status, active, display_name, external_id);
create index odoo_vehicles_identity_idx
  on odoo_vehicles(company_id, vin, license_plate, unit_number)
  where active;

create table odoo_warehouses (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  external_id text not null,
  display_name text not null default '',
  code text not null default '',
  stock_location_external_id text not null default '',
  active boolean not null default true,
  provider_updated_at timestamptz,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint odoo_warehouses_external_nonempty_check check (btrim(external_id) <> ''),
  unique (company_id, external_id),
  unique (company_id, id)
);

create index odoo_warehouses_company_active_idx
  on odoo_warehouses(company_id, active, display_name, external_id);

create table odoo_location_warehouse_mappings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  location_id uuid not null,
  warehouse_external_id text not null,
  confirmed_by_user_id uuid not null references user_profiles(id) on delete restrict,
  confirmed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint odoo_location_warehouse_location_company_fkey
    foreign key (company_id, location_id)
    references locations(company_id, id)
    on delete cascade,
  constraint odoo_location_warehouse_external_company_fkey
    foreign key (company_id, warehouse_external_id)
    references odoo_warehouses(company_id, external_id)
    on delete restrict,
  constraint odoo_location_warehouse_external_nonempty_check
    check (btrim(warehouse_external_id) <> ''),
  unique (company_id, location_id),
  unique (company_id, warehouse_external_id)
);

-- Service products are distinct from parts catalog rows. Persisting provider
-- UoM/category truth lets readiness revalidate PTR001 before every export.
create table odoo_service_products (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  external_id text not null,
  default_code text not null default '',
  display_name text not null default '',
  product_type text not null default 'service',
  uom_external_id text not null default '',
  uom_name text not null default '',
  uom_category_external_id text not null default '',
  uom_category_name text not null default '',
  active boolean not null default true,
  provider_updated_at timestamptz,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint odoo_service_products_external_nonempty_check check (btrim(external_id) <> ''),
  constraint odoo_service_products_type_check check (product_type = 'service'),
  constraint odoo_service_products_uom_nonempty_check check (btrim(uom_external_id) <> ''),
  unique (company_id, external_id),
  unique (company_id, id)
);

create index odoo_service_products_review_idx
  on odoo_service_products(company_id, active, default_code, display_name, external_id);

create table odoo_service_order_settings (
  company_id uuid primary key references companies(id) on delete cascade,
  integration_account_id uuid not null,
  labor_product_external_id text not null,
  labor_uom_external_id text not null,
  order_model text not null default 'sale.order',
  line_model text not null default 'sale.order.line',
  vehicle_field text not null default 'vehicle_id',
  service_flag_field text not null default 'is_service_order',
  warehouse_field text not null default 'warehouse_id',
  stable_marker_field text not null default 'client_order_ref',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint odoo_service_order_settings_account_company_fkey
    foreign key (company_id, integration_account_id)
    references integration_accounts(company_id, id)
    on delete cascade,
  constraint odoo_service_order_settings_labor_product_company_fkey
    foreign key (company_id, labor_product_external_id)
    references odoo_service_products(company_id, external_id)
    on delete restrict,
  constraint odoo_service_order_settings_nonempty_check check (
    btrim(labor_product_external_id) <> '' and btrim(labor_uom_external_id) <> ''
    and btrim(order_model) <> '' and btrim(line_model) <> ''
    and btrim(vehicle_field) <> '' and btrim(service_flag_field) <> ''
    and btrim(warehouse_field) <> '' and btrim(stable_marker_field) <> ''
  )
);

create table odoo_workorder_preparation (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  workorder_id uuid not null,
  labor_hours numeric not null,
  customer_external_id text not null default '',
  customer_display_name text not null default '',
  prepared_by_user_id uuid not null references user_profiles(id) on delete restrict,
  prepared_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint odoo_workorder_preparation_workorder_company_fkey
    foreign key (company_id, workorder_id)
    references operational_workorders(company_id, id)
    on delete cascade,
  constraint odoo_workorder_preparation_labor_check check (
    labor_hours > 0 and labor_hours <= 9999.99 and scale(labor_hours) <= 2
  ),
  unique (company_id, workorder_id),
  unique (company_id, id),
  unique (company_id, id, workorder_id)
);

create table odoo_outbound_orders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  workorder_id uuid not null,
  preparation_id uuid not null,
  integration_account_id uuid not null,
  stable_marker text not null,
  target_model text not null default 'sale.order',
  state text not null default 'prepared'
    check (state in ('prepared', 'creating', 'retryable_failure', 'exported', 'conflict')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  payload_hash text not null,
  payload_snapshot jsonb not null default '{}',
  external_id text,
  external_number text,
  last_error_code text,
  last_error_message text,
  create_started_at timestamptz,
  exported_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint odoo_outbound_orders_workorder_company_fkey
    foreign key (company_id, workorder_id)
    references operational_workorders(company_id, id)
    on delete restrict,
  constraint odoo_outbound_orders_preparation_company_fkey
    foreign key (company_id, preparation_id, workorder_id)
    references odoo_workorder_preparation(company_id, id, workorder_id)
    on delete restrict,
  constraint odoo_outbound_orders_account_company_fkey
    foreign key (company_id, integration_account_id)
    references integration_accounts(company_id, id)
    on delete restrict,
  constraint odoo_outbound_orders_marker_nonempty_check check (btrim(stable_marker) <> ''),
  constraint odoo_outbound_orders_model_nonempty_check check (btrim(target_model) <> ''),
  constraint odoo_outbound_orders_hash_check check (payload_hash ~ '^[0-9a-f]{64}$'),
  constraint odoo_outbound_orders_export_truth_check check (
    (state = 'exported' and external_id is not null and btrim(external_id) <> '' and exported_at is not null)
    or state <> 'exported'
  ),
  unique (company_id, workorder_id),
  unique (company_id, stable_marker),
  unique (company_id, id)
);

create unique index odoo_outbound_orders_external_uidx
  on odoo_outbound_orders(company_id, target_model, external_id)
  where external_id is not null and btrim(external_id) <> '';
create index odoo_outbound_orders_state_idx
  on odoo_outbound_orders(company_id, state, updated_at desc);

-- Immutable, sanitized attempt snapshots complement shared integration audit.
-- Credentials and complete provider responses must never be stored here.
create table odoo_outbound_order_attempts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  outbound_order_id uuid not null,
  attempt_no integer not null check (attempt_no > 0),
  request_hash text not null,
  request_snapshot jsonb not null default '{}',
  status text not null check (status in ('started', 'failed', 'recovered', 'created', 'conflict')),
  external_id text,
  external_number text,
  error_code text,
  error_message text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  constraint odoo_outbound_attempts_order_company_fkey
    foreign key (company_id, outbound_order_id)
    references odoo_outbound_orders(company_id, id)
    on delete cascade,
  constraint odoo_outbound_attempts_hash_check check (request_hash ~ '^[0-9a-f]{64}$'),
  constraint odoo_outbound_attempts_finished_check check (
    (status = 'started' and finished_at is null)
    or (status <> 'started' and finished_at is not null)
  ),
  unique (company_id, outbound_order_id, attempt_no)
);

create index odoo_outbound_attempts_order_idx
  on odoo_outbound_order_attempts(company_id, outbound_order_id, attempt_no desc);

comment on table odoo_vehicles is
  'Discovered Odoo fleet vehicles; app_asset_id is explicit confirmed mapping truth and suggestions remain non-authoritative.';
comment on table odoo_location_warehouse_mappings is
  'Explicit one-to-one application location to active Odoo warehouse mapping for outbound service orders.';
comment on table odoo_service_products is
  'Discovered Odoo service products with provider UoM metadata for readiness validation.';
comment on table odoo_workorder_preparation is
  'Office-provided labor hours and optional explicit Odoo customer override.';
comment on table odoo_outbound_orders is
  'One durable idempotent Odoo draft identity and immutable request snapshot per application workorder.';
comment on table odoo_outbound_order_attempts is
  'Sanitized append-only attempt snapshots supplementing shared integration audit events.';
