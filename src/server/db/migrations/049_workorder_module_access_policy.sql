alter table location_workorder_policies
  add column if not exists module_access jsonb not null default '{}'::jsonb;

alter table location_workorder_policies
  add column if not exists user_module_access jsonb not null default '{}'::jsonb;

comment on column location_workorder_policies.module_access is
  'V2 workorder module access overrides by role and surface. Missing keys use application defaults.';

comment on column location_workorder_policies.user_module_access is
  'V2 workorder module access overrides by named user. Missing keys inherit role access.';
