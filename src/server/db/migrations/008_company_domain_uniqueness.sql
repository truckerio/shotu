drop index if exists parts_catalog_company_uuid_part_idx;
create unique index if not exists parts_catalog_company_uuid_part_uidx
  on parts_catalog(company_uuid, normalized_part_number);

create unique index if not exists inventory_items_company_uuid_location_part_uidx
  on inventory_items(
    company_uuid,
    coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid),
    normalized_part_number
  );
