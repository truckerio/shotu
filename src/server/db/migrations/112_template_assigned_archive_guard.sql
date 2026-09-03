set local lock_timeout = '5s';
set local statement_timeout = '60s';

create function prevent_assigned_template_archive()
returns trigger language plpgsql as $$ begin
  if old.state is distinct from 'archived' and new.state = 'archived'
     and exists(select 1 from template_assignments assignment where assignment.company_id=new.company_id and assignment.template_version_id=new.id) then
    raise exception 'Template version is still assigned. Replace every assignment before archiving.' using errcode='23514';
  end if;
  return new;
end; $$;

create trigger template_versions_assigned_archive_guard
  before update of state on template_versions
  for each row execute function prevent_assigned_template_archive();
