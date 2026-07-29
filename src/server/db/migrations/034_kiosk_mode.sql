-- Additive shared-browser kiosk authentication for mechanics.
-- Better Auth remains the owner of personal credentials and sessions.

create table if not exists kiosk_devices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  location_id uuid not null,
  name text not null,
  token_hash text not null unique,
  active boolean not null default true,
  registered_by_user_id uuid not null references user_profiles(id) on delete restrict,
  last_seen_at timestamptz,
  revoked_at timestamptz,
  revoked_by_user_id uuid references user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint kiosk_devices_company_location_fkey
    foreign key (company_id, location_id)
    references locations(company_id, id)
    on delete restrict,
  constraint kiosk_devices_name_check
    check (char_length(btrim(name)) between 1 and 80),
  constraint kiosk_devices_token_hash_check
    check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint kiosk_devices_revocation_check
    check (
      (active and revoked_at is null and revoked_by_user_id is null)
      or
      (not active and revoked_at is not null)
    )
);

create unique index if not exists kiosk_devices_id_location_uidx
  on kiosk_devices(id, location_id);

create index if not exists kiosk_devices_location_active_idx
  on kiosk_devices(company_id, location_id, active, created_at desc);

create table if not exists mechanic_kiosk_credentials (
  user_id uuid not null references user_profiles(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  pin_hash text not null,
  requires_change boolean not null default true,
  version integer not null default 1 check (version > 0),
  updated_by_user_id uuid references user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, company_id),
  constraint mechanic_kiosk_credentials_membership_fkey
    foreign key (user_id, company_id)
    references user_company_memberships(user_id, company_id)
    on delete cascade,
  constraint mechanic_kiosk_credentials_pin_hash_check
    check (char_length(pin_hash) between 32 and 512)
);

create table if not exists kiosk_unlock_failures (
  device_id uuid not null references kiosk_devices(id) on delete cascade,
  user_id uuid not null references user_profiles(id) on delete cascade,
  failure_count integer not null default 0 check (failure_count >= 0),
  window_started_at timestamptz not null default now(),
  locked_until timestamptz,
  updated_at timestamptz not null default now(),
  primary key (device_id, user_id)
);

create table if not exists kiosk_session_context (
  session_id text primary key references auth_session(id) on delete cascade,
  device_id uuid not null,
  location_id uuid not null,
  authenticated_at timestamptz not null default now(),
  constraint kiosk_session_context_device_location_fkey
    foreign key (device_id, location_id)
    references kiosk_devices(id, location_id)
    on delete restrict
);

create index if not exists kiosk_session_context_device_idx
  on kiosk_session_context(device_id, authenticated_at desc);

create table if not exists kiosk_audit_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete restrict,
  location_id uuid references locations(id) on delete set null,
  device_id uuid references kiosk_devices(id) on delete set null,
  actor_user_id uuid references user_profiles(id) on delete set null,
  target_user_id uuid references user_profiles(id) on delete set null,
  event_type text not null check (event_type in (
    'device_registered',
    'device_revoked',
    'pin_issued',
    'pin_reset',
    'pin_changed',
    'unlock_succeeded',
    'unlock_failed',
    'session_locked',
    'mechanic_switched'
  )),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists kiosk_audit_events_company_created_idx
  on kiosk_audit_events(company_id, created_at desc);

create index if not exists kiosk_audit_events_device_created_idx
  on kiosk_audit_events(device_id, created_at desc)
  where device_id is not null;

comment on table kiosk_devices is
  'Registered shared browsers. Plaintext device credentials exist only in HttpOnly browser cookies.';
comment on column kiosk_devices.token_hash is
  'SHA-256 hash of a 256-bit random device credential.';
comment on table mechanic_kiosk_credentials is
  'Company-scoped six-digit mechanic PIN verifiers hashed with Better Auth scrypt.';
comment on table kiosk_session_context is
  'Device and location companion context for normal Better Auth mechanic sessions created by kiosk unlock.';
comment on table kiosk_audit_events is
  'Append-only kiosk lifecycle audit. Metadata must never contain raw device credentials or PINs.';
