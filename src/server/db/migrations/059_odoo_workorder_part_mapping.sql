set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table odoo_product_mappings add column if not exists default_code text not null default '';
alter table odoo_product_mappings add column if not exists display_name text not null default '';

create table if not exists odoo_workorder_part_mappings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  workorder_id uuid not null,
  line_index integer not null check (line_index >= 0),
  catalog_part_id uuid not null,
  product_external_id text not null,
  confirmed_by_user_id uuid not null references user_profiles(id) on delete restrict,
  confirmed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint odoo_workorder_part_mapping_workorder_company_fkey
    foreign key (company_id, workorder_id)
    references operational_workorders(company_id, id)
    on delete cascade,
  constraint odoo_workorder_part_mapping_catalog_company_fkey
    foreign key (company_id, catalog_part_id)
    references parts_catalog(company_id, id)
    on delete cascade,
  constraint odoo_workorder_part_mapping_product_company_fkey
    foreign key (company_id, product_external_id)
    references odoo_product_mappings(company_id, external_id)
    on delete restrict,
  unique (company_id, workorder_id, line_index)
);

comment on table odoo_workorder_part_mappings is
  'Explicit Workorder-line choice when multiple active Odoo products share one canonical catalog part.';
