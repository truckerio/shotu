create table if not exists local_labor_products (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  name text not null,
  normalized_name text not null,
  code text not null default '',
  normalized_code text not null default '',
  uom_code text not null default 'hr' check (uom_code = 'hr'),
  active boolean not null default true,
  created_by_user_id uuid references user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, id)
);

create unique index if not exists local_labor_products_company_name_uidx
  on local_labor_products (company_id, normalized_name);
create unique index if not exists local_labor_products_company_code_uidx
  on local_labor_products (company_id, normalized_code)
  where normalized_code <> '';
create index if not exists local_labor_products_search_idx
  on local_labor_products (company_id, active, normalized_name, normalized_code);

create table if not exists local_labor_product_location_pins (
  company_id uuid not null,
  location_id uuid not null,
  labor_product_id uuid not null,
  pinned boolean not null default true,
  updated_by_user_id uuid references user_profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (company_id, location_id, labor_product_id),
  foreign key (company_id, location_id) references locations(company_id, id) on delete cascade,
  foreign key (company_id, labor_product_id) references local_labor_products(company_id, id) on delete cascade
);
