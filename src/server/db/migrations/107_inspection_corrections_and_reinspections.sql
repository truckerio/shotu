set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$ begin
  if exists(select 1 from inspections where predecessor_inspection_id is not null)
     or exists(select 1 from inspection_revision_commands) then
    raise exception 'Migration 107 blocked: legacy inspection revisions require explicit correction or reinspection classification.';
  end if;
end $$;

alter table inspections add column lineage_kind text;
alter table inspections add column source_observation_inspection_id uuid;
alter table inspections add column source_completion_event_id uuid;
alter table inspections add constraint inspections_lineage_kind_check
  check(lineage_kind is null or lineage_kind in ('correction','reinspection'));
alter table inspections add constraint inspections_source_observation_fk
  foreign key(company_id,source_observation_inspection_id) references inspections(company_id,id) on delete restrict;
alter table inspection_events add constraint inspection_events_company_id_id_key unique(company_id,id);
alter table inspections add constraint inspections_source_completion_event_fk
  foreign key(company_id,source_completion_event_id) references inspection_events(company_id,id) on delete restrict;
alter table inspections drop constraint inspections_revision_shape;
alter table inspections add constraint inspections_typed_lineage_shape check(
  (lineage_kind is null and predecessor_inspection_id is null and source_observation_inspection_id is null and source_completion_event_id is null and revision_reason='')
  or (lineage_kind in ('correction','reinspection') and predecessor_inspection_id is not null and source_observation_inspection_id is not null and source_completion_event_id is not null and btrim(revision_reason)<>'')
);

create table inspection_correction_commands(
  id uuid primary key default gen_random_uuid(), company_id uuid not null references companies(id) on delete restrict,
  predecessor_inspection_id uuid not null, correction_inspection_id uuid not null,
  actor_id uuid not null references user_profiles(id) on delete restrict,
  idempotency_key varchar(120) not null check(char_length(idempotency_key) between 8 and 120),
  request_sha256 char(64) not null check(request_sha256 ~ '^[0-9a-f]{64}$'), created_at timestamptz not null default now(),
  unique(company_id,actor_id,idempotency_key),
  foreign key(company_id,predecessor_inspection_id) references inspections(company_id,id) on delete restrict,
  foreign key(company_id,correction_inspection_id) references inspections(company_id,id) on delete restrict
);
create table inspection_reinspection_commands(
  id uuid primary key default gen_random_uuid(), company_id uuid not null references companies(id) on delete restrict,
  predecessor_inspection_id uuid not null, reinspection_id uuid not null,
  actor_id uuid not null references user_profiles(id) on delete restrict,
  idempotency_key varchar(120) not null check(char_length(idempotency_key) between 8 and 120),
  request_sha256 char(64) not null check(request_sha256 ~ '^[0-9a-f]{64}$'), created_at timestamptz not null default now(),
  unique(company_id,actor_id,idempotency_key),
  foreign key(company_id,predecessor_inspection_id) references inspections(company_id,id) on delete restrict,
  foreign key(company_id,reinspection_id) references inspections(company_id,id) on delete restrict
);
create trigger inspection_correction_commands_append_only before update or delete on inspection_correction_commands for each row execute function protect_inspection_follow_up_evidence();
create trigger inspection_reinspection_commands_append_only before update or delete on inspection_reinspection_commands for each row execute function protect_inspection_follow_up_evidence();

alter table inspection_print_archives drop constraint inspection_print_predecessor_fk;
alter table inspection_print_archives add constraint inspection_print_archives_company_id_id_key unique(company_id,id);
alter table inspection_print_archives add constraint inspection_print_predecessor_fk
  foreign key(company_id,predecessor_archive_id) references inspection_print_archives(company_id,id) on delete restrict;
