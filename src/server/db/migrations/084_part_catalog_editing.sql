set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table parts_catalog add column if not exists version bigint not null default 1 check (version > 0);

create table part_reference_numbers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  catalog_part_id uuid not null,
  reference_number text not null check (btrim(reference_number) <> '' and char_length(reference_number) <= 200),
  normalized_reference_number text not null check (btrim(normalized_reference_number) <> '' and char_length(normalized_reference_number) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint part_reference_numbers_catalog_company_fk foreign key (company_id, catalog_part_id)
    references parts_catalog(company_id, id) on delete cascade,
  unique (company_id, normalized_reference_number),
  unique (company_id, catalog_part_id, normalized_reference_number)
);

create index part_reference_numbers_catalog_idx on part_reference_numbers(company_id, catalog_part_id, reference_number);
create index part_reference_numbers_normalized_prefix_idx on part_reference_numbers(company_id, normalized_reference_number text_pattern_ops);
create index part_reference_numbers_reference_trgm_idx on part_reference_numbers using gin (lower(reference_number) gin_trgm_ops);

create table part_catalog_edit_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  catalog_part_id uuid not null,
  actor_id uuid not null references user_profiles(id) on delete restrict,
  version_before bigint not null check (version_before > 0),
  version_after bigint not null check (version_after = version_before + 1),
  before_state jsonb not null check (jsonb_typeof(before_state) = 'object' and octet_length(before_state::text) <= 12000),
  after_state jsonb not null check (jsonb_typeof(after_state) = 'object' and octet_length(after_state::text) <= 12000),
  created_at timestamptz not null default now(),
  constraint part_catalog_edit_events_catalog_company_fk foreign key (company_id, catalog_part_id)
    references parts_catalog(company_id, id) on delete restrict
);

create index part_catalog_edit_events_lookup_idx on part_catalog_edit_events(company_id, catalog_part_id, created_at desc, id);
