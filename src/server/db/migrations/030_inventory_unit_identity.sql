set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- The same catalog part may be stocked in multiple physical units at one
-- location. Unit is therefore part of inventory row identity.
drop index if exists inventory_items_company_location_part_uidx;

create unique index inventory_items_company_location_part_uom_uidx
  on inventory_items (
    company_id,
    coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid),
    normalized_part_number,
    uom_code
  );

comment on index inventory_items_company_location_part_uom_uidx is
  'One inventory balance per company, location, normalized part, and unit of measure.';
