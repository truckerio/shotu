set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table inspection_print_integrity_acceptances (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  inspection_id uuid not null,
  archive_id uuid not null,
  legacy_format text not null check (legacy_format = 'completed_at_date_empty_object_v1'),
  stored_snapshot_sha256 char(64) not null check (stored_snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  canonical_snapshot_sha256 char(64) not null check (canonical_snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  accepted_by_user_id uuid not null references user_profiles(id) on delete restrict,
  accepted_at timestamptz not null default now(),
  constraint inspection_print_integrity_archive_fk
    foreign key (company_id, inspection_id, archive_id)
    references inspection_print_archives(company_id, inspection_id, id) on delete restrict,
  unique (company_id, archive_id, legacy_format)
);

create index inspection_print_integrity_acceptances_scope_idx
  on inspection_print_integrity_acceptances(company_id, inspection_id, accepted_at desc);

create function protect_inspection_print_integrity_acceptance()
returns trigger language plpgsql as $$ begin
  raise exception 'Inspection print integrity acceptances are immutable.' using errcode = '55000';
end; $$;

create trigger inspection_print_integrity_acceptances_append_only
  before update or delete on inspection_print_integrity_acceptances
  for each row execute function protect_inspection_print_integrity_acceptance();
