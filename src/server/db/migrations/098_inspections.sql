set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table inspection_serial_counters (
  company_id uuid primary key references companies(id) on delete restrict,
  prefix text not null default 'INS-' check (btrim(prefix) <> '' and char_length(prefix) <= 20),
  next_number bigint not null default 1 check (next_number > 0),
  digits integer not null default 6 check (digits between 3 and 12),
  updated_at timestamptz not null default now()
);

create table inspections (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete restrict,
  location_id uuid not null,
  asset_id uuid not null,
  inspection_number text not null,
  inspection_kind text not null check (inspection_kind in ('weekly_truck', 'weekly_trailer')),
  unit_type text not null check (unit_type in ('Truck', 'Trailer')),
  status text not null default 'requested' check (status in ('requested', 'assigned', 'in_progress', 'completed', 'cancelled')),
  result text check (result is null or result in ('passed', 'issues_found', 'out_of_service')),
  version bigint not null default 1 check (version > 0),
  template_version_id uuid not null,
  template_snapshot jsonb not null check (jsonb_typeof(template_snapshot) = 'object' and octet_length(template_snapshot::text) <= 262144),
  template_snapshot_sha256 char(64) not null check (template_snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  asset_snapshot jsonb not null check (jsonb_typeof(asset_snapshot) = 'object' and octet_length(asset_snapshot::text) <= 32768),
  requested_by_user_id uuid not null references user_profiles(id) on delete restrict,
  due_at timestamptz,
  office_instructions text not null default '' check (char_length(office_instructions) <= 4000),
  final_notes text not null default '' check (char_length(final_notes) <= 5000),
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  predecessor_inspection_id uuid,
  revision_reason text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inspections_location_fk foreign key (location_id, company_id) references locations(id, company_id) on delete restrict,
  constraint inspections_asset_fk foreign key (company_id, asset_id) references assets(company_id, id) on delete restrict,
  constraint inspections_template_fk foreign key (company_id, template_version_id) references template_versions(company_id, id) on delete restrict,
  constraint inspections_predecessor_fk foreign key (company_id, predecessor_inspection_id) references inspections(company_id, id) on delete restrict,
  constraint inspections_lifecycle_shape check (
    (status = 'completed' and completed_at is not null and result is not null and cancelled_at is null)
    or (status = 'cancelled' and cancelled_at is not null and completed_at is null and result is null)
    or (status not in ('completed', 'cancelled') and completed_at is null and cancelled_at is null and result is null)
  ),
  constraint inspections_revision_shape check (
    (predecessor_inspection_id is null and revision_reason = '')
    or (predecessor_inspection_id is not null and btrim(revision_reason) <> '')
  ),
  unique (company_id, id),
  unique (company_id, inspection_number)
);

create index inspections_scope_queue_idx on inspections(company_id, location_id, status, updated_at desc, id desc);
create index inspections_mechanic_history_idx on inspections(company_id, asset_id, completed_at desc, id desc) where status = 'completed';

create table inspection_assignments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  inspection_id uuid not null,
  mechanic_user_id uuid not null references user_profiles(id) on delete restrict,
  assignment_role text not null check (assignment_role in ('primary', 'support')),
  active boolean not null default true,
  assigned_by_user_id uuid not null references user_profiles(id) on delete restrict,
  assigned_at timestamptz not null default now(),
  released_at timestamptz,
  constraint inspection_assignment_inspection_fk foreign key (company_id, inspection_id) references inspections(company_id, id) on delete restrict,
  unique (company_id, inspection_id, mechanic_user_id, active)
);
create unique index inspection_one_primary_assignment_uidx on inspection_assignments(company_id, inspection_id) where active and assignment_role = 'primary';

create table inspection_assignment_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  inspection_id uuid not null,
  mechanic_user_id uuid,
  action text not null check (action in ('assigned', 'released', 'reassigned')),
  actor_id uuid not null references user_profiles(id) on delete restrict,
  details jsonb not null default '{}',
  created_at timestamptz not null default now(),
  constraint inspection_assignment_event_fk foreign key (company_id, inspection_id) references inspections(company_id, id) on delete restrict
);

create table inspection_responses (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  inspection_id uuid not null,
  item_key text not null check (btrim(item_key) <> '' and char_length(item_key) <= 160),
  response text not null check (response in ('pass', 'issue', 'na')),
  na_reason text not null default '' check (char_length(na_reason) <= 1000),
  updated_by_user_id uuid not null references user_profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inspection_response_inspection_fk foreign key (company_id, inspection_id) references inspections(company_id, id) on delete restrict,
  unique (company_id, inspection_id, item_key),
  unique (company_id, inspection_id, id)
);

create table inspection_findings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  inspection_id uuid not null,
  response_id uuid not null,
  severity text not null check (severity in ('attention', 'repair_required', 'out_of_service')),
  note text not null check (btrim(note) <> '' and char_length(note) <= 4000),
  disposition text not null check (disposition in ('new_workorder', 'linked_workorder', 'office_follow_up', 'no_workorder')),
  no_workorder_reason text not null default '' check (char_length(no_workorder_reason) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inspection_finding_inspection_fk foreign key (company_id, inspection_id) references inspections(company_id, id) on delete restrict,
  constraint inspection_finding_response_fk foreign key (company_id, inspection_id, response_id) references inspection_responses(company_id, inspection_id, id) on delete restrict,
  constraint inspection_finding_disposition_shape check (disposition <> 'no_workorder' or btrim(no_workorder_reason) <> ''),
  unique (company_id, inspection_id, response_id),
  unique (company_id, inspection_id, id)
);

create table inspection_workorder_links (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  inspection_id uuid not null,
  finding_id uuid not null,
  workorder_id uuid not null,
  linked_by_user_id uuid not null references user_profiles(id) on delete restrict,
  idempotency_key varchar(120) not null check (char_length(idempotency_key) between 8 and 120),
  request_sha256 char(64) not null check (request_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  constraint inspection_workorder_link_finding_fk foreign key (company_id, inspection_id, finding_id) references inspection_findings(company_id, inspection_id, id) on delete restrict,
  constraint inspection_workorder_link_workorder_fk foreign key (company_id, workorder_id) references operational_workorders(company_id, id) on delete restrict,
  unique (company_id, inspection_id, finding_id),
  unique (company_id, linked_by_user_id, idempotency_key)
);

create table inspection_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  inspection_id uuid not null,
  event_type text not null,
  from_status text,
  to_status text,
  actor_id uuid not null references user_profiles(id) on delete restrict,
  version bigint not null check (version > 0),
  details jsonb not null default '{}',
  created_at timestamptz not null default now(),
  constraint inspection_event_inspection_fk foreign key (company_id, inspection_id) references inspections(company_id, id) on delete restrict
);
create index inspection_events_timeline_idx on inspection_events(company_id, inspection_id, created_at, id);

create or replace function protect_inspection_evidence()
returns trigger language plpgsql as $$ begin
  if tg_op = 'DELETE' then raise exception 'Inspection evidence cannot be deleted.' using errcode = '55000'; end if;
  return new;
end; $$;
create trigger inspection_events_append_only before update or delete on inspection_events for each row execute function protect_inspection_evidence();
create trigger inspection_assignment_events_append_only before update or delete on inspection_assignment_events for each row execute function protect_inspection_evidence();
