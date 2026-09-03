set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$ begin
  if exists(select 1 from template_assignments assignment join template_versions version on version.company_id=assignment.company_id and version.id=assignment.template_version_id where version.state<>'published') then
    raise exception 'Migration 108 blocked: an active template assignment references a non-published version.';
  end if;
end $$;

create function enforce_published_template_assignment()
returns trigger language plpgsql as $$ declare target_state text; begin
  select state into target_state from template_versions where company_id=new.company_id and id=new.template_version_id for key share;
  if target_state is distinct from 'published' then raise exception 'Template assignments require a published version.' using errcode='23514'; end if;
  return new;
end; $$;
create trigger template_assignments_published_only before insert or update of template_version_id on template_assignments for each row execute function enforce_published_template_assignment();

create table template_archive_commands (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete restrict,
  template_version_id uuid not null,
  actor_id uuid not null references user_profiles(id) on delete restrict,
  idempotency_key varchar(120) not null check(char_length(idempotency_key) between 8 and 120),
  request_sha256 char(64) not null check(request_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique(company_id,id),
  unique(company_id,actor_id,idempotency_key),
  foreign key(company_id,template_version_id) references template_versions(company_id,id) on delete restrict
);

create table template_archive_command_replacements (
  id uuid primary key default gen_random_uuid(), company_id uuid not null,
  command_id uuid not null, assignment_id uuid not null,
  archived_version_id uuid not null, replacement_version_id uuid not null,
  assignment_version_before bigint not null check(assignment_version_before > 0),
  assignment_version_after bigint not null check(assignment_version_after = assignment_version_before + 1),
  created_at timestamptz not null default now(),
  unique(company_id,command_id,assignment_id),
  foreign key(company_id,command_id) references template_archive_commands(company_id,id) on delete restrict,
  foreign key(company_id,assignment_id) references template_assignments(company_id,id) on delete restrict,
  foreign key(company_id,archived_version_id) references template_versions(company_id,id) on delete restrict,
  foreign key(company_id,replacement_version_id) references template_versions(company_id,id) on delete restrict
);

create function protect_template_archive_evidence()
returns trigger language plpgsql as $$ begin
  raise exception 'Template archive evidence is immutable.' using errcode='55000';
end; $$;
create trigger template_archive_commands_append_only before update or delete on template_archive_commands for each row execute function protect_template_archive_evidence();
create trigger template_archive_replacements_append_only before update or delete on template_archive_command_replacements for each row execute function protect_template_archive_evidence();
create trigger template_audit_events_append_only before update or delete on template_audit_events for each row execute function protect_template_archive_evidence();
