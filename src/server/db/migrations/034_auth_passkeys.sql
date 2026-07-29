-- Better Auth passkey plugin credential storage.
create table if not exists auth_passkey (
  id text primary key,
  name text,
  public_key text not null,
  user_id text not null references auth_user(id) on delete cascade,
  credential_id text not null,
  counter bigint not null,
  device_type text not null,
  backed_up boolean not null,
  transports text,
  created_at timestamptz not null default now(),
  aaguid text
);

create index if not exists auth_passkey_user_id_idx
  on auth_passkey(user_id);

create unique index if not exists auth_passkey_credential_id_uidx
  on auth_passkey(credential_id);
