set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table inventory_receipts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  location_id uuid not null,
  invoice_run_id uuid not null,
  created_by uuid not null references user_profiles(id) on delete restrict,
  idempotency_key varchar(120) not null check (char_length(idempotency_key) between 8 and 120),
  provider varchar(32) not null default 'odoo' check (provider = 'odoo'),
  provider_marker varchar(100) not null check (char_length(provider_marker) between 8 and 100),
  provider_picking_external_id text,
  provider_picking_name text not null default '',
  status varchar(32) not null default 'pending' check (
    status in ('pending', 'processing', 'confirmed', 'reconciliation_required', 'void')
  ),
  error_code varchar(100),
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint inventory_receipts_location_company_fk
    foreign key (company_id, location_id) references locations(company_id, id) on delete restrict,
  constraint inventory_receipts_invoice_company_fk
    foreign key (company_id, invoice_run_id) references invoice_extraction_runs(company_id, id) on delete restrict,
  constraint inventory_receipts_confirmed_state check (
    (status = 'confirmed' and provider_picking_external_id is not null and confirmed_at is not null)
    or status <> 'confirmed'
  ),
  unique (company_id, invoice_run_id),
  unique (company_id, provider_marker),
  unique (company_id, id)
);

create index inventory_receipts_location_created_idx
  on inventory_receipts (company_id, location_id, created_at desc, id);

create table inventory_receipt_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  receipt_id uuid not null,
  line_index integer not null check (line_index >= 0),
  catalog_part_id uuid not null,
  product_external_id text not null,
  part_number varchar(200) not null check (char_length(part_number) between 1 and 200),
  description varchar(1000) not null default '',
  quantity integer not null check (quantity between 1 and 1000),
  uom_code varchar(32) not null,
  tracking_mode varchar(16) not null check (tracking_mode = 'serial'),
  created_at timestamptz not null default now(),
  constraint inventory_receipt_lines_receipt_company_fk
    foreign key (company_id, receipt_id) references inventory_receipts(company_id, id) on delete cascade,
  constraint inventory_receipt_lines_catalog_company_fk
    foreign key (company_id, catalog_part_id) references parts_catalog(company_id, id) on delete restrict,
  unique (company_id, receipt_id, line_index),
  unique (company_id, id)
);

create table inventory_serialized_units (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  location_id uuid not null,
  receipt_id uuid not null,
  receipt_line_id uuid not null,
  unit_ordinal integer not null check (unit_ordinal >= 1),
  serial_number varchar(100) not null check (char_length(serial_number) between 8 and 100),
  provider_lot_external_id text,
  status varchar(24) not null default 'pending' check (
    status in ('pending', 'in_stock', 'issued', 'installed', 'removed', 'returned', 'scrapped', 'void')
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_serialized_units_location_company_fk
    foreign key (company_id, location_id) references locations(company_id, id) on delete restrict,
  constraint inventory_serialized_units_receipt_company_fk
    foreign key (company_id, receipt_id) references inventory_receipts(company_id, id) on delete restrict,
  constraint inventory_serialized_units_line_company_fk
    foreign key (company_id, receipt_line_id) references inventory_receipt_lines(company_id, id) on delete restrict,
  unique (company_id, serial_number),
  unique (company_id, receipt_line_id, unit_ordinal),
  unique (company_id, id)
);

create unique index inventory_serialized_units_provider_lot_idx
  on inventory_serialized_units (company_id, provider_lot_external_id)
  where provider_lot_external_id is not null;
create index inventory_serialized_units_location_status_idx
  on inventory_serialized_units (company_id, location_id, status, updated_at desc, id);

create table inventory_unit_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  unit_id uuid not null,
  event_type varchar(40) not null check (
    event_type in ('receipt_staged', 'receipt_confirmed', 'reconciliation_required', 'void')
  ),
  actor_id uuid references user_profiles(id) on delete restrict,
  provider_reference text not null default '',
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint inventory_unit_events_unit_company_fk
    foreign key (company_id, unit_id) references inventory_serialized_units(company_id, id) on delete restrict
);

create index inventory_unit_events_unit_created_idx
  on inventory_unit_events (company_id, unit_id, created_at, id);

create table inventory_provider_commands (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  receipt_id uuid not null,
  action varchar(32) not null check (action = 'receive'),
  request_hash char(64) not null check (request_hash ~ '^[0-9a-f]{64}$'),
  picking_type_external_id integer not null check (picking_type_external_id > 0),
  source_location_external_id integer not null check (source_location_external_id > 0),
  destination_location_external_id integer not null check (destination_location_external_id > 0),
  status varchar(32) not null default 'pending' check (
    status in ('pending', 'processing', 'succeeded', 'reconciliation_required')
  ),
  attempts integer not null default 0 check (attempts >= 0),
  provider_response jsonb,
  last_error_code varchar(100),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint inventory_provider_commands_receipt_company_fk
    foreign key (company_id, receipt_id) references inventory_receipts(company_id, id) on delete cascade,
  unique (company_id, receipt_id, action)
);

comment on table inventory_receipts is
  'Application workflow projection for an Odoo-authoritative receipt. Confirmed means Odoo returned a done picking.';
comment on table inventory_serialized_units is
  'Exact physical identities mirrored from Odoo serial lots. Pending identities are never available stock.';
comment on table inventory_provider_commands is
  'Idempotent Odoo receipt command lifecycle. Reconciliation-required state prevents optimistic stock claims.';
