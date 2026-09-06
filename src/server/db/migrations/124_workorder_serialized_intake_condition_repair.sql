set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Workorder detail intake previously accepted only physical-presence evidence,
-- so post-custody-migration units were stored as unknown and hidden from the
-- same workorder picker. Preserve that factual condition and apply the existing
-- compatibility flag only to confirmed, in-stock local serialization receipts.
update inventory_serialized_units unit
set custody_legacy_available = true
from inventory_receipts receipt
join inventory_serialization_batches batch
  on batch.company_id = receipt.company_id
 and batch.id = receipt.serialization_batch_id
where receipt.company_id = unit.company_id
  and receipt.id = unit.receipt_id
  and receipt.provider = 'local_serialization'
  and batch.physical_confirmation = 'physically_present_at_location'
  and unit.condition_code = 'unknown'
  and unit.custody_legacy_available = false
  and unit.status = 'in_stock'
  and unit.custody_holder_type = 'inventory_location'
  and unit.custody_location_id = unit.location_id;
