set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- 116 was deliberately additive.  Reconcile rows that existed before its
-- projection fields were populated without inventing a condition or evidence.
update inventory_serialized_units unit
set condition_code='unknown', custody_legacy_available=true,
    custody_holder_type=case when exists(select 1 from workorder_serialized_part_usages usage where usage.company_id=unit.company_id and usage.unit_id=unit.id and usage.status in ('installed','installed_pending_approval')) then 'asset' else 'inventory_location' end,
    custody_asset_id=(select usage.asset_id from workorder_serialized_part_usages usage where usage.company_id=unit.company_id and usage.unit_id=unit.id and usage.status in ('installed','installed_pending_approval') order by usage.updated_at desc limit 1),
    custody_location_id=case when exists(select 1 from workorder_serialized_part_usages usage where usage.company_id=unit.company_id and usage.unit_id=unit.id and usage.status in ('installed','installed_pending_approval')) then null else unit.location_id end
where unit.condition_code='unknown' and unit.custody_legacy_available=false;
