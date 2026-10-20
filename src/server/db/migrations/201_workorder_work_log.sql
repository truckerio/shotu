set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table operational_workorders
  add column activity_status varchar(32) not null default 'ready',
  add column activity_version bigint not null default 1,
  add constraint operational_workorders_activity_status_check check (
    activity_status in ('ready', 'active', 'on_hold', 'waiting_parts', 'waiting_office')
  ),
  add constraint operational_workorders_activity_version_check check (activity_version > 0);

update operational_workorders
set activity_status = case when status = 'in_progress' then 'active' else 'ready' end;

create table workorder_activity_status_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  workorder_id uuid not null,
  from_status varchar(32) not null,
  to_status varchar(32) not null,
  version bigint not null check (version > 1),
  changed_by_user_id uuid not null references user_profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint workorder_activity_event_workorder_fk foreign key (company_id, workorder_id)
    references operational_workorders(company_id, id) on delete cascade,
  constraint workorder_activity_event_from_check check (
    from_status in ('ready', 'active', 'on_hold', 'waiting_parts', 'waiting_office')
  ),
  constraint workorder_activity_event_to_check check (
    to_status in ('ready', 'active', 'on_hold', 'waiting_parts', 'waiting_office')
  ),
  unique (workorder_id, version)
);

create table workorder_labor_entries (
  id uuid primary key,
  company_id uuid not null references companies(id) on delete cascade,
  workorder_id uuid not null,
  mechanic_user_id uuid not null references user_profiles(id) on delete restrict,
  minutes integer not null check (minutes >= 0 and minutes <= 1440),
  work_date date not null,
  note varchar(2000) not null default '',
  version bigint not null default 1 check (version > 0),
  created_by_user_id uuid not null references user_profiles(id) on delete restrict,
  request_hash char(64) not null check (request_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workorder_labor_entry_workorder_fk foreign key (company_id, workorder_id)
    references operational_workorders(company_id, id) on delete cascade,
  unique (company_id, workorder_id, id)
);

create table workorder_labor_entry_revisions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  workorder_id uuid not null,
  entry_id uuid not null,
  version bigint not null check (version > 0),
  minutes integer not null check (minutes >= 0 and minutes <= 1440),
  work_date date not null,
  note varchar(2000) not null default '',
  correction_reason varchar(1000) not null,
  changed_by_user_id uuid not null references user_profiles(id) on delete restrict,
  changed_at timestamptz not null default now(),
  constraint workorder_labor_revision_entry_fk foreign key (company_id, workorder_id, entry_id)
    references workorder_labor_entries(company_id, workorder_id, id) on delete cascade,
  unique (entry_id, version),
  constraint workorder_labor_revision_reason_check check (
    version = 1 or char_length(btrim(correction_reason)) between 1 and 1000
  )
);

create index workorder_labor_entries_workorder_idx
  on workorder_labor_entries(company_id, workorder_id, work_date, created_at, id);
create index workorder_labor_revisions_entry_idx
  on workorder_labor_entry_revisions(entry_id, version);
create index workorder_activity_events_workorder_idx
  on workorder_activity_status_events(company_id, workorder_id, version);

create function reject_workorder_work_log_history_mutation() returns trigger as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception 'Workorder work-log history is append-only.' using errcode = '55000';
end $$ language plpgsql;

create trigger workorder_activity_status_events_immutable
  before update or delete on workorder_activity_status_events
  for each row execute function reject_workorder_work_log_history_mutation();
create trigger workorder_labor_entry_revisions_immutable
  before update or delete on workorder_labor_entry_revisions
  for each row execute function reject_workorder_work_log_history_mutation();

comment on column operational_workorders.activity_status is
  'Shared operational state independent from lifecycle status. Opening a page never changes it.';
comment on table workorder_labor_entries is
  'Current flexible work-log labor entries. Minutes are canonical; legacy form_data laborHours is untouched.';
comment on table workorder_labor_entry_revisions is
  'Append-only initial and correction snapshots for each flexible labor entry.';
