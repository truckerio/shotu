create table workorder_drafts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete restrict,
  location_id uuid,
  created_by_user_id uuid not null references user_profiles(id) on delete restrict,
  type text not null default 'workorder',
  status text not null default 'active',
  version integer not null default 1,
  payload jsonb not null default '{}'::jsonb,
  submitted_workorder_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  submitted_at timestamptz,
  discarded_at timestamptz,
  constraint workorder_drafts_type_check
    check (type in ('workorder')),
  constraint workorder_drafts_status_check
    check (status in ('active', 'submitted', 'discarded')),
  constraint workorder_drafts_version_check
    check (version > 0),
  constraint workorder_drafts_payload_object_check
    check (jsonb_typeof(payload) = 'object'),
  constraint workorder_drafts_location_company_fk
    foreign key (company_id, location_id)
    references locations(company_id, id)
    on delete restrict,
  constraint workorder_drafts_submitted_workorder_company_fk
    foreign key (company_id, submitted_workorder_id)
    references operational_workorders(company_id, id)
    on delete restrict,
  constraint workorder_drafts_submission_state_check
    check (
      (status = 'submitted' and submitted_workorder_id is not null and submitted_at is not null and discarded_at is null)
      or
      (status = 'discarded' and submitted_workorder_id is null and submitted_at is null and discarded_at is not null)
      or
      (status = 'active' and submitted_workorder_id is null and submitted_at is null and discarded_at is null)
    )
);

create index workorder_drafts_owner_active_idx
  on workorder_drafts(created_by_user_id, updated_at desc)
  where status = 'active';

create index workorder_drafts_company_status_idx
  on workorder_drafts(company_id, status, updated_at desc);

comment on table workorder_drafts is
  'Server-owned autosave snapshots. Drafts never reserve or own workorder serials.';

comment on column workorder_drafts.version is
  'Optimistic concurrency token incremented by every successful mutation.';

