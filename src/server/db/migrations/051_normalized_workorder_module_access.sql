create table if not exists workorder_module_policy_scopes (
  id uuid primary key default gen_random_uuid(),
  scope_type text not null check (scope_type in ('company', 'location')),
  company_id uuid not null references companies(id) on delete cascade,
  location_id uuid references locations(id) on delete cascade,
  version bigint not null default 1 check (version > 0),
  updated_by_user_id uuid references user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workorder_module_policy_scope_shape check (
    (scope_type = 'company' and location_id is null)
    or (scope_type = 'location' and location_id is not null)
  )
);

create unique index if not exists workorder_module_policy_company_scope_unique
  on workorder_module_policy_scopes (company_id) where scope_type = 'company';
create unique index if not exists workorder_module_policy_location_scope_unique
  on workorder_module_policy_scopes (location_id) where scope_type = 'location';

create table if not exists workorder_module_access_rules (
  id uuid primary key default gen_random_uuid(),
  scope_id uuid not null references workorder_module_policy_scopes(id) on delete cascade,
  subject_type text not null check (subject_type in ('role', 'user')),
  subject_id text not null,
  surface text not null check (surface in ('create', 'detail')),
  module_key text not null,
  access text not null check (access in ('hidden', 'read', 'write')),
  required boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workorder_module_access_rule_subject check (
    (subject_type = 'role' and subject_id in ('mechanic', 'office', 'surveillance', 'admin'))
    or (subject_type = 'user' and subject_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
  ),
  unique (scope_id, subject_type, subject_id, surface, module_key)
);

create index if not exists workorder_module_access_rules_scope_lookup
  on workorder_module_access_rules (scope_id, subject_type, subject_id, surface);

insert into workorder_module_policy_scopes (
  scope_type, company_id, version, updated_by_user_id, created_at, updated_at
)
select 'company', company_id, version, updated_by_user_id, created_at, updated_at
from company_workorder_module_policies
on conflict (company_id) where scope_type = 'company' do nothing;

insert into workorder_module_policy_scopes (
  scope_type, company_id, location_id, version, updated_by_user_id, created_at, updated_at
)
select 'location', company_id, location_id, 1, updated_by_user_id, created_at, updated_at
from location_workorder_policies
on conflict (location_id) where scope_type = 'location' do nothing;

with legacy_rules as (
  select scope.id as scope_id, 'role'::text as subject_type, role_entry.key as subject_id,
         surface_entry.key as surface, module_entry.key as module_key, module_entry.value #>> '{}' as legacy_access
  from workorder_module_policy_scopes scope
  join company_workorder_module_policies policy on scope.scope_type = 'company' and policy.company_id = scope.company_id
  cross join lateral jsonb_each(policy.module_access) role_entry
  cross join lateral jsonb_each(role_entry.value) surface_entry
  cross join lateral jsonb_each(surface_entry.value) module_entry
  union all
  select scope.id, 'user', user_entry.key, surface_entry.key, module_entry.key, module_entry.value #>> '{}'
  from workorder_module_policy_scopes scope
  join company_workorder_module_policies policy on scope.scope_type = 'company' and policy.company_id = scope.company_id
  cross join lateral jsonb_each(policy.user_module_access) user_entry
  cross join lateral jsonb_each(user_entry.value) surface_entry
  cross join lateral jsonb_each(surface_entry.value) module_entry
  union all
  select scope.id, 'role', role_entry.key, surface_entry.key, module_entry.key, module_entry.value #>> '{}'
  from workorder_module_policy_scopes scope
  join location_workorder_policies policy on scope.scope_type = 'location' and policy.location_id = scope.location_id
  cross join lateral jsonb_each(policy.module_access) role_entry
  cross join lateral jsonb_each(role_entry.value) surface_entry
  cross join lateral jsonb_each(surface_entry.value) module_entry
  union all
  select scope.id, 'user', user_entry.key, surface_entry.key, module_entry.key, module_entry.value #>> '{}'
  from workorder_module_policy_scopes scope
  join location_workorder_policies policy on scope.scope_type = 'location' and policy.location_id = scope.location_id
  cross join lateral jsonb_each(policy.user_module_access) user_entry
  cross join lateral jsonb_each(user_entry.value) surface_entry
  cross join lateral jsonb_each(surface_entry.value) module_entry
)
insert into workorder_module_access_rules (
  scope_id, subject_type, subject_id, surface, module_key, access, required
)
select scope_id, subject_type, subject_id, surface, module_key,
       case when legacy_access = 'required' then 'write' else legacy_access end,
       legacy_access = 'required'
from legacy_rules
where legacy_access in ('hidden', 'read', 'write', 'required')
on conflict (scope_id, subject_type, subject_id, surface, module_key) do nothing;

comment on table workorder_module_policy_scopes is
  'Versioned company or location scope for canonical workorder module access rules.';
comment on table workorder_module_access_rules is
  'Sparse normalized role and named-user rules. Required-to-create remains independent from access.';
