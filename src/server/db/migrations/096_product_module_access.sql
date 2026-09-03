set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table product_module_access_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  location_id uuid,
  subject_type text not null check (subject_type in ('role', 'user')),
  role_key text,
  user_id uuid references user_profiles(id) on delete cascade,
  module_key text not null check (module_key in ('workorders', 'inspections')),
  access_mode text not null check (access_mode in ('off', 'read', 'full')),
  version bigint not null default 1 check (version > 0),
  updated_by_user_id uuid not null references user_profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_module_access_scope_fk
    foreign key (location_id, company_id) references locations(id, company_id) on delete cascade,
  constraint product_module_access_subject_shape check (
    (subject_type = 'role' and role_key in ('mechanic', 'office', 'surveillance', 'admin') and user_id is null)
    or (subject_type = 'user' and role_key is null and user_id is not null)
  )
);

create unique index product_module_access_company_role_uidx
  on product_module_access_rules(company_id, role_key, module_key)
  where location_id is null and subject_type = 'role';
create unique index product_module_access_location_role_uidx
  on product_module_access_rules(company_id, location_id, role_key, module_key)
  where location_id is not null and subject_type = 'role';
create unique index product_module_access_company_user_uidx
  on product_module_access_rules(company_id, user_id, module_key)
  where location_id is null and subject_type = 'user';
create unique index product_module_access_location_user_uidx
  on product_module_access_rules(company_id, location_id, user_id, module_key)
  where location_id is not null and subject_type = 'user';

create index product_module_access_resolve_idx
  on product_module_access_rules(company_id, location_id, module_key, subject_type);

create table product_module_access_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  location_id uuid,
  rule_id uuid references product_module_access_rules(id) on delete set null,
  actor_id uuid not null references user_profiles(id) on delete restrict,
  action text not null check (action in ('created', 'updated', 'removed')),
  before_value jsonb,
  after_value jsonb,
  created_at timestamptz not null default now(),
  constraint product_module_access_event_scope_fk
    foreign key (location_id, company_id) references locations(id, company_id) on delete cascade
);

comment on table product_module_access_rules is
  'Sparse company/location and role/user product access. Missing workorders rules retain compatibility full; missing inspections rules resolve off.';
