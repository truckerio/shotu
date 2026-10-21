set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Legacy definitions and completed snapshots remain byte-for-byte unchanged.
alter table template_assignments add column inspection_type text not null default 'weekly'
  check (inspection_type in ('weekly','annual','pre_trip','post_trip','custom'));
drop index template_assignments_company_default_uidx;
drop index template_assignments_location_override_uidx;
create unique index template_assignments_company_default_uidx
  on template_assignments(company_id,family_key,applicability_key,inspection_type) where location_id is null;
create unique index template_assignments_location_override_uidx
  on template_assignments(company_id,location_id,family_key,applicability_key,inspection_type) where location_id is not null;

alter table inspections drop constraint inspections_inspection_kind_check;
alter table inspections add constraint inspections_inspection_kind_check check
  (inspection_kind in ('weekly_truck','weekly_trailer','annual_truck','annual_trailer','pre_trip_truck','pre_trip_trailer','post_trip_truck','post_trip_trailer','custom_truck','custom_trailer'));

create or replace function enforce_published_template_assignment()
returns trigger language plpgsql as $$ declare target_state text; target_definition jsonb; target_family text; target_applicability text; begin
  select version.state,version.definition,definition.family_key,definition.applicability_key
    into target_state,target_definition,target_family,target_applicability
    from template_versions version join template_definitions definition on definition.company_id=version.company_id and definition.id=version.template_id
    where version.company_id=new.company_id and version.id=new.template_version_id for key share of version;
  if target_state is distinct from 'published' then raise exception 'Template assignments require a published version.' using errcode='23514'; end if;
  if new.family_key is distinct from target_family or new.applicability_key is distinct from target_applicability
    or (new.family_key='inspection' and new.inspection_type is distinct from coalesce(target_definition->>'inspectionType','weekly')) then
    raise exception 'Template assignment must match the definition family, unit and inspection types.' using errcode='23514';
  end if;
  return new;
end; $$;
drop trigger template_assignments_published_only on template_assignments;
create trigger template_assignments_published_only before insert or update of template_version_id,family_key,applicability_key,inspection_type on template_assignments
  for each row execute function enforce_published_template_assignment();
