set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table workorder_print_archives (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete restrict,
  workorder_id uuid not null,
  location_id uuid not null,
  workorder_serial text not null,
  artifact_kind varchar(16) not null check (artifact_kind in ('original', 'revised')),
  revision_number integer not null check (revision_number > 0),
  predecessor_archive_id uuid,
  revision_reason text not null default '',
  snapshot jsonb not null,
  snapshot_sha256 char(64) not null check (snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  pdf_sha256 char(64) check (pdf_sha256 is null or pdf_sha256 ~ '^[0-9a-f]{64}$'),
  pdf_byte_size bigint check (pdf_byte_size is null or pdf_byte_size > 0),
  storage_key text,
  status varchar(16) not null default 'pending' check (status in ('pending', 'ready', 'failed')),
  created_by_user_id uuid not null references user_profiles(id) on delete restrict,
  idempotency_key varchar(120) not null check (char_length(idempotency_key) between 8 and 120),
  request_sha256 char(64) not null check (request_sha256 ~ '^[0-9a-f]{64}$'),
  attempt_number integer not null default 1 check (attempt_number > 0),
  lease_token uuid not null default gen_random_uuid(),
  lease_expires_at timestamptz not null default (now() + interval '2 minutes'),
  last_attempt_started_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  generated_at timestamptz,
  constraint workorder_print_archive_workorder_fk
    foreign key (company_id, workorder_id) references operational_workorders(company_id, id) on delete restrict,
  constraint workorder_print_archive_location_fk
    foreign key (company_id, location_id) references locations(company_id, id) on delete restrict,
  constraint workorder_print_archive_predecessor_fk
    foreign key (company_id, workorder_id, location_id, predecessor_archive_id)
      references workorder_print_archives(company_id, workorder_id, location_id, id) on delete restrict,
  constraint workorder_print_archive_revision_shape check (
    (artifact_kind = 'original' and revision_number = 1 and predecessor_archive_id is null and revision_reason = '')
    or
    (artifact_kind = 'revised' and revision_number > 1 and predecessor_archive_id is not null and btrim(revision_reason) <> '')
  ),
  constraint workorder_print_archive_ready_shape check (
    (status = 'pending' and pdf_sha256 is null and pdf_byte_size is null and storage_key is null and generated_at is null)
    or (status = 'ready' and pdf_sha256 is not null and pdf_byte_size is not null and storage_key is not null and generated_at is not null)
    or (status = 'failed' and pdf_sha256 is null and pdf_byte_size is null and storage_key is null and generated_at is null)
  ),
  unique (company_id, id),
  unique (company_id, workorder_id, location_id, id),
  unique (company_id, workorder_id, revision_number),
  constraint workorder_print_archive_actor_idempotency_key
    unique (company_id, created_by_user_id, idempotency_key)
);

create index workorder_print_archives_scope_idx
  on workorder_print_archives (company_id, location_id, workorder_id, revision_number desc);

create or replace function protect_workorder_print_archive()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Workorder print archives are immutable.' using errcode = '55000';
  end if;
  if old.status = 'ready'
    or (old.status = 'pending' and new.status not in ('pending', 'ready', 'failed'))
    or (old.status = 'failed' and new.status <> 'pending') then
    raise exception 'Workorder print archive state transition is not allowed.' using errcode = '55000';
  end if;
  if row(new.id, new.company_id, new.workorder_id, new.location_id, new.workorder_serial,
      new.artifact_kind, new.revision_number, new.predecessor_archive_id, new.revision_reason,
      new.snapshot, new.snapshot_sha256, new.created_by_user_id, new.idempotency_key,
      new.request_sha256, new.created_at)
    is distinct from
     row(old.id, old.company_id, old.workorder_id, old.location_id, old.workorder_serial,
      old.artifact_kind, old.revision_number, old.predecessor_archive_id, old.revision_reason,
      old.snapshot, old.snapshot_sha256, old.created_by_user_id, old.idempotency_key,
      old.request_sha256, old.created_at) then
    raise exception 'Workorder print archive evidence is immutable.' using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger workorder_print_archive_immutable_trigger
before update or delete on workorder_print_archives
for each row execute function protect_workorder_print_archive();

comment on table workorder_print_archives is
  'Immutable authorized workorder print snapshots and revision lineage. storage_key is server-internal and must never be returned by APIs.';
