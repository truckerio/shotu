set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table inventory_count_imports
  add column source_ciphertext bytea,
  add column source_iv bytea,
  add column source_auth_tag bytea,
  add column source_key_version varchar(40),
  add column source_retention_until timestamptz,
  add column source_deleted_at timestamptz;

-- Migration 077 may already exist in a developer database. Purge its plaintext
-- payload while retaining source hash, manifest metadata, and parsed line evidence.
update inventory_count_imports
set source_deleted_at = now()
where source_file_bytes is not null;

alter table inventory_count_imports
  drop constraint inventory_count_imports_source_file_check,
  drop column source_file_bytes;

alter table inventory_count_imports
  add constraint inventory_count_imports_source_file_security_check check (
    (source_ciphertext is null and source_iv is null and source_auth_tag is null
      and source_key_version is null and source_retention_until is null
      and (
        (source_content_type is null and source_size_bytes is null and source_deleted_at is null)
        or (source_content_type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          and source_size_bytes between 1 and 2000000 and source_deleted_at is not null)
      ))
    or (
      source_ciphertext is not null
      and source_content_type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      and source_size_bytes between 1 and 2000000
      and octet_length(source_ciphertext) = source_size_bytes
      and octet_length(source_iv) = 12
      and octet_length(source_auth_tag) = 16
      and btrim(source_key_version) <> ''
      and source_retention_until is not null
      and source_deleted_at is null
    )
  );

create index inventory_count_imports_source_retention_idx
  on inventory_count_imports (source_retention_until, id)
  where source_ciphertext is not null;

create table inventory_count_source_access_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  import_id uuid not null,
  actor_id uuid references user_profiles(id) on delete restrict,
  action varchar(32) not null check (action in ('download', 'retention_delete')),
  created_at timestamptz not null default now(),
  constraint inventory_count_source_access_actor_check check (
    (action = 'retention_delete' and actor_id is null)
    or (action = 'download' and actor_id is not null)
  ),
  constraint inventory_count_source_access_import_fk
    foreign key (company_id, import_id) references inventory_count_imports(company_id, id) on delete cascade
);

create index inventory_count_source_access_events_lookup_idx
  on inventory_count_source_access_events (company_id, import_id, created_at desc, id);

comment on column inventory_count_imports.source_ciphertext is
  'AES-256-GCM encrypted XLSX evidence. Metadata remains after bounded-retention erasure.';
comment on table inventory_count_source_access_events is
  'Append-only audit for decrypted downloads and automatic retention erasure.';
