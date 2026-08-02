set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table if not exists odoo_product_mappings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  external_id text not null,
  catalog_part_id uuid not null,
  barcode text not null default '',
  active boolean not null default true,
  provider_updated_at timestamptz,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint odoo_product_mappings_catalog_company_fkey
    foreign key (company_id, catalog_part_id)
    references parts_catalog(company_id, id)
    on delete cascade,
  unique (company_id, external_id)
);

create index if not exists odoo_product_mappings_catalog_idx
  on odoo_product_mappings(company_id, catalog_part_id);

comment on table odoo_product_mappings is
  'Stable Odoo product.product identity mapped to company catalog memory independently of mutable SKU text.';
