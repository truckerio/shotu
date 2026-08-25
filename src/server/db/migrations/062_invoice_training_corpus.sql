set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table invoice_extraction_runs
  add column provider_response_id varchar(180),
  add column input_tokens integer check (input_tokens is null or input_tokens >= 0),
  add column output_tokens integer check (output_tokens is null or output_tokens >= 0),
  add column reasoning_tokens integer check (reasoning_tokens is null or reasoning_tokens >= 0);

create table invoice_source_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  run_id uuid not null,
  ciphertext bytea,
  iv bytea,
  auth_tag bytea,
  key_version varchar(40) not null check (char_length(key_version) between 1 and 40),
  content_sha256 char(64) not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  mime_type varchar(64) not null check (mime_type in ('image/png', 'image/jpeg', 'image/webp', 'application/pdf')),
  byte_size integer not null check (byte_size between 1 and 10485760),
  training_status varchar(24) not null default 'pending_review'
    check (training_status in ('pending_review', 'eligible', 'excluded', 'deleted')),
  retention_until timestamptz not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint invoice_source_documents_run_company_fk
    foreign key (company_id, run_id) references invoice_extraction_runs(company_id, id) on delete cascade,
  constraint invoice_source_documents_payload_state check (
    (training_status = 'deleted' and ciphertext is null and iv is null and auth_tag is null and deleted_at is not null)
    or
    (training_status <> 'deleted' and ciphertext is not null and octet_length(ciphertext) = byte_size
      and iv is not null and octet_length(iv) = 12
      and auth_tag is not null and octet_length(auth_tag) = 16
      and deleted_at is null)
  ),
  unique (company_id, run_id),
  unique (company_id, id)
);

create index invoice_source_documents_retention_idx
  on invoice_source_documents (retention_until, id)
  where training_status <> 'deleted';
create index invoice_source_documents_training_idx
  on invoice_source_documents (company_id, training_status, created_at desc);

create table invoice_training_examples (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  run_id uuid not null,
  source_document_id uuid not null,
  predicted_draft jsonb not null,
  gold_draft jsonb not null,
  quality_metrics jsonb not null default '{}'::jsonb,
  vendor_key varchar(180) not null default '',
  extractor_provider varchar(32) not null,
  extractor_model varchar(100) not null,
  prompt_version varchar(40) not null,
  reviewer_id uuid not null references user_profiles(id) on delete restrict,
  status varchar(20) not null default 'eligible' check (status in ('eligible', 'quarantined', 'retired')),
  label_version integer not null default 1 check (label_version >= 1),
  created_at timestamptz not null default now(),
  constraint invoice_training_examples_run_company_fk
    foreign key (company_id, run_id) references invoice_extraction_runs(company_id, id) on delete cascade,
  constraint invoice_training_examples_source_company_fk
    foreign key (company_id, source_document_id) references invoice_source_documents(company_id, id) on delete cascade,
  unique (company_id, run_id, label_version)
);

create index invoice_training_examples_lookup_idx
  on invoice_training_examples (company_id, status, vendor_key, extractor_model, prompt_version, created_at desc);

create table invoice_source_access_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  run_id uuid not null,
  source_document_id uuid not null,
  actor_id uuid references user_profiles(id) on delete restrict,
  action varchar(32) not null check (action in ('view', 'training_export', 'retention_delete')),
  created_at timestamptz not null default now(),
  constraint invoice_source_access_events_actor_state check (
    (action = 'retention_delete' and actor_id is null)
    or (action <> 'retention_delete' and actor_id is not null)
  ),
  constraint invoice_source_access_events_run_company_fk
    foreign key (company_id, run_id) references invoice_extraction_runs(company_id, id) on delete cascade,
  constraint invoice_source_access_events_source_company_fk
    foreign key (company_id, source_document_id) references invoice_source_documents(company_id, id) on delete cascade
);

create index invoice_source_access_events_lookup_idx
  on invoice_source_access_events (company_id, run_id, created_at desc, id);

comment on table invoice_source_documents is
  'AES-256-GCM encrypted invoice sources with tenant-bound authenticated metadata and bounded retention.';
comment on table invoice_training_examples is
  'Explicitly opted-in human-reviewed gold labels paired with immutable provider predictions.';
comment on table invoice_source_access_events is
  'Append-only audit of decrypted source access and retention actions; never contains invoice payloads.';
