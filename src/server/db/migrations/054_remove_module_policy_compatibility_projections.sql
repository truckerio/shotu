-- Make normalized module policy scopes/rules the only durable source of truth.
-- Copy the last compatibility projection first so rolling V2 writes are retained.

update workorder_module_policy_scopes scope
set version = greatest(scope.version, policy.version),
    updated_by_user_id = coalesce(policy.updated_by_user_id, scope.updated_by_user_id),
    updated_at = greatest(scope.updated_at, policy.updated_at)
from company_workorder_module_policies policy
where scope.scope_type = 'company'
  and scope.company_id = policy.company_id;

update workorder_module_policy_scopes scope
set version = greatest(scope.version, policy.version),
    updated_by_user_id = coalesce(policy.updated_by_user_id, scope.updated_by_user_id),
    updated_at = greatest(scope.updated_at, policy.updated_at)
from location_workorder_policies policy
where scope.scope_type = 'location'
  and scope.location_id = policy.location_id
  and scope.company_id = policy.company_id;

delete from workorder_module_access_rules rule
using workorder_module_policy_scopes scope
where rule.scope_id = scope.id
  and (
    (scope.scope_type = 'company' and exists (
      select 1 from company_workorder_module_policies policy
      where policy.company_id = scope.company_id
    ))
    or
    (scope.scope_type = 'location' and exists (
      select 1 from location_workorder_policies policy
      where policy.location_id = scope.location_id
        and policy.company_id = scope.company_id
    ))
  );

with projected_rules as (
  select scope.id as scope_id,
         'role'::text as subject_type,
         role_entry.key as subject_id,
         surface_entry.key as surface,
         module_entry.key as module_key,
         module_entry.value #>> '{}' as projected_access
  from workorder_module_policy_scopes scope
  join company_workorder_module_policies policy
    on scope.scope_type = 'company' and policy.company_id = scope.company_id
  cross join lateral jsonb_each(policy.module_access) role_entry
  cross join lateral jsonb_each(role_entry.value) surface_entry
  cross join lateral jsonb_each(surface_entry.value) module_entry
  union all
  select scope.id, 'user', user_entry.key, surface_entry.key, module_entry.key,
         module_entry.value #>> '{}'
  from workorder_module_policy_scopes scope
  join company_workorder_module_policies policy
    on scope.scope_type = 'company' and policy.company_id = scope.company_id
  cross join lateral jsonb_each(policy.user_module_access) user_entry
  cross join lateral jsonb_each(user_entry.value) surface_entry
  cross join lateral jsonb_each(surface_entry.value) module_entry
  union all
  select scope.id, 'role', role_entry.key, surface_entry.key, module_entry.key,
         module_entry.value #>> '{}'
  from workorder_module_policy_scopes scope
  join location_workorder_policies policy
    on scope.scope_type = 'location'
   and policy.location_id = scope.location_id
   and policy.company_id = scope.company_id
  cross join lateral jsonb_each(policy.module_access) role_entry
  cross join lateral jsonb_each(role_entry.value) surface_entry
  cross join lateral jsonb_each(surface_entry.value) module_entry
  union all
  select scope.id, 'user', user_entry.key, surface_entry.key, module_entry.key,
         module_entry.value #>> '{}'
  from workorder_module_policy_scopes scope
  join location_workorder_policies policy
    on scope.scope_type = 'location'
   and policy.location_id = scope.location_id
   and policy.company_id = scope.company_id
  cross join lateral jsonb_each(policy.user_module_access) user_entry
  cross join lateral jsonb_each(user_entry.value) surface_entry
  cross join lateral jsonb_each(surface_entry.value) module_entry
)
insert into workorder_module_access_rules (
  scope_id, subject_type, subject_id, role_key, user_id,
  surface, module_key, access, required
)
select scope_id,
       subject_type,
       subject_id,
       case when subject_type = 'role' then subject_id else null end,
       case when subject_type = 'user' then subject_id::uuid else null end,
       surface,
       module_key,
       case when projected_access = 'required' then 'write' else projected_access end,
       projected_access = 'required'
from projected_rules
where projected_access in ('hidden', 'read', 'write', 'required')
  and (
    subject_type = 'role'
    or exists (
      select 1 from user_profiles user_profile
      where user_profile.id = subject_id::uuid
    )
  );

alter table location_workorder_policies
  drop column if exists module_access,
  drop column if exists user_module_access,
  drop column if exists version;

drop table if exists company_workorder_module_policies;

comment on table workorder_module_policy_scopes is
  'Canonical versioned company or location scope for workorder module policy.';
comment on table workorder_module_access_rules is
  'Canonical sparse role and named-user module rules; required-to-create is independent from access.';
