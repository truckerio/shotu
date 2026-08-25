set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table invoice_extraction_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  location_id uuid not null,
  created_by uuid not null references user_profiles(id) on delete restrict,
  reviewed_by uuid references user_profiles(id) on delete restrict,
  document_hash char(64) not null check (document_hash ~ '^[0-9a-f]{64}$'),
  file_name varchar(180) not null check (char_length(file_name) between 1 and 180),
  mime_type varchar(64) not null check (mime_type in ('image/png', 'image/jpeg', 'image/webp', 'application/pdf')),
  byte_size integer not null check (byte_size between 1 and 10485760),
  idempotency_key varchar(120) not null check (char_length(idempotency_key) between 8 and 120),
  status varchar(32) not null check (status in ('processing', 'completed', 'needs_review', 'failed', 'reviewed')),
  provider varchar(32) not null,
  model varchar(100) not null,
  prompt_version varchar(40) not null,
  memory_snapshot jsonb not null default '{}'::jsonb,
  extracted_draft jsonb,
  reviewed_draft jsonb,
  review_idempotency_key varchar(120) check (review_idempotency_key is null or char_length(review_idempotency_key) between 8 and 120),
  review_request_hash char(64) check (review_request_hash is null or review_request_hash ~ '^[0-9a-f]{64}$'),
  error_code varchar(80),
  retryable boolean not null default false,
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  constraint invoice_extraction_runs_location_company_fk
    foreign key (company_id, location_id) references locations(company_id, id) on delete restrict,
  constraint invoice_extraction_runs_review_state check (
    (status = 'reviewed' and reviewed_by is not null and reviewed_at is not null and reviewed_draft is not null)
    or status <> 'reviewed'
  ),
  unique (company_id, created_by, idempotency_key),
  unique (company_id, id)
);

create index invoice_extraction_runs_company_created_idx
  on invoice_extraction_runs (company_id, created_at desc);
create index invoice_extraction_runs_company_document_idx
  on invoice_extraction_runs (company_id, document_hash, created_at desc);

create table invoice_correction_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  run_id uuid not null,
  reviewer_id uuid not null references user_profiles(id) on delete restrict,
  field_path varchar(300) not null check (char_length(field_path) between 1 and 300),
  predicted_value jsonb,
  reviewed_value jsonb,
  correction_type varchar(40) not null check (correction_type in ('changed', 'added', 'removed', 'confirmed')),
  created_at timestamptz not null default now(),
  constraint invoice_correction_events_run_company_fk
    foreign key (company_id, run_id) references invoice_extraction_runs(company_id, id) on delete cascade
);

create index invoice_correction_events_run_idx
  on invoice_correction_events (company_id, run_id, created_at, id);

create table invoice_semantic_facts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  vendor_key varchar(180) not null default '',
  fact_type varchar(60) not null check (char_length(fact_type) between 1 and 60),
  fact_key varchar(300) not null check (char_length(fact_key) between 1 and 300),
  fact_value jsonb not null,
  constraint invoice_semantic_facts_value_size check (octet_length(fact_value::text) <= 4000),
  fact_value_hash char(64) not null check (fact_value_hash ~ '^[0-9a-f]{64}$'),
  status varchar(20) not null default 'candidate' check (status in ('candidate', 'approved', 'rejected')),
  evidence_count integer not null default 1 check (evidence_count >= 0),
  contradiction_count integer not null default 0 check (contradiction_count >= 0),
  first_evidence_run_id uuid not null,
  last_evidence_run_id uuid not null,
  approved_by uuid references user_profiles(id) on delete restrict,
  approved_at timestamptz,
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invoice_semantic_facts_first_run_fk
    foreign key (company_id, first_evidence_run_id) references invoice_extraction_runs(company_id, id) on delete cascade,
  constraint invoice_semantic_facts_last_run_fk
    foreign key (company_id, last_evidence_run_id) references invoice_extraction_runs(company_id, id) on delete cascade,
  constraint invoice_semantic_facts_approval_state check (
    (status = 'approved' and approved_by is not null and approved_at is not null)
    or status <> 'approved'
  ),
  unique (company_id, vendor_key, fact_type, fact_key, fact_value_hash)
);

create index invoice_semantic_facts_active_lookup_idx
  on invoice_semantic_facts (company_id, vendor_key, updated_at desc)
  where status = 'approved';

create table invoice_extraction_playbooks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  vendor_key varchar(180) not null default '',
  name varchar(120) not null check (char_length(name) between 1 and 120),
  rule_text varchar(2000) not null check (char_length(rule_text) between 1 and 2000),
  version integer not null check (version >= 1),
  status varchar(20) not null default 'draft' check (status in ('draft', 'active', 'retired')),
  created_by uuid not null references user_profiles(id) on delete restrict,
  approved_by uuid references user_profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  constraint invoice_extraction_playbooks_active_state check (
    (status = 'active' and approved_by is not null and approved_at is not null)
    or status <> 'active'
  ),
  unique (company_id, vendor_key, name, version)
);

create index invoice_extraction_playbooks_active_lookup_idx
  on invoice_extraction_playbooks (company_id, vendor_key, name, version desc)
  where status = 'active';

comment on table invoice_extraction_runs is
  'Tenant-scoped immutable invoice document identity and extraction/review outcome. Raw document bytes are not stored.';
comment on table invoice_correction_events is
  'Episodic memory: append-only human corrections from reviewed invoice drafts.';
comment on table invoice_semantic_facts is
  'Semantic memory: governed tenant/vendor facts. Candidate facts never influence extraction.';
comment on table invoice_extraction_playbooks is
  'Procedural memory: versioned, explicitly approved extraction rules.';
