set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Asset Service History includes confirmed service orders whose Odoo
-- effective_date may be empty. Keep recorded and scheduled evidence distinct,
-- but index the same completed -> recorded -> scheduled order used by the read
-- model so a confirmed service order can be shown without calling it completed.
drop index if exists service_history_orders_unit_timeline_idx;

create index service_history_orders_unit_timeline_idx
  on service_history_orders(
    company_id,
    asset_id,
    (coalesce(completed_at, recorded_at, scheduled_at, ordered_at, source_updated_at)) desc,
    id desc
  )
  where asset_id is not null
    and (completed_at is not null or recorded_at is not null);

comment on index service_history_orders_unit_timeline_idx is
  'Supports exact-unit history ordered by completed evidence, then the Odoo service-order record date.';
