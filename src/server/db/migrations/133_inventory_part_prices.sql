set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table inventory_part_price_versions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  catalog_part_id uuid not null,
  price_kind varchar(16) not null check (price_kind in ('internal', 'selling')),
  version bigint not null check (version > 0),
  amount numeric(14, 4) check (amount is null or amount >= 0),
  currency varchar(3) check (currency is null or currency ~ '^[A-Z]{3}$'),
  previous_version_id uuid,
  effective_at timestamptz not null default now(),
  reason varchar(500) not null check (char_length(btrim(reason)) between 2 and 500),
  created_by uuid not null references user_profiles(id) on delete restrict,
  idempotency_key varchar(120) not null check (char_length(idempotency_key) between 8 and 120),
  request_hash char(64) not null check (request_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  constraint inventory_part_price_amount_currency check (
    (amount is null and currency is null) or (amount is not null and currency is not null)
  ),
  constraint inventory_part_price_catalog_fk
    foreign key (company_id, catalog_part_id) references parts_catalog(company_id, id) on delete cascade,
  constraint inventory_part_price_previous_fk
    foreign key (company_id, previous_version_id) references inventory_part_price_versions(company_id, id) on delete restrict,
  unique (company_id, id),
  unique (company_id, catalog_part_id, price_kind, version),
  unique (company_id, created_by, idempotency_key)
);

create index inventory_part_price_current_idx
  on inventory_part_price_versions (company_id, catalog_part_id, price_kind, version desc);

comment on table inventory_part_price_versions is
  'Append-only configured internal and selling prices. A null amount is an explicit change back to Unknown; zero is a known price.';
