set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Substring matching is required by the type-ahead catalog. Trigram indexes keep
-- those searches indexable without maintaining a second search document.
create extension if not exists pg_trgm;

-- Older inventory rows predate durable catalog foreign keys. Company +
-- normalized part number is unique, so this repair is unambiguous.
update inventory_items inventory
set catalog_part_id = catalog.id,
    updated_at = now()
from parts_catalog catalog
where inventory.catalog_part_id is null
  and catalog.company_id = inventory.company_id
  and catalog.normalized_part_number = inventory.normalized_part_number
  and catalog.uom_code = inventory.uom_code;

create index if not exists parts_catalog_company_part_prefix_idx
  on parts_catalog(company_id, lower(part_number) text_pattern_ops);

create index if not exists parts_catalog_company_normalized_prefix_idx
  on parts_catalog(company_id, normalized_part_number text_pattern_ops);

create index if not exists parts_catalog_normalized_part_trgm_idx
  on parts_catalog using gin (normalized_part_number gin_trgm_ops);

create index if not exists parts_catalog_part_number_trgm_idx
  on parts_catalog using gin (lower(part_number) gin_trgm_ops);

create index if not exists parts_catalog_description_trgm_idx
  on parts_catalog using gin (lower(description) gin_trgm_ops);

create index if not exists parts_catalog_manufacturer_trgm_idx
  on parts_catalog using gin (lower(manufacturer) gin_trgm_ops);

create index if not exists parts_catalog_category_trgm_idx
  on parts_catalog using gin (lower(category) gin_trgm_ops);

create index if not exists parts_catalog_aliases_trgm_idx
  on parts_catalog using gin (lower(aliases::text) gin_trgm_ops);

create index if not exists odoo_product_mappings_company_barcode_prefix_idx
  on odoo_product_mappings(company_id, lower(barcode) text_pattern_ops)
  where barcode <> '';

create index if not exists odoo_product_mappings_barcode_trgm_idx
  on odoo_product_mappings using gin (lower(barcode) gin_trgm_ops)
  where barcode <> '';

create index if not exists inventory_items_catalog_location_lookup_idx
  on inventory_items(company_id, catalog_part_id, location_id, uom_code)
  include (id, quantity_on_hand, quantity_reserved, bin_location, updated_at)
  where catalog_part_id is not null;

comment on index inventory_items_catalog_location_lookup_idx is
  'Supports location-specific availability in company catalog type-ahead results.';
