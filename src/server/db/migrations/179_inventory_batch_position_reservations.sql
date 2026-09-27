set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Migration 178 can prove historical placement only for unambiguous stock.
-- Carry active historical Workorder reservations into that same exact position
-- when the physical usage itself selected exactly one position.
with exact_usage_positions as (
  select allocation.company_id,allocation.usage_id,
         (array_agg(allocation.position_id order by allocation.position_id))[1] position_id
  from inventory_aggregate_usage_position_allocations allocation
  where allocation.status in ('reserved','picked')
  group by allocation.company_id,allocation.usage_id
  having count(*)=1
), exact_allocations as (
  select cost.company_id,cost.usage_id,cost.cost_layer_id,physical.position_id
  from inventory_aggregate_usage_cost_allocations cost
  join exact_usage_positions physical
    on physical.company_id=cost.company_id and physical.usage_id=cost.usage_id
  join inventory_aggregate_cost_layer_positions placement
    on placement.company_id=cost.company_id and placement.cost_layer_id=cost.cost_layer_id
   and placement.position_id=physical.position_id
  where cost.position_id is null and cost.status in ('reserved','picked')
)
update inventory_aggregate_usage_cost_allocations cost
set position_id=exact.position_id,updated_at=now()
from exact_allocations exact
where cost.company_id=exact.company_id and cost.usage_id=exact.usage_id
  and cost.cost_layer_id=exact.cost_layer_id;

with reserved as (
  select allocation.company_id,allocation.cost_layer_id,allocation.position_id,
         sum(allocation.quantity) quantity
  from inventory_aggregate_usage_cost_allocations allocation
  where allocation.position_id is not null and allocation.status in ('reserved','picked')
  group by allocation.company_id,allocation.cost_layer_id,allocation.position_id
)
update inventory_aggregate_cost_layer_positions placement
set quantity_reserved=reserved.quantity,version=version+1,updated_at=now()
from reserved
where placement.company_id=reserved.company_id
  and placement.cost_layer_id=reserved.cost_layer_id
  and placement.position_id=reserved.position_id
  and reserved.quantity<=placement.quantity_on_hand;
