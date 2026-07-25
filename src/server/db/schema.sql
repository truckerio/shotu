create extension if not exists pgcrypto;

-- Integration metadata: one row per external provider, plus append-only sync runs.
create table if not exists integration_accounts (
  id uuid primary key default gen_random_uuid(),
  provider text not null unique,
  status text not null default 'not_configured',
  token_env_key text not null default '',
  last_sync_cursor text,
  last_full_sync_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists integration_sync_runs (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  sync_type text not null,
  status text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  fetched_count integer not null default 0,
  changed_count integer not null default 0,
  error text
);

-- Samsara-backed and manually-created equipment. This table intentionally holds
-- trucks, trailers, and future equipment types because mechanics search all of
-- them from one Unit field.
do $$
begin
  if to_regclass('public.assets') is null and to_regclass('public.vehicles') is not null then
    alter table vehicles rename to assets;
  end if;
  if to_regclass('public.vehicles_provider_uid_idx') is not null and to_regclass('public.assets_provider_uid_idx') is null then
    alter index vehicles_provider_uid_idx rename to assets_provider_uid_idx;
  end if;
  if to_regclass('public.vehicles_unit_no_idx') is not null and to_regclass('public.assets_unit_no_idx') is null then
    alter index vehicles_unit_no_idx rename to assets_unit_no_idx;
  end if;
  if to_regclass('public.vehicles_vin_idx') is not null and to_regclass('public.assets_vin_idx') is null then
    alter index vehicles_vin_idx rename to assets_vin_idx;
  end if;
  if to_regclass('public.vehicles_license_plate_idx') is not null and to_regclass('public.assets_license_plate_idx') is null then
    alter index vehicles_license_plate_idx rename to assets_license_plate_idx;
  end if;
  if to_regclass('public.vehicles_synced_at_idx') is not null and to_regclass('public.assets_synced_at_idx') is null then
    alter index vehicles_synced_at_idx rename to assets_synced_at_idx;
  end if;
end $$;

create table if not exists assets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid,
  location_id uuid,
  provider text not null default 'manual',
  provider_vehicle_id text,
  unit_type text,
  owner_name text,
  name text,
  unit_no text,
  vin text,
  license_plate text,
  make text,
  model text,
  year integer,
  serial text,
  external_ids jsonb not null default '{}',
  raw_provider_data jsonb not null default '{}',
  last_odometer_meters numeric,
  last_odometer_miles numeric,
  last_location jsonb,
  last_seen_at timestamptz,
  synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists assets_provider_uid_idx
  on assets(provider, provider_vehicle_id)
  where provider_vehicle_id is not null;

create index if not exists assets_unit_no_idx on assets(unit_no);
create index if not exists assets_vin_idx on assets(vin);
create index if not exists assets_license_plate_idx on assets(license_plate);
create index if not exists assets_synced_at_idx on assets(synced_at desc);
create index if not exists integration_sync_runs_provider_started_idx on integration_sync_runs(provider, started_at desc);

alter table integration_accounts add column if not exists access_token text;
alter table integration_accounts add column if not exists refresh_token text;
alter table integration_accounts add column if not exists token_type text;
alter table integration_accounts add column if not exists scope text;
alter table integration_accounts add column if not exists expires_at timestamptz;
alter table integration_accounts add column if not exists oauth_state text;
alter table integration_accounts add column if not exists oauth_state_created_at timestamptz;
alter table assets add column if not exists unit_type text;
alter table assets add column if not exists owner_name text;

-- Operational workorder core. This bootstrap defines durable tables only;
-- demo users and locations belong in the explicit seed command.
create table if not exists app_users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text unique,
  phone text,
  role text not null check (role in ('mechanic', 'office', 'surveillance', 'admin')),
  location_id uuid,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists locations (
  id uuid primary key default gen_random_uuid(),
  company_id text not null default 'default',
  name text not null,
  type text not null default 'yard',
  address text,
  lat numeric,
  lng numeric,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists operational_workorders (
  id uuid primary key default gen_random_uuid(),
  company_id text not null default 'default',
  serial text not null unique,
  asset_id uuid references assets(id) on delete set null,
  location_id uuid references locations(id) on delete set null,
  created_by_user_id uuid references app_users(id) on delete set null,
  current_mechanic_id uuid references app_users(id) on delete set null,
  status text not null default 'open' check (status in (
    'open',
    'accepted',
    'in_progress',
    'waiting_office',
    'parts_requested',
    'mechanic_done',
    'closed',
    'odoo_entered',
    'cancelled'
  )),
  concern text not null default '',
  diagnosis text not null default '',
  work_performed text not null default '',
  office_notes text not null default '',
  form_data jsonb not null default '{}',
  accepted_at timestamptz,
  started_at timestamptz,
  mechanic_done_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists workorder_mechanic_assignments (
  id uuid primary key default gen_random_uuid(),
  workorder_id uuid not null references operational_workorders(id) on delete cascade,
  mechanic_user_id uuid not null references app_users(id) on delete restrict,
  assignment_role text not null default 'support' check (assignment_role in ('primary', 'support')),
  active boolean not null default true,
  assigned_by_user_id uuid references app_users(id) on delete set null,
  assigned_at timestamptz not null default now(),
  released_at timestamptz,
  reason text not null default ''
);

create table if not exists workorder_serial_counters (
  company_id text primary key,
  prefix text not null default 'WO-',
  next_number integer not null default 1,
  digits integer not null default 6,
  updated_at timestamptz not null default now()
);

create table if not exists workorder_status_events (
  id uuid primary key default gen_random_uuid(),
  workorder_id uuid not null references operational_workorders(id) on delete cascade,
  from_status text,
  to_status text not null,
  changed_by_user_id uuid references app_users(id) on delete set null,
  note text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists workorder_assignment_events (
  id uuid primary key default gen_random_uuid(),
  workorder_id uuid not null references operational_workorders(id) on delete cascade,
  from_mechanic_id uuid references app_users(id) on delete set null,
  to_mechanic_id uuid references app_users(id) on delete set null,
  action text not null check (action in ('accepted', 'released', 'reassigned', 'unassigned', 'taken_over')),
  reason text not null default '',
  changed_by_user_id uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists workorder_field_events (
  id uuid primary key default gen_random_uuid(),
  workorder_id uuid not null references operational_workorders(id) on delete cascade,
  field_key text not null,
  field_label text not null,
  old_value text not null default '',
  new_value text not null default '',
  changed_by_user_id uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists workorder_access_events (
  id uuid primary key default gen_random_uuid(),
  workorder_id uuid not null references operational_workorders(id) on delete cascade,
  user_id uuid references app_users(id) on delete set null,
  actor_role text not null,
  event_type text not null default 'opened' check (event_type in ('opened')),
  created_at timestamptz not null default now()
);

create table if not exists chat_messages (
  id uuid primary key default gen_random_uuid(),
  workorder_id uuid not null references operational_workorders(id) on delete cascade,
  sender_user_id uuid references app_users(id) on delete set null,
  sender_role text not null default 'system',
  message_type text not null default 'normal' check (message_type in ('normal', 'part_request', 'help_request', 'system')),
  body text not null,
  read_by jsonb not null default '{}',
  created_at timestamptz not null default now()
);

alter table chat_messages add column if not exists dedupe_key text;

create table if not exists chat_message_attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null unique references chat_messages(id) on delete cascade,
  workorder_id uuid not null references operational_workorders(id) on delete cascade,
  storage_key text not null unique,
  original_file_name text not null,
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif')),
  byte_size integer not null check (byte_size > 0 and byte_size <= 10485760),
  sha256 text not null,
  created_at timestamptz not null default now()
);

create table if not exists odoo_entry_status (
  id uuid primary key default gen_random_uuid(),
  workorder_id uuid not null unique references operational_workorders(id) on delete cascade,
  status text not null default 'not_entered' check (status in ('not_entered', 'entered', 'missing_info')),
  odoo_service_order_no text not null default '',
  entered_by_user_id uuid references app_users(id) on delete set null,
  entered_at timestamptz,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Structured parts workflow. Requests, sourcing, inventory, and usage are
-- separate so a part can be approved without assuming it must be purchased.
create table if not exists parts_catalog (
  id uuid primary key default gen_random_uuid(),
  company_id text not null default 'default',
  normalized_part_number text not null,
  part_number text not null,
  manufacturer text not null default '',
  description text not null default '',
  category text not null default '',
  repair_template text not null default '',
  aliases jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, normalized_part_number)
);

create table if not exists inventory_items (
  id uuid primary key default gen_random_uuid(),
  company_id text not null default 'default',
  location_id uuid references locations(id) on delete set null,
  catalog_part_id uuid references parts_catalog(id) on delete set null,
  normalized_part_number text not null,
  part_number text not null,
  manufacturer text not null default '',
  description text not null default '',
  quantity_on_hand integer not null default 0 check (quantity_on_hand >= 0),
  quantity_reserved integer not null default 0 check (quantity_reserved >= 0 and quantity_reserved <= quantity_on_hand),
  bin_location text not null default '',
  updated_at timestamptz not null default now()
);

create unique index if not exists inventory_items_company_location_part_idx
  on inventory_items(company_id, coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid), normalized_part_number);

create table if not exists workorder_part_requests (
  id uuid primary key default gen_random_uuid(),
  workorder_id uuid not null references operational_workorders(id) on delete cascade,
  requested_by_user_id uuid references app_users(id) on delete set null,
  catalog_part_id uuid references parts_catalog(id) on delete set null,
  raw_query text not null,
  part_number text not null default '',
  normalized_part_number text not null default '',
  manufacturer text not null default '',
  description text not null default '',
  category text not null default '',
  quantity integer not null default 1 check (quantity > 0 and quantity <= 999),
  repair_order text not null default '',
  approval_status text not null default 'submitted' check (approval_status in (
    'submitted', 'needs_info', 'approved', 'rejected', 'cancelled'
  )),
  fitment_status text not null default 'unknown' check (fitment_status in (
    'confirmed', 'possible', 'unknown', 'conflict'
  )),
  fitment_notes text not null default '',
  usage_status text not null default 'not_issued' check (usage_status in (
    'not_issued', 'issued', 'partially_installed', 'installed', 'not_used', 'returned', 'damaged'
  )),
  resume_workorder_status text,
  approved_by_user_id uuid references app_users(id) on delete set null,
  approved_at timestamptz,
  decision_reason text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table workorder_part_requests add column if not exists source_chat_message_id uuid references chat_messages(id) on delete set null;
alter table workorder_part_requests add column if not exists source_attachment_id uuid references chat_message_attachments(id) on delete set null;
alter table workorder_part_requests add column if not exists raw_context jsonb not null default '{}';

create table if not exists part_allocations (
  id uuid primary key default gen_random_uuid(),
  part_request_id uuid not null references workorder_part_requests(id) on delete cascade,
  source_type text not null default 'unknown' check (source_type in (
    'inventory', 'purchase', 'transfer', 'customer_supplied', 'mechanic_supplied', 'unknown'
  )),
  status text not null default 'proposed' check (status in (
    'proposed', 'reserved', 'issued', 'ordered', 'received', 'transferred', 'installed', 'returned', 'cancelled'
  )),
  quantity integer not null check (quantity > 0 and quantity <= 999),
  location_id uuid references locations(id) on delete set null,
  inventory_item_id uuid references inventory_items(id) on delete set null,
  vendor text not null default '',
  source_reference text not null default '',
  unit_price numeric(12, 2),
  quote_url text not null default '',
  created_by_user_id uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists part_request_events (
  id uuid primary key default gen_random_uuid(),
  workorder_id uuid not null references operational_workorders(id) on delete cascade,
  part_request_id uuid not null references workorder_part_requests(id) on delete cascade,
  event_type text not null,
  actor_user_id uuid references app_users(id) on delete set null,
  note text not null default '',
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists app_users_role_active_idx on app_users(role, active);
create index if not exists locations_company_active_idx on locations(company_id, active);
create index if not exists operational_workorders_status_updated_idx on operational_workorders(status, updated_at desc);
create index if not exists operational_workorders_current_mechanic_idx on operational_workorders(current_mechanic_id, updated_at desc);
create index if not exists operational_workorders_asset_idx on operational_workorders(asset_id);
create index if not exists workorder_mechanic_assignments_workorder_idx
  on workorder_mechanic_assignments(workorder_id, active, assigned_at);
create index if not exists workorder_mechanic_assignments_mechanic_idx
  on workorder_mechanic_assignments(mechanic_user_id, active, assigned_at desc);
create unique index if not exists workorder_mechanic_assignments_active_user_idx
  on workorder_mechanic_assignments(workorder_id, mechanic_user_id)
  where active = true;
create unique index if not exists workorder_mechanic_assignments_primary_idx
  on workorder_mechanic_assignments(workorder_id)
  where active = true and assignment_role = 'primary';
create index if not exists workorder_serial_counters_updated_idx on workorder_serial_counters(updated_at desc);
create index if not exists workorder_status_events_workorder_idx on workorder_status_events(workorder_id, created_at desc);
create index if not exists workorder_assignment_events_workorder_idx on workorder_assignment_events(workorder_id, created_at desc);
create index if not exists workorder_field_events_workorder_idx on workorder_field_events(workorder_id, created_at desc);
create index if not exists workorder_access_events_workorder_idx on workorder_access_events(workorder_id, created_at desc);
create index if not exists chat_messages_workorder_idx on chat_messages(workorder_id, created_at asc);
create unique index if not exists chat_messages_dedupe_idx
  on chat_messages(workorder_id, dedupe_key)
  where dedupe_key is not null;
create index if not exists chat_message_attachments_workorder_idx on chat_message_attachments(workorder_id, created_at asc);
create index if not exists odoo_entry_status_status_idx on odoo_entry_status(status, updated_at desc);
create index if not exists parts_catalog_company_part_idx on parts_catalog(company_id, normalized_part_number);
create index if not exists inventory_items_company_part_idx on inventory_items(company_id, normalized_part_number);
create index if not exists workorder_part_requests_workorder_idx on workorder_part_requests(workorder_id, created_at asc);
create index if not exists workorder_part_requests_approval_idx on workorder_part_requests(approval_status, updated_at desc);
create unique index if not exists workorder_part_requests_source_chat_idx
  on workorder_part_requests(source_chat_message_id)
  where source_chat_message_id is not null;
create index if not exists part_allocations_request_idx on part_allocations(part_request_id, created_at asc);
create index if not exists part_request_events_workorder_idx on part_request_events(workorder_id, created_at asc);
