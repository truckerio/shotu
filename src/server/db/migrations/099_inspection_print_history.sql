set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table service_history_orders add column inspection_id uuid;
alter table service_history_orders add constraint service_history_order_inspection_fk
  foreign key (company_id, inspection_id) references inspections(company_id, id) on delete restrict;
create unique index service_history_local_inspection_uidx
  on service_history_orders(company_id, inspection_id)
  where source_provider = 'local_inspection' and inspection_id is not null;

create table inspection_print_archives (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  inspection_id uuid not null,
  location_id uuid not null,
  inspection_number text not null,
  artifact_kind text not null check (artifact_kind in ('original', 'revised')),
  revision_number integer not null check (revision_number > 0),
  predecessor_archive_id uuid,
  revision_reason text not null default '',
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  snapshot_sha256 char(64) not null check (snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  pdf_sha256 char(64) check (pdf_sha256 is null or pdf_sha256 ~ '^[0-9a-f]{64}$'),
  pdf_byte_size bigint check (pdf_byte_size is null or pdf_byte_size > 0),
  storage_key text,
  status text not null default 'pending' check (status in ('pending', 'ready', 'failed')),
  created_by_user_id uuid not null references user_profiles(id) on delete restrict,
  idempotency_key varchar(120) not null check (char_length(idempotency_key) between 8 and 120),
  request_sha256 char(64) not null check (request_sha256 ~ '^[0-9a-f]{64}$'),
  attempt_number integer not null default 1 check (attempt_number > 0),
  lease_token uuid not null default gen_random_uuid(),
  lease_expires_at timestamptz not null default (now() + interval '2 minutes'),
  created_at timestamptz not null default now(),
  generated_at timestamptz,
  constraint inspection_print_inspection_fk foreign key (company_id, inspection_id) references inspections(company_id, id) on delete restrict,
  constraint inspection_print_location_fk foreign key (location_id, company_id) references locations(id, company_id) on delete restrict,
  constraint inspection_print_predecessor_fk foreign key (company_id, inspection_id, predecessor_archive_id) references inspection_print_archives(company_id, inspection_id, id) on delete restrict,
  constraint inspection_print_revision_shape check (
    (artifact_kind = 'original' and revision_number = 1 and predecessor_archive_id is null and revision_reason = '')
    or (artifact_kind = 'revised' and revision_number > 1 and predecessor_archive_id is not null and btrim(revision_reason) <> '')
  ),
  constraint inspection_print_ready_shape check (
    (status in ('pending', 'failed') and pdf_sha256 is null and pdf_byte_size is null and storage_key is null and generated_at is null)
    or (status = 'ready' and pdf_sha256 is not null and pdf_byte_size is not null and storage_key is not null and generated_at is not null)
  ),
  unique (company_id, inspection_id, id),
  unique (company_id, inspection_id, revision_number),
  unique (company_id, created_by_user_id, idempotency_key)
);
create index inspection_print_scope_idx on inspection_print_archives(company_id, location_id, inspection_id, revision_number desc);

create or replace function protect_inspection_print_archive()
returns trigger language plpgsql as $$ begin
  if tg_op = 'DELETE' or old.status = 'ready' then
    raise exception 'Inspection print archives are immutable.' using errcode = '55000';
  end if;
  if row(new.id,new.company_id,new.inspection_id,new.location_id,new.inspection_number,new.artifact_kind,
      new.revision_number,new.predecessor_archive_id,new.revision_reason,new.snapshot,new.snapshot_sha256,
      new.created_by_user_id,new.idempotency_key,new.request_sha256,new.created_at)
    is distinct from row(old.id,old.company_id,old.inspection_id,old.location_id,old.inspection_number,old.artifact_kind,
      old.revision_number,old.predecessor_archive_id,old.revision_reason,old.snapshot,old.snapshot_sha256,
      old.created_by_user_id,old.idempotency_key,old.request_sha256,old.created_at) then
    raise exception 'Inspection print archive evidence is immutable.' using errcode = '55000';
  end if;
  return new;
end; $$;
create trigger inspection_print_archive_immutable before update or delete on inspection_print_archives for each row execute function protect_inspection_print_archive();
