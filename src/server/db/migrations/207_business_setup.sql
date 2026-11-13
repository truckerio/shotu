create table if not exists business_setups (
  company_id uuid primary key references companies(id),
  operating_mode text not null check (operating_mode in ('fleet_only','customer_repairs','both')),
  shop_identity jsonb not null,
  step integer not null check (step between 1 and 3),
  status text not null check (status in ('draft','completed')),
  version integer not null check (version > 0),
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);
create table if not exists business_setup_idempotency (
  company_id uuid not null references companies(id), actor_id text not null,
  idempotency_key text not null, request_hash text not null, result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (company_id, actor_id, idempotency_key)
);
create table if not exists business_setup_audit_events (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies(id), actor_id text not null,
  setup jsonb not null, created_at timestamptz not null default now()
);
create or replace function prevent_business_setup_audit_mutation() returns trigger language plpgsql as $$
begin raise exception 'Business setup audit events are immutable'; end $$;
drop trigger if exists business_setup_audit_immutable on business_setup_audit_events;
create trigger business_setup_audit_immutable before update or delete on business_setup_audit_events
  for each row execute function prevent_business_setup_audit_mutation();
