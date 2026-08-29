set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table invoice_global_layout_consents (
  company_id uuid primary key references companies(id) on delete restrict,
  state varchar(20) not null default 'disabled'
    check (state in ('disabled', 'enabled', 'withdrawing')),
  policy_version varchar(40) not null,
  version integer not null default 1 check (version >= 1),
  changed_by uuid not null references user_profiles(id) on delete restrict,
  changed_at timestamptz not null default now()
);

create table invoice_global_layout_consent_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete restrict,
  actor_id uuid not null references user_profiles(id) on delete restrict,
  action varchar(32) not null
    check (action in ('enabled', 'withdrawal_requested', 'withdrawal_completed')),
  policy_version varchar(40) not null,
  idempotency_key varchar(120) not null
    check (char_length(idempotency_key) between 8 and 120),
  created_at timestamptz not null default now(),
  unique (company_id, idempotency_key)
);

create index invoice_global_layout_consent_events_company_idx
  on invoice_global_layout_consent_events (company_id, created_at desc, id);

create table invoice_global_layout_hmac_versions (
  key_version varchar(40) primary key,
  status varchar(20) not null check (status in ('active', 'matching', 'retired')),
  activated_at timestamptz not null,
  retired_at timestamptz,
  constraint invoice_global_layout_hmac_version_state check (
    (status = 'retired' and retired_at is not null)
    or (status <> 'retired' and retired_at is null)
  )
);

create unique index invoice_global_layout_one_active_hmac_idx
  on invoice_global_layout_hmac_versions ((status)) where status = 'active';

create table invoice_global_layout_contributions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete restrict,
  run_id uuid not null,
  reviewer_id uuid not null references user_profiles(id) on delete restrict,
  structural_fingerprint char(64) not null
    check (structural_fingerprint ~ '^[0-9a-f]{64}$'),
  schema_version integer not null check (schema_version >= 1),
  hmac_key_version varchar(40) not null references invoice_global_layout_hmac_versions(key_version) on delete restrict,
  sanitized_payload jsonb not null,
  privacy_scanner_version varchar(40) not null,
  privacy_scan_digest char(64) not null check (privacy_scan_digest ~ '^[0-9a-f]{64}$'),
  replay_evidence jsonb not null,
  state varchar(20) not null default 'eligible'
    check (state in ('eligible', 'quarantined', 'tombstoned')),
  contributed_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint invoice_global_layout_contribution_run_fk
    foreign key (company_id, run_id) references invoice_extraction_runs(company_id, id) on delete restrict,
  constraint invoice_global_layout_contribution_payload_size
    check (
      jsonb_typeof(sanitized_payload) = 'object'
      and sanitized_payload ?& array[
        'schemaVersion', 'hmacKeyVersion', 'pageShape',
        'signatureRegions', 'fieldAnchors', 'tableColumns'
      ]
      and sanitized_payload - array[
        'schemaVersion', 'hmacKeyVersion', 'pageShape',
        'signatureRegions', 'fieldAnchors', 'tableColumns'
      ] = '{}'::jsonb
      and octet_length(sanitized_payload::text) <= 32768
    ),
  constraint invoice_global_layout_contribution_replay_shape check (
    jsonb_typeof(replay_evidence) = 'object'
    and replay_evidence ?& array[
      'evaluatorVersion', 'positiveMatched', 'applicableCriticalFields',
      'correctCriticalFields', 'totalsApplicable', 'totalsReconcile',
      'explicitNegativeCount', 'falsePositiveCount'
    ]
    and replay_evidence - array[
      'evaluatorVersion', 'positiveMatched', 'applicableCriticalFields',
      'correctCriticalFields', 'totalsApplicable', 'totalsReconcile',
      'explicitNegativeCount', 'falsePositiveCount'
    ] = '{}'::jsonb
    and octet_length(replay_evidence::text) <= 2048
  ),
  constraint invoice_global_layout_contribution_revocation_state check (
    (state = 'tombstoned' and revoked_at is not null)
    or (state <> 'tombstoned' and revoked_at is null)
  ),
  unique (company_id, run_id, schema_version, hmac_key_version)
);

create index invoice_global_layout_contributions_rebuild_idx
  on invoice_global_layout_contributions (
    structural_fingerprint, schema_version, hmac_key_version, state, contributed_at, id
  );
create index invoice_global_layout_contributions_company_idx
  on invoice_global_layout_contributions (company_id, state, contributed_at desc, id);

