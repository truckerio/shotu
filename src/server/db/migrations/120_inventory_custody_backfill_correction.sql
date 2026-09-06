set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Deterministic compatibility projection only. No balance, event, bin,
-- evidence, receipt, or ownership fact is manufactured by this backfill.
with projection as (
  select unit.id,
    (select usage.asset_id from workorder_serialized_part_usages usage where usage.company_id=unit.company_id and usage.unit_id=unit.id and usage.status in ('installed','installed_pending_approval') order by usage.updated_at desc limit 1) as active_asset_id,
    (select c.status from inventory_reuse_cases c where c.company_id=unit.company_id and c.unit_id=unit.id and c.status not in ('released','core_returned','scrapped') order by c.updated_at desc limit 1) as open_case_status
  from inventory_serialized_units unit where unit.condition_code='unknown'
)
update inventory_serialized_units unit
set custody_holder_type=case when projection.active_asset_id is not null then 'asset' when unit.status='scrapped' then 'disposed' when projection.open_case_status='awaiting_handoff' then 'handoff' when unit.status in ('in_stock','reserved') then 'inventory_location' else 'unknown' end,
    custody_asset_id=projection.active_asset_id,
    custody_location_id=case when projection.active_asset_id is not null or unit.status='scrapped' then null when projection.open_case_status='awaiting_handoff' then unit.location_id when unit.status in ('in_stock','reserved') then unit.location_id else null end,
    custody_bin_location=null,custody_external_reference=null,
    custody_legacy_available=case when unit.status in ('in_stock','reserved') then true else false end
from projection where unit.id=projection.id;
