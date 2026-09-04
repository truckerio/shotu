set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Explicit, location-scoped capability grants. Existing roles receive NO grants.
create table inventory_reuse_capability_grants (
  company_id uuid not null references companies(id),
  location_id uuid not null,
  user_id uuid not null references user_profiles(id),
  capability text not null check (capability in ('remove', 'receive', 'release')),
  granted_by_user_id uuid not null references user_profiles(id),
  created_at timestamptz not null default now(),
  primary key (company_id, location_id, user_id, capability),
  foreign key (company_id, location_id) references locations(company_id, id)
);
create table inventory_reuse_catalog_policies (
  company_id uuid not null references companies(id),
  location_id uuid not null,
  catalog_part_id uuid not null,
  reuse_allowed boolean not null default false,
  evidence text not null check (length(trim(evidence)) > 0),
  updated_by_user_id uuid not null references user_profiles(id),
  updated_at timestamptz not null default now(),
  primary key (company_id, location_id, catalog_part_id),
  foreign key (company_id, location_id) references locations(company_id, id),
  foreign key (company_id, catalog_part_id) references parts_catalog(company_id, id)
);
create table inventory_reuse_cases (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  location_id uuid not null,
  unit_id uuid not null,
  usage_id uuid not null,
  asset_id uuid not null,
  original_workorder_id uuid not null,
  removal_workorder_id uuid not null,
  installation_status text not null check (installation_status in ('installed','installed_pending_approval')),
  status text not null check (status in ('awaiting_handoff', 'received_pending_review', 'hold', 'released')),
  removed_by_user_id uuid not null references user_profiles(id),
  received_by_user_id uuid references user_profiles(id),
  released_by_user_id uuid references user_profiles(id),
  reason text not null check (length(trim(reason)) > 0),
  ownership text not null check (ownership in ('company', 'customer', 'unknown')),
  ownership_evidence text not null,
  receipt_evidence text,
  inspection_evidence text,
  review_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, usage_id),
  foreign key (company_id, location_id) references locations(company_id, id),
  foreign key (company_id, unit_id) references inventory_serialized_units(company_id, id),
  foreign key (company_id, usage_id) references workorder_serialized_part_usages(company_id, id),
  foreign key (company_id, asset_id) references assets(company_id, id),
  foreign key (company_id, original_workorder_id) references operational_workorders(company_id, id),
  foreign key (company_id, removal_workorder_id) references operational_workorders(company_id, id),
  check (installation_status = 'installed_pending_approval' or original_workorder_id <> removal_workorder_id),
  check (ownership <> 'company' or length(trim(ownership_evidence)) > 0),
  check (received_by_user_id is null or received_by_user_id <> removed_by_user_id),
  check (released_by_user_id is null or released_by_user_id <> removed_by_user_id),
  check (status = 'awaiting_handoff' or (received_by_user_id is not null and length(trim(receipt_evidence)) > 0)),
  check (status <> 'released' or (released_by_user_id is not null and ownership = 'company' and length(trim(inspection_evidence)) > 0))
);
create unique index inventory_reuse_one_open_case on inventory_reuse_cases(company_id, unit_id) where status <> 'released';
create index inventory_reuse_queue on inventory_reuse_cases(company_id, location_id, status, created_at, id);
alter table inventory_unit_events drop constraint inventory_unit_events_event_type_check;
alter table inventory_unit_events add constraint inventory_unit_events_event_type_check check (
  event_type in ('receipt_staged','receipt_confirmed','receipt_recorded','reconciliation_required','issued','reserved',
    'installed_pending_approval','installed','returned','removed_returned_to_stock','removed','void',
    'reuse_received','reuse_hold','reuse_released')
);
alter table inventory_unit_events drop constraint inventory_unit_events_workorder_shape;
alter table inventory_unit_events add constraint inventory_unit_events_workorder_shape check (
  (event_type in ('issued','reserved','installed_pending_approval','installed','returned','removed_returned_to_stock','removed','reuse_received','reuse_hold','reuse_released')
    and usage_id is not null and workorder_id is not null and asset_id is not null)
  or
  (event_type not in ('issued','reserved','installed_pending_approval','installed','returned','removed_returned_to_stock','removed','reuse_received','reuse_hold','reuse_released')
    and usage_id is null and workorder_id is null and asset_id is null)
);
create table inventory_reuse_operations (
  company_id uuid not null references companies(id),
  location_id uuid not null,
  actor_id uuid not null references user_profiles(id),
  idempotency_key varchar(120) not null check (length(idempotency_key) between 8 and 120),
  action text not null check (action in ('remove', 'receive', 'release')),
  request_hash char(64) not null,
  case_id uuid not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (company_id, actor_id, idempotency_key),
  foreign key (company_id, location_id) references locations(company_id, id),
  foreign key (company_id, case_id) references inventory_reuse_cases(company_id, id)
);
create table inventory_reuse_audit_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  location_id uuid not null,
  actor_id uuid not null references user_profiles(id),
  action text not null,
  case_id uuid,
  details jsonb not null,
  created_at timestamptz not null default now(),
  foreign key (company_id, location_id) references locations(company_id, id),
  foreign key (company_id, case_id) references inventory_reuse_cases(company_id, id)
);
-- Removed episodes are historical, not active placements. Legacy removed identities
-- stay status=removed and have NO case: this migration never releases legacy stock.
drop index workorder_serialized_usage_one_active_unit_idx;
create unique index workorder_serialized_usage_one_active_unit_idx
  on workorder_serialized_part_usages(company_id, unit_id)
  where status in ('issued', 'reserved', 'installed_pending_approval', 'installed');

comment on table inventory_reuse_cases is 'Same-location approved-install removal and physical handoff. Unknown ownership/policy stays unavailable; no legacy auto-release.';
