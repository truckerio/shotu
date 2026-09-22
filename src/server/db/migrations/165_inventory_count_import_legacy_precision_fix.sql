set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Migration 164 preserved every legacy reviewed row by assigning system
-- Unassigned. Pending rows have not changed stock, so return them to review and
-- require an operator to select the real storage destination. Applied history
-- keeps its system Unassigned destination.
update inventory_count_import_lines
set match_status = 'position_required', target_position_id = null, updated_at = now()
where match_status = 'ready';

update inventory_count_imports stocktake
set ready_count = counts.ready_count,
    exception_count = counts.exception_count,
    applied_count = counts.applied_count,
    status = case
      when counts.applied_count > 0 and counts.remaining_count = 0 then 'applied'
      when counts.applied_count > 0 then 'partial'
      else 'draft'
    end,
    applied_at = case
      when counts.applied_count > 0 and counts.remaining_count = 0 then coalesce(stocktake.applied_at, now())
      else null
    end,
    version = stocktake.version + 1,
    updated_at = now()
from (
  select company_id, import_id,
         count(*) filter(where match_status='ready')::integer ready_count,
         count(*) filter(where match_status in ('unmatched','duplicate','invalid_quantity','position_required'))::integer exception_count,
         count(*) filter(where match_status='applied')::integer applied_count,
         count(*) filter(where match_status not in ('applied','ignored'))::integer remaining_count
  from inventory_count_import_lines group by company_id,import_id
) counts
where stocktake.company_id=counts.company_id and stocktake.id=counts.import_id;

comment on column inventory_count_import_lines.target_position_id is
  'Reviewed exact storage destination. Applied legacy rows retain system Unassigned history; pending legacy rows require destination review.';
