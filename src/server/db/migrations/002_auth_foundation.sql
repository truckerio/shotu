-- Better Auth owns credentials and sessions. app_users remains operational identity/RBAC truth.
create table if not exists auth_user (
  id text primary key,
  name text not null,
  email text not null unique,
  email_verified boolean not null default false,
  image text,
  username text unique,
  display_username text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists auth_session (
  id text primary key,
  expires_at timestamptz not null,
  token text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ip_address text,
  user_agent text,
  user_id text not null references auth_user(id) on delete cascade
);

create table if not exists auth_account (
  id text primary key,
  account_id text not null,
  provider_id text not null,
  user_id text not null references auth_user(id) on delete cascade,
  access_token text,
  refresh_token text,
  id_token text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  scope text,
  password text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists auth_verification (
  id text primary key,
  identifier text not null,
  value text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists auth_session_user_id_idx on auth_session(user_id);
create index if not exists auth_account_user_id_idx on auth_account(user_id);
create index if not exists auth_verification_identifier_idx on auth_verification(identifier);

alter table app_users add column if not exists auth_user_id text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'app_users_auth_user_id_fkey'
  ) then
    alter table app_users
      add constraint app_users_auth_user_id_fkey
      foreign key (auth_user_id) references auth_user(id) on delete restrict;
  end if;
end $$;

create unique index if not exists app_users_auth_user_id_idx
  on app_users(auth_user_id)
  where auth_user_id is not null;

create table if not exists user_location_memberships (
  user_id uuid not null references app_users(id) on delete cascade,
  location_id uuid not null references locations(id) on delete cascade,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, location_id)
);

create index if not exists user_location_memberships_location_active_idx
  on user_location_memberships(location_id, active, user_id);

create table if not exists user_company_memberships (
  user_id uuid not null references app_users(id) on delete cascade,
  company_id text not null,
  role text not null check (role in ('mechanic', 'office', 'surveillance', 'admin')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, company_id)
);

create index if not exists user_company_memberships_company_active_idx
  on user_company_memberships(company_id, active, role, user_id);

insert into user_company_memberships (user_id, company_id, role, active)
select id, 'default', role, active
from app_users
on conflict (user_id, company_id) do nothing;
