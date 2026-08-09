create table if not exists company_workorder_module_policies (
  company_id uuid primary key references companies(id) on delete cascade,
  module_access jsonb not null default '{}'::jsonb,
  user_module_access jsonb not null default '{}'::jsonb,
  version bigint not null default 1 check (version > 0),
  updated_by_user_id uuid references user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint company_workorder_module_policy_access_object
    check (jsonb_typeof(module_access) = 'object'),
  constraint company_workorder_module_policy_user_access_object
    check (jsonb_typeof(user_module_access) = 'object')
);

comment on table company_workorder_module_policies is
  'Sparse company role defaults for registered workorder modules. Location and user exceptions remain location scoped.';

comment on column company_workorder_module_policies.module_access is
  'Sparse role, surface, and module access overrides. Missing values inherit safe built-in defaults.';

comment on column company_workorder_module_policies.user_module_access is
  'Sparse company-wide named-user exceptions. Location user exceptions take precedence.';
