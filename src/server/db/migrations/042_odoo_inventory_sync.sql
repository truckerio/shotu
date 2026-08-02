set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table if not exists odoo_inventory_locations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  external_id text not null,
  display_name text not null,
  complete_name text not null default '',
  warehouse_name text not null default '',
  active boolean not null default true,
  app_location_id uuid references locations(id),
  mapping_status text not null default 'unmatched'
    check (mapping_status in ('unmatched', 'mapped', 'ignored')),
  provider_updated_at timestamptz,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint odoo_inventory_locations_mapping_check check (
    (mapping_status = 'mapped' and app_location_id is not null)
    or (mapping_status <> 'mapped' and app_location_id is null)
  ),
  unique (company_id, external_id)
);

create index if not exists odoo_inventory_locations_review_idx
  on odoo_inventory_locations(company_id, mapping_status, display_name);

alter table parts_catalog add column if not exists source_provider text not null default '';
alter table parts_catalog add column if not exists external_id text not null default '';
alter table parts_catalog add column if not exists barcode text not null default '';
alter table parts_catalog add column if not exists provider_updated_at timestamptz;
alter table parts_catalog add column if not exists last_seen_at timestamptz;

create unique index if not exists parts_catalog_provider_external_uidx
  on parts_catalog(company_id, source_provider, external_id)
  where source_provider <> '' and external_id <> '';

alter table inventory_items add column if not exists source_provider text not null default '';
alter table inventory_items add column if not exists external_id text not null default '';
alter table inventory_items add column if not exists provider_updated_at timestamptz;
alter table inventory_items add column if not exists last_seen_at timestamptz;

create unique index if not exists inventory_items_provider_external_uidx
  on inventory_items(company_id, source_provider, external_id)
  where source_provider <> '' and external_id <> '';

comment on table odoo_inventory_locations is
  'Odoo stock locations discovered by immutable external ID. Admins explicitly map or ignore each location.';
comment on column inventory_items.external_id is
  'Provider-owned inventory identity. Odoo uses product and stock-location IDs so repeated syncs update one balance.';