create table invoice_global_layout_contribution_commands (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete restrict,
  run_id uuid not null,
  reviewer_id uuid not null references user_profiles(id) on delete restrict,
  review_request_hash char(64) not null check (review_request_hash ~ '^[0-9a-f]{64}$'),
  structural_fingerprint char(64) not null check (structural_fingerprint ~ '^[0-9a-f]{64}$'),
  schema_version integer not null check (schema_version >= 1),
  hmac_key_version varchar(40) not null references invoice_global_layout_hmac_versions(key_version) on delete restrict,
  sanitized_payload jsonb not null,
  privacy_scanner_version varchar(40) not null,
  privacy_scan_digest char(64) not null check (privacy_scan_digest ~ '^[0-9a-f]{64}$'),
  replay_evidence jsonb not null,
  company_layout_cap integer not null check (company_layout_cap between 1 and 20),
  status varchar(20) not null default 'pending' check (status in ('pending', 'processing', 'completed', 'cancelled', 'failed')),
  attempts integer not null default 0 check (attempts between 0 and 10),
  next_attempt_at timestamptz not null default now(),
  error_code varchar(80),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint invoice_global_layout_command_run_fk
    foreign key (company_id, run_id) references invoice_extraction_runs(company_id, id) on delete cascade,
  constraint invoice_global_layout_command_payload_shape check (
    jsonb_typeof(sanitized_payload) = 'object'
    and sanitized_payload ?& array[
      'schemaVersion', 'hmacKeyVersion', 'pageShape',
      'signatureRegions', 'fieldAnchors', 'tableColumns'
    ]
    and sanitized_payload - array[
      'schemaVersion', 'hmacKeyVersion', 'pageShape',
      'signatureRegions', 'fieldAnchors', 'tableColumns'
    ] = '{}'::jsonb
    and octet_length(sanitized_payload::text) <= 32768
  ),
  constraint invoice_global_layout_command_replay_shape check (
    jsonb_typeof(replay_evidence) = 'object'
    and replay_evidence ?& array[
      'evaluatorVersion', 'positiveMatched', 'applicableCriticalFields',
      'correctCriticalFields', 'totalsApplicable', 'totalsReconcile',
      'explicitNegativeCount', 'falsePositiveCount'
    ]
    and replay_evidence - array[
      'evaluatorVersion', 'positiveMatched', 'applicableCriticalFields',
      'correctCriticalFields', 'totalsApplicable', 'totalsReconcile',
      'explicitNegativeCount', 'falsePositiveCount'
    ] = '{}'::jsonb
    and octet_length(replay_evidence::text) <= 2048
  ),
  constraint invoice_global_layout_command_completion_state check (
    (status in ('completed', 'cancelled', 'failed') and completed_at is not null)
    or (status in ('pending', 'processing') and completed_at is null)
  ),
  unique (company_id, run_id, review_request_hash)
);

create index invoice_global_layout_contribution_commands_claim_idx
  on invoice_global_layout_contribution_commands (status, next_attempt_at, created_at, id);

create table invoice_global_layout_templates (
  id uuid primary key default gen_random_uuid(),
  structural_fingerprint char(64) not null
    check (structural_fingerprint ~ '^[0-9a-f]{64}$'),
  schema_version integer not null check (schema_version >= 1),
  hmac_key_version varchar(40) not null references invoice_global_layout_hmac_versions(key_version) on delete restrict,
  marker_digests char(64)[] not null,
  template_payload jsonb not null,
  status varchar(20) not null default 'shadow'
    check (status in ('shadow', 'canary', 'active', 'quarantined', 'retired')),
  artifact_version integer not null check (artifact_version >= 1),
  support_count integer not null check (support_count >= 0),
  company_count integer not null check (company_count >= 0),
  max_company_share numeric(6,5) not null check (max_company_share between 0 and 1),
  critical_exact_match numeric(6,5) not null check (critical_exact_match between 0 and 1),
  totals_reconcile_rate numeric(6,5) not null check (totals_reconcile_rate between 0 and 1),
  false_match_rate numeric(8,7) not null check (false_match_rate between 0 and 1),
  privacy_scanner_version varchar(40) not null,
  privacy_scan_digest char(64) not null check (privacy_scan_digest ~ '^[0-9a-f]{64}$'),
  release_evidence_id uuid,
  quarantined_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invoice_global_layout_template_markers check (
    cardinality(marker_digests) between 3 and 12
    and array_to_string(marker_digests, '') ~ '^[0-9a-f]+$'
  ),
  constraint invoice_global_layout_template_payload_size check (
    jsonb_typeof(template_payload) = 'object'
    and template_payload ?& array[
      'schemaVersion', 'hmacKeyVersion', 'pageShape',
      'signatureRegions', 'fieldAnchors', 'tableColumns'
    ]
    and template_payload - array[
      'schemaVersion', 'hmacKeyVersion', 'pageShape',
      'signatureRegions', 'fieldAnchors', 'tableColumns'
    ] = '{}'::jsonb
    and octet_length(template_payload::text) <= 32768
  ),
  constraint invoice_global_layout_template_quarantine_state check (
    (status = 'quarantined' and quarantined_at is not null)
    or (status <> 'quarantined' and quarantined_at is null)
  ),
  unique (structural_fingerprint, schema_version, hmac_key_version, artifact_version)
);

