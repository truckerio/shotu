-- Reusable integration platform. Provider adapters share these company-scoped
-- credentials, clients, jobs, mappings, webhook, idempotency, outbox, and audit
-- contracts instead of creating provider-specific infrastructure.

create table if not exists integration_clients (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  name text not null,
  token_prefix text not null,
  token_hash text not null,
  scopes text[] not null default '{}',
  active boolean not null default true,
  expires_at timestamptz,
  last_used_at timestamptz,
  created_by_user_id uuid references user_profiles(id) on delete set null,
  revoked_by_user_id uuid references user_profiles(id) on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint integration_clients_name_nonempty check (btrim(name) <> ''),
  constraint integration_clients_prefix_nonempty check (btrim(token_prefix) <> ''),
  constraint integration_clients_hash_nonempty check (btrim(token_hash) <> '')
);

create unique index if not exists integration_clients_token_prefix_uidx
  on integration_clients(token_prefix);
create unique index if not exists integration_clients_token_hash_uidx
  on integration_clients(token_hash);
create index if not exists integration_clients_company_active_idx
  on integration_clients(company_id, active, created_at desc);

create table if not exists integration_credentials (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  integration_account_id uuid not null references integration_accounts(id) on delete cascade,
  provider text not null,
  credential_kind text not null,
  ciphertext text not null,
  iv text not null,
  auth_tag text not null,
  key_version text not null default 'v1',
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint integration_credentials_provider_nonempty check (btrim(provider) <> ''),
  constraint integration_credentials_kind_nonempty check (btrim(credential_kind) <> ''),
  constraint integration_credentials_ciphertext_nonempty check (btrim(ciphertext) <> '')
);

create unique index if not exists integration_credentials_account_kind_uidx
  on integration_credentials(integration_account_id, credential_kind);
create index if not exists integration_credentials_company_provider_idx
  on integration_credentials(company_id, provider);

create table if not exists integration_jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  integration_account_id uuid references integration_accounts(id) on delete set null,
  provider text not null,
  job_type text not null,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'retry', 'completed', 'dead_letter', 'cancelled')),
  payload jsonb not null default '{}',
  idempotency_key text,
  request_id text,
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 5 check (max_attempts between 1 and 25),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  heartbeat_at timestamptz,
  completed_at timestamptz,
  last_error_code text,
  last_error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint integration_jobs_provider_nonempty check (btrim(provider) <> ''),
  constraint integration_jobs_type_nonempty check (btrim(job_type) <> '')
);

create unique index if not exists integration_jobs_company_idempotency_uidx
  on integration_jobs(company_id, provider, idempotency_key)
  where idempotency_key is not null;
create index if not exists integration_jobs_claim_idx
  on integration_jobs(status, available_at, created_at)
  where status in ('queued', 'retry');
create index if not exists integration_jobs_company_created_idx
  on integration_jobs(company_id, created_at desc);

create table if not exists integration_job_attempts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references integration_jobs(id) on delete cascade,
  attempt integer not null check (attempt > 0),
  worker_id text not null,
  status text not null check (status in ('running', 'completed', 'failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  unique (job_id, attempt)
);

create index if not exists integration_job_attempts_job_idx
  on integration_job_attempts(job_id, attempt desc);

create table if not exists integration_mappings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  provider text not null,
  entity_type text not null,
  internal_id text not null,
  external_id text not null,
  status text not null default 'active'
    check (status in ('active', 'pending_review', 'disabled')),
  metadata jsonb not null default '{}',
  last_reconciled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists integration_mappings_internal_uidx
  on integration_mappings(company_id, provider, entity_type, internal_id);
create unique index if not exists integration_mappings_external_uidx
  on integration_mappings(company_id, provider, entity_type, external_id);
create index if not exists integration_mappings_review_idx
  on integration_mappings(company_id, provider, status)
  where status = 'pending_review';

create table if not exists integration_idempotency_records (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  integration_client_id uuid not null references integration_clients(id) on delete cascade,
  method text not null,
  path text not null,
  idempotency_key text not null,
  request_hash text not null,
  response_status integer,
  response_body jsonb,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days')
);

create unique index if not exists integration_idempotency_client_key_uidx
  on integration_idempotency_records(integration_client_id, idempotency_key);
create index if not exists integration_idempotency_expiry_idx
  on integration_idempotency_records(expires_at);

create table if not exists integration_webhook_inbox (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete cascade,
  provider text not null,
  provider_event_id text,
  signature_digest text,
  headers jsonb not null default '{}',
  payload jsonb not null default '{}',
  status text not null default 'received'
    check (status in ('received', 'verified', 'processing', 'processed', 'rejected', 'failed')),
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists integration_webhook_provider_event_uidx
  on integration_webhook_inbox(provider, provider_event_id)
  where provider_event_id is not null;
create index if not exists integration_webhook_status_idx
  on integration_webhook_inbox(status, received_at);

create table if not exists integration_outbox_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  aggregate_type text not null,
  aggregate_id text not null,
  event_type text not null,
  payload jsonb not null default '{}',
  request_id text,
  status text not null default 'pending'
    check (status in ('pending', 'publishing', 'published', 'failed')),
  available_at timestamptz not null default now(),
  published_at timestamptz,
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists integration_outbox_pending_idx
  on integration_outbox_events(status, available_at, created_at)
  where status in ('pending', 'failed');
create index if not exists integration_outbox_company_idx
  on integration_outbox_events(company_id, created_at desc);

create table if not exists integration_audit_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  provider text,
  action text not null,
  actor_type text not null check (actor_type in ('user', 'integration_client', 'system')),
  actor_id text,
  integration_client_id uuid references integration_clients(id) on delete set null,
  target_type text,
  target_id text,
  request_id text,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists integration_audit_company_created_idx
  on integration_audit_events(company_id, created_at desc);
create index if not exists integration_audit_target_idx
  on integration_audit_events(target_type, target_id, created_at desc);

alter table odoo_entry_status
  add column if not exists external_id text;

comment on table integration_clients is
  'Company-scoped machine identities. Raw bearer tokens are returned once and only SHA-256 hashes are stored.';
comment on table integration_credentials is
  'AES-GCM encrypted provider secrets. Ciphertext is bound to company, provider, account, and credential kind.';
comment on table integration_jobs is
  'Durable provider work queue claimed with PostgreSQL row leases.';
comment on table integration_mappings is
  'Canonical company-scoped internal-to-provider identity mappings.';
comment on table integration_idempotency_records is
  'Service API request hashes and replayable responses keyed by integration client.';
comment on table integration_webhook_inbox is
  'Deduplicated raw webhook receipt state after provider signature verification.';
comment on table integration_outbox_events is
  'Transactional domain events awaiting provider-specific delivery.';
comment on table integration_audit_events is
  'Append-only integration security and workflow audit trail.';
