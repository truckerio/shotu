set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table inventory_tax_profiles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  current_version_id uuid,
  created_at timestamptz not null default now(),
  unique (company_id, id)
);

create table inventory_tax_profile_versions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  profile_id uuid not null,
  version bigint not null check (version > 0),
  name varchar(120) not null check (char_length(btrim(name)) between 2 and 120),
  currency varchar(3) not null check (currency ~ '^[A-Z]{3}$' and currency not in ('UNK', 'XXX', 'ZZZ')),
  jurisdiction varchar(160) not null check (char_length(btrim(jurisdiction)) between 2 and 160),
  components jsonb not null,
  state varchar(16) not null check (state in ('active', 'archived')),
  previous_version_id uuid,
  effective_at timestamptz not null default now(),
  reason varchar(500) not null check (char_length(btrim(reason)) between 2 and 500),
  created_by uuid not null references user_profiles(id) on delete restrict,
  idempotency_key varchar(120) not null check (char_length(idempotency_key) between 8 and 120),
  request_hash char(64) not null check (request_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  constraint inventory_tax_profile_identity_fk
    foreign key (company_id, profile_id) references inventory_tax_profiles(company_id, id) on delete cascade,
  constraint inventory_tax_profile_previous_fk
    foreign key (company_id, profile_id, previous_version_id) references inventory_tax_profile_versions(company_id, profile_id, id) on delete restrict,
  constraint inventory_tax_profile_components_shape check (
    jsonb_typeof(components) = 'array'
    and jsonb_array_length(components) between 1 and 5
  ),
  unique (company_id, id),
  unique (company_id, profile_id, id),
  unique (company_id, profile_id, version),
  unique (company_id, created_by, idempotency_key)
);

alter table inventory_tax_profiles
  add constraint inventory_tax_profiles_current_version_fk
  foreign key (company_id, id, current_version_id)
  references inventory_tax_profile_versions(company_id, profile_id, id) on delete restrict;

create index inventory_tax_profile_versions_history_idx
  on inventory_tax_profile_versions(company_id, profile_id, version desc);

alter table inventory_part_price_versions
  add column tax_treatment varchar(24) not null default 'legacy_unknown',
  add column tax_profile_version_id uuid;

update inventory_part_price_versions
set tax_treatment = 'not_configured'
where amount is null;

alter table inventory_part_price_versions
  alter column tax_treatment drop default,
  add constraint inventory_part_price_tax_treatment_check check (
    tax_treatment in ('legacy_unknown', 'not_configured', 'exclusive', 'inclusive', 'zero_rated', 'exempt', 'out_of_scope')
  ),
  add constraint inventory_part_price_tax_profile_shape check (
    (tax_treatment in ('exclusive', 'inclusive') and tax_profile_version_id is not null)
    or (tax_treatment not in ('exclusive', 'inclusive') and tax_profile_version_id is null)
  ),
  add constraint inventory_part_price_unknown_tax_check check (
    amount is not null or tax_treatment = 'not_configured'
  ),
  add constraint inventory_part_price_tax_profile_fk
    foreign key (company_id, tax_profile_version_id)
    references inventory_tax_profile_versions(company_id, id) on delete restrict;

create or replace function validate_inventory_tax_profile_components()
returns trigger language plpgsql as $$
declare component jsonb;
begin
  for component in select value from jsonb_array_elements(new.components)
  loop
    if jsonb_typeof(component) <> 'object'
      or not (component ? 'name' and component ? 'rate' and component ? 'compound')
      or jsonb_typeof(component->'name') <> 'string'
      or char_length(btrim(component->>'name')) not between 2 and 80
      or jsonb_typeof(component->'rate') <> 'string'
      or (component->>'rate') !~ '^(?:0|[1-9][0-9]?|100)(?:\.[0-9]{1,4})?$'
      or (component->>'rate')::numeric < 0
      or (component->>'rate')::numeric > 100
      or jsonb_typeof(component->'compound') <> 'boolean'
      or (select count(*) from jsonb_object_keys(component)) <> 3
    then
      raise exception 'Invalid inventory tax profile component.' using errcode = '23514';
    end if;
  end loop;
  return new;
end $$;

create trigger inventory_tax_profile_components_guard
before insert or update of components on inventory_tax_profile_versions
for each row execute function validate_inventory_tax_profile_components();

create or replace function prevent_inventory_tax_profile_version_update()
returns trigger language plpgsql as $$
begin
  raise exception 'Inventory tax profile versions are immutable.' using errcode = '55000';
end $$;

create trigger inventory_tax_profile_versions_immutable
before update on inventory_tax_profile_versions
for each row execute function prevent_inventory_tax_profile_version_update();

create or replace function validate_inventory_part_price_tax_profile()
returns trigger language plpgsql as $$
declare profile_currency text;
declare profile_state text;
declare current_version_id uuid;
begin
  if new.tax_profile_version_id is null then return new; end if;
  select version.currency, version.state, profile.current_version_id
    into profile_currency, profile_state, current_version_id
  from inventory_tax_profile_versions version
  join inventory_tax_profiles profile
    on profile.company_id = version.company_id and profile.id = version.profile_id
  where version.company_id = new.company_id and version.id = new.tax_profile_version_id
  for share of profile, version;
  if profile_currency is null
    or profile_currency <> new.currency
    or profile_state <> 'active'
    or current_version_id <> new.tax_profile_version_id
  then
    raise exception 'Inventory price tax profile must be the current active version in the same currency.' using errcode = '23514';
  end if;
  return new;
end $$;

create trigger inventory_part_price_tax_profile_guard
before insert or update of tax_treatment, tax_profile_version_id, currency
on inventory_part_price_versions
for each row execute function validate_inventory_part_price_tax_profile();

comment on table inventory_tax_profile_versions is
  'Immutable company tax configuration versions for pricing previews. These records do not post accounting or infer jurisdiction rules.';
comment on column inventory_part_price_versions.tax_treatment is
  'Explicit tax treatment captured with each configured price. legacy_unknown is reserved for migration 135 backfill.';
