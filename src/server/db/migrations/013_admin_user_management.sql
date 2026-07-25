alter table auth_user add column if not exists auth_role text not null default 'user';
alter table auth_user add column if not exists banned boolean not null default false;
alter table auth_user add column if not exists ban_reason text;
alter table auth_user add column if not exists ban_expires timestamptz;
alter table auth_session add column if not exists impersonated_by text;

update auth_user auth
set auth_role = 'admin',
    updated_at = now()
from app_users operational
where operational.auth_user_id = auth.id
  and operational.role = 'admin'
  and auth.auth_role is distinct from 'admin';

alter table app_users add column if not exists deleted_at timestamptz;

create table if not exists admin_user_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete restrict,
  actor_user_id uuid references app_users(id) on delete set null,
  target_user_id uuid references app_users(id) on delete set null,
  action text not null check (action in ('activated', 'deactivated', 'password_reset', 'deleted')),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists admin_user_events_company_created_idx
  on admin_user_events(company_id, created_at desc);

create index if not exists admin_user_events_target_created_idx
  on admin_user_events(target_user_id, created_at desc);

comment on table admin_user_events is
  'Append-only audit log for administrator account-management actions.';