create table invoice_global_layout_release_evidence (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references invoice_global_layout_templates(id) on delete restrict,
  sealed_manifest_hash char(64) not null check (sealed_manifest_hash ~ '^[0-9a-f]{64}$'),
  evaluator_version varchar(40) not null,
  eligible_count integer not null check (eligible_count >= 1),
  returned_count integer not null check (returned_count between 0 and eligible_count),
  correct_count integer not null check (correct_count between 0 and returned_count),
  negative_count integer not null check (negative_count >= 1000),
  false_positive_count integer not null check (false_positive_count between 0 and negative_count),
  totals_applicable_count integer not null check (totals_applicable_count >= 1),
  totals_reconciled_count integer not null check (totals_reconciled_count between 0 and totals_applicable_count),
  company_count integer not null check (company_count >= 3),
  max_company_share numeric(6,5) not null check (max_company_share between 0 and 0.4),
  privacy_scanner_version varchar(40) not null,
  privacy_scan_digest char(64) not null check (privacy_scan_digest ~ '^[0-9a-f]{64}$'),
  status varchar(20) not null default 'sealed' check (status in ('sealed', 'revoked')),
  sealed_at timestamptz not null default now(),
  unique (template_id, sealed_manifest_hash)
);

alter table invoice_global_layout_templates
  add constraint invoice_global_layout_templates_release_evidence_fk
  foreign key (release_evidence_id) references invoice_global_layout_release_evidence(id) on delete restrict;

alter table invoice_global_layout_templates
  add constraint invoice_global_layout_templates_release_state check (
    (status in ('canary', 'active') and release_evidence_id is not null)
    or status not in ('canary', 'active')
  );

create table invoice_global_layout_lifecycle_events (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references invoice_global_layout_templates(id) on delete restrict,
  from_status varchar(20) not null,
  to_status varchar(20) not null,
  release_evidence_id uuid references invoice_global_layout_release_evidence(id) on delete restrict,
  owner varchar(40) not null check (owner in ('release_evaluator', 'revocation_worker', 'hmac_lifecycle')),
  reason_code varchar(80) not null,
  created_at timestamptz not null default now()
);

create index invoice_global_layout_templates_match_idx
  on invoice_global_layout_templates using gin (marker_digests);
create index invoice_global_layout_templates_active_idx
  on invoice_global_layout_templates (
    schema_version, hmac_key_version, status, support_count desc, updated_at desc, id
  );

create table invoice_global_layout_rebuilds (
  id uuid primary key default gen_random_uuid(),
  structural_fingerprint char(64) not null
    check (structural_fingerprint ~ '^[0-9a-f]{64}$'),
  schema_version integer not null check (schema_version >= 1),
  hmac_key_version varchar(40) not null references invoice_global_layout_hmac_versions(key_version) on delete restrict,
  status varchar(20) not null default 'queued'
    check (status in ('queued', 'running', 'validating', 'succeeded', 'failed')),
  attempts integer not null default 0 check (attempts between 0 and 10),
  error_code varchar(80),
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  constraint invoice_global_layout_rebuild_completion_state check (
    (status in ('succeeded', 'failed') and completed_at is not null)
    or (status not in ('succeeded', 'failed') and completed_at is null)
  )
);

create unique index invoice_global_layout_rebuilds_open_idx
  on invoice_global_layout_rebuilds (structural_fingerprint, schema_version, hmac_key_version)
  where status in ('queued', 'running', 'validating');
create index invoice_global_layout_rebuilds_claim_idx
  on invoice_global_layout_rebuilds (status, requested_at, id);

comment on table invoice_global_layout_contributions is
  'Tenant-governed revocable ledger containing only validated privacy-safe structural payloads.';
comment on table invoice_global_layout_templates is
  'Cross-tenant artifacts with random IDs and no tenant, run, user, vendor, OCR, draft, or source-document backlinks.';
comment on table invoice_global_layout_hmac_versions is
  'HMAC key lifecycle metadata only. Secret key bytes are never stored in the database.';
