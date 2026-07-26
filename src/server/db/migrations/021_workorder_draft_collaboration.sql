alter table workorder_drafts
  add column if not exists owner_user_id uuid,
  add column if not exists last_edited_by_user_id uuid;

update workorder_drafts
   set owner_user_id = coalesce(owner_user_id, created_by_user_id),
       last_edited_by_user_id = coalesce(last_edited_by_user_id, created_by_user_id)
 where owner_user_id is null
    or last_edited_by_user_id is null;

alter table workorder_drafts
  alter column owner_user_id set not null,
  alter column last_edited_by_user_id set not null;

alter table workorder_drafts
  drop constraint if exists workorder_drafts_owner_user_fk,
  drop constraint if exists workorder_drafts_last_editor_user_fk,
  add constraint workorder_drafts_owner_user_fk
    foreign key (owner_user_id) references user_profiles(id) on delete restrict,
  add constraint workorder_drafts_last_editor_user_fk
    foreign key (last_edited_by_user_id) references user_profiles(id) on delete restrict;

create table if not exists workorder_draft_events (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references workorder_drafts(id) on delete cascade,
  company_id uuid not null references companies(id) on delete restrict,
  actor_user_id uuid references user_profiles(id) on delete set null,
  action text not null check (action in ('created', 'updated', 'taken_over', 'discarded', 'submitted')),
  version integer not null check (version > 0),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists workorder_drafts_collaboration_scope_idx
  on workorder_drafts(company_id, location_id, status, updated_at desc);

create index if not exists workorder_drafts_owner_active_idx
  on workorder_drafts(owner_user_id, updated_at desc)
  where status = 'active';

create index if not exists workorder_drafts_creator_active_idx
  on workorder_drafts(created_by_user_id, updated_at desc)
  where status = 'active';

create index if not exists workorder_draft_events_draft_idx
  on workorder_draft_events(draft_id, created_at desc);

create index if not exists workorder_draft_events_company_idx
  on workorder_draft_events(company_id, created_at desc);

comment on table workorder_draft_events is
  'Append-only audit history for collaborative workorder draft mutations.';

comment on column workorder_drafts.owner_user_id is
  'Current editor/owner. Defaults to the creator and changes only through atomic takeover.';

comment on column workorder_drafts.last_edited_by_user_id is
  'Last authenticated user to save or claim the draft.';
