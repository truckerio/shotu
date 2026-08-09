delete from workorder_module_access_rules rule
where rule.subject_type = 'user'
  and not exists (
    select 1 from user_profiles user_profile
    where user_profile.id = rule.subject_id::uuid
  );

delete from workorder_module_policy_scopes scope
where scope.scope_type = 'location'
  and not exists (
    select 1 from locations location
    where location.id = scope.location_id
      and location.company_id = scope.company_id
  );

alter table workorder_module_access_rules
  add column if not exists role_key text,
  add column if not exists user_id uuid references user_profiles(id) on delete cascade;

update workorder_module_access_rules
set role_key = subject_id
where subject_type = 'role' and role_key is null;

update workorder_module_access_rules
set user_id = subject_id::uuid
where subject_type = 'user' and user_id is null;

alter table workorder_module_access_rules
  drop constraint if exists workorder_module_access_rule_normalized_subject;
alter table workorder_module_access_rules
  add constraint workorder_module_access_rule_normalized_subject check (
    (subject_type = 'role' and role_key is not null and user_id is null)
    or (subject_type = 'user' and role_key is null and user_id is not null)
  );

create unique index if not exists workorder_module_access_rule_role_unique
  on workorder_module_access_rules (scope_id, role_key, surface, module_key)
  where subject_type = 'role';
create unique index if not exists workorder_module_access_rule_user_unique
  on workorder_module_access_rules (scope_id, user_id, surface, module_key)
  where subject_type = 'user';

create unique index if not exists locations_id_company_unique on locations (id, company_id);

alter table workorder_module_policy_scopes
  drop constraint if exists workorder_module_policy_scope_location_company_fk;
alter table workorder_module_policy_scopes
  add constraint workorder_module_policy_scope_location_company_fk
  foreign key (location_id, company_id) references locations(id, company_id) on delete cascade;

