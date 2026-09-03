set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table template_definitions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete restrict,
  family_key text not null,
  applicability_key text not null,
  name text not null check (btrim(name) <> '' and char_length(name) <= 200),
  preset_key text not null default '',
  status text not null default 'active' check (status in ('active', 'archived')),
  created_by_user_id uuid not null references user_profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, family_key, applicability_key, name)
);

create table template_versions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  template_id uuid not null,
  version_number integer not null check (version_number > 0),
  state text not null default 'draft' check (state in ('draft', 'published', 'archived')),
  optimistic_version bigint not null default 1 check (optimistic_version > 0),
  family_schema_version integer not null check (family_schema_version > 0),
  renderer_version text not null check (btrim(renderer_version) <> ''),
  definition jsonb not null check (
    jsonb_typeof(definition) = 'object'
    and octet_length(definition::text) <= 262144
  ),
  definition_sha256 char(64) not null check (definition_sha256 ~ '^[0-9a-f]{64}$'),
  published_by_user_id uuid references user_profiles(id) on delete restrict,
  published_at timestamptz,
  created_by_user_id uuid not null references user_profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint template_versions_definition_fk
    foreign key (company_id, template_id) references template_definitions(company_id, id) on delete restrict,
  constraint template_versions_publish_shape check (
    (state = 'draft' and published_at is null and published_by_user_id is null)
    or (state in ('published', 'archived') and published_at is not null and published_by_user_id is not null)
  ),
  unique (company_id, id),
  unique (company_id, template_id, version_number)
);

create unique index template_versions_one_draft_uidx
  on template_versions(company_id, template_id) where state = 'draft';

create table template_assignments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete restrict,
  location_id uuid,
  family_key text not null,
  applicability_key text not null,
  template_version_id uuid not null,
  version bigint not null default 1 check (version > 0),
  updated_by_user_id uuid not null references user_profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint template_assignment_location_fk
    foreign key (location_id, company_id) references locations(id, company_id) on delete cascade,
  constraint template_assignment_version_fk
    foreign key (company_id, template_version_id) references template_versions(company_id, id) on delete restrict,
  unique (company_id, id)
);

create unique index template_assignments_company_default_uidx
  on template_assignments(company_id, family_key, applicability_key) where location_id is null;
create unique index template_assignments_location_override_uidx
  on template_assignments(company_id, location_id, family_key, applicability_key) where location_id is not null;

create table template_audit_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete restrict,
  template_id uuid,
  template_version_id uuid,
  assignment_id uuid,
  event_type text not null,
  actor_id uuid not null references user_profiles(id) on delete restrict,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create or replace function protect_published_template_version()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Template versions cannot be deleted.' using errcode = '55000';
  end if;
  if old.state <> 'draft' and row(new.definition, new.definition_sha256, new.family_schema_version,
      new.renderer_version, new.template_id, new.version_number, new.published_at, new.published_by_user_id)
    is distinct from row(old.definition, old.definition_sha256, old.family_schema_version,
      old.renderer_version, old.template_id, old.version_number, old.published_at, old.published_by_user_id) then
    raise exception 'Published template evidence is immutable.' using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger template_versions_immutable_trigger
before update or delete on template_versions
for each row execute function protect_published_template_version();
