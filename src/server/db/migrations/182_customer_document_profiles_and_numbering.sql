set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table customer_document_profiles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete restrict,
  location_id uuid,
  current_version_id uuid,
  created_by_user_id uuid not null references user_profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint customer_document_profile_location_fk
    foreign key (company_id, location_id) references locations(company_id, id) on delete restrict,
  unique (company_id, id)
);

create unique index customer_document_profile_company_default_uidx
  on customer_document_profiles(company_id)
  where location_id is null;

create unique index customer_document_profile_location_uidx
  on customer_document_profiles(company_id, location_id)
  where location_id is not null;

create table customer_document_profile_versions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete restrict,
  profile_id uuid not null,
  version bigint not null check (version > 0),
  previous_version_id uuid,
  shop_identity jsonb not null check (jsonb_typeof(shop_identity) = 'object'),
  document_terms jsonb not null check (jsonb_typeof(document_terms) = 'object'),
  authorization_text text not null check (char_length(btrim(authorization_text)) between 2 and 10000),
  discount_policy jsonb not null check (jsonb_typeof(discount_policy) = 'object'),
  default_currency varchar(3) not null check (
    default_currency ~ '^[A-Z]{3}$' and default_currency not in ('UNK', 'XXX', 'ZZZ')
  ),
  tax_profile_version_id uuid not null,
  published_by_user_id uuid not null references user_profiles(id) on delete restrict,
  published_at timestamptz not null default now(),
  idempotency_key varchar(160) not null check (char_length(idempotency_key) between 8 and 160),
  request_hash char(64) not null check (request_hash ~ '^[0-9a-f]{64}$'),
  constraint customer_document_profile_version_profile_fk
    foreign key (company_id, profile_id)
    references customer_document_profiles(company_id, id) on delete restrict,
  constraint customer_document_profile_version_previous_fk
    foreign key (company_id, profile_id, previous_version_id)
    references customer_document_profile_versions(company_id, profile_id, id) on delete restrict,
  constraint customer_document_profile_version_tax_fk
    foreign key (company_id, tax_profile_version_id)
    references inventory_tax_profile_versions(company_id, id) on delete restrict,
  unique (company_id, id),
  unique (company_id, profile_id, id),
  unique (company_id, profile_id, version),
  unique (company_id, published_by_user_id, idempotency_key)
);

alter table customer_document_profiles
  add constraint customer_document_profile_current_version_fk
  foreign key (company_id, id, current_version_id)
  references customer_document_profile_versions(company_id, profile_id, id) on delete restrict;

create index customer_document_profile_version_history_idx
  on customer_document_profile_versions(company_id, profile_id, version desc);

create or replace function protect_customer_document_profile_version()
returns trigger language plpgsql as $$
begin
  raise exception 'Published customer document profile versions are immutable.' using errcode = '55000';
end;
$$;

create trigger customer_document_profile_version_immutable
before update or delete on customer_document_profile_versions
for each row execute function protect_customer_document_profile_version();

create or replace function guard_customer_document_profile_pointer()
returns trigger language plpgsql as $$
declare next_version bigint;
declare current_version bigint;
begin
  if tg_op = 'DELETE' then
    raise exception 'Customer document profiles cannot be deleted.' using errcode = '55000';
  end if;
  if new.company_id is distinct from old.company_id
    or new.location_id is distinct from old.location_id
    or new.created_by_user_id is distinct from old.created_by_user_id
    or new.created_at is distinct from old.created_at then
    raise exception 'Customer document profile identity is immutable.' using errcode = '55000';
  end if;
  if new.current_version_id is not distinct from old.current_version_id then return new; end if;
  select version into next_version
  from customer_document_profile_versions
  where company_id = new.company_id and profile_id = new.id and id = new.current_version_id;
  if old.current_version_id is null then
    if next_version <> 1 then
      raise exception 'The first customer document profile version must be version 1.' using errcode = '23514';
    end if;
    return new;
  end if;
  select version into current_version
  from customer_document_profile_versions
  where company_id = old.company_id and profile_id = old.id and id = old.current_version_id;
  if next_version <> current_version + 1 then
    raise exception 'Customer document profile versions must advance by one.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger customer_document_profile_pointer_guard
before update or delete on customer_document_profiles
for each row execute function guard_customer_document_profile_pointer();

create table customer_document_number_series (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete restrict,
  document_type varchar(16) not null check (document_type in ('estimate', 'invoice')),
  prefix varchar(20) not null check (char_length(prefix) between 1 and 20),
  digits smallint not null default 6 check (digits between 4 and 12),
  next_number bigint not null default 1 check (next_number > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, document_type),
  unique (company_id, id),
  unique (company_id, id, document_type)
);

comment on table customer_document_profiles is
  'Company default or location override aggregate. Published versions are immutable and future-only.';
comment on table customer_document_number_series is
  'Permanent company-scoped independent Estimate and Invoice counters. Numbers never reset or return to the pool.';
