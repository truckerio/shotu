set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table invoice_source_access_events
  drop constraint invoice_source_access_events_action_check;

alter table invoice_source_access_events
  add constraint invoice_source_access_events_action_check
  check (action in ('view', 'training_export', 'template_learn', 'retention_delete'));

create table invoice_layout_templates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  vendor_key varchar(180) not null default '',
  fingerprint char(64) not null check (fingerprint ~ '^[0-9a-f]{64}$'),
  template_payload jsonb not null,
  status varchar(20) not null default 'candidate'
    check (status in ('candidate', 'active', 'quarantined', 'retired')),
  evidence_count integer not null default 1 check (evidence_count >= 1),
  contradiction_count integer not null default 0 check (contradiction_count >= 0),
  version integer not null default 1 check (version >= 1),
  first_evidence_run_id uuid not null,
  last_evidence_run_id uuid not null,
  created_by uuid not null references user_profiles(id) on delete restrict,
  activated_by uuid references user_profiles(id) on delete restrict,
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invoice_layout_templates_first_run_fk
    foreign key (company_id, first_evidence_run_id) references invoice_extraction_runs(company_id, id) on delete cascade,
  constraint invoice_layout_templates_last_run_fk
    foreign key (company_id, last_evidence_run_id) references invoice_extraction_runs(company_id, id) on delete cascade,
  constraint invoice_layout_templates_payload_size
    check (octet_length(template_payload::text) <= 65536),
  constraint invoice_layout_templates_activation_state check (
    (status = 'active' and evidence_count >= 3 and activated_by is not null and activated_at is not null)
    or
    (status <> 'active' and activated_by is null and activated_at is null)
  ),
  unique (company_id, vendor_key, fingerprint),
  unique (company_id, id)
);

create index invoice_layout_templates_match_idx
  on invoice_layout_templates (company_id, status, vendor_key, evidence_count desc, updated_at desc);

create index invoice_layout_templates_vendor_idx
  on invoice_layout_templates (company_id, vendor_key, status, updated_at desc);

comment on table invoice_layout_templates is
  'Tenant/vendor-scoped hashed OCR layout templates learned only from explicitly approved invoice reviews.';
