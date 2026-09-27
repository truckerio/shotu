set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table inventory_aggregate_cost_layer_positions (
  company_id uuid not null references companies(id) on delete cascade,
  cost_layer_id uuid not null,
  location_id uuid not null,
  position_id uuid not null,
  quantity_on_hand numeric(18,3) not null check (quantity_on_hand >= 0),
  quantity_reserved numeric(18,3) not null default 0
    check (quantity_reserved >= 0 and quantity_reserved <= quantity_on_hand),
  version bigint not null default 1 check (version > 0),
  updated_at timestamptz not null default now(),
  primary key(company_id,cost_layer_id,position_id),
  constraint inventory_cost_layer_position_layer_fk foreign key(company_id,cost_layer_id)
    references inventory_aggregate_cost_layers(company_id,id) on delete restrict,
  constraint inventory_cost_layer_position_position_fk foreign key(company_id,location_id,position_id)
    references inventory_positions(company_id,location_id,id) on delete restrict
);

create index inventory_cost_layer_positions_pick_idx
  on inventory_aggregate_cost_layer_positions(company_id,location_id,position_id,cost_layer_id)
  where quantity_on_hand > quantity_reserved;

alter table inventory_aggregate_usage_cost_allocations
  add column position_id uuid,
  add constraint inventory_usage_cost_allocation_position_fk
    foreign key(company_id,position_id) references inventory_positions(company_id,id) on delete restrict;

-- Historical placement is exact when a stock scope has one live batch (which may
-- span several positions), or one occupied position (which may hold many batches).
-- Multi-batch / multi-position history stays unresolved instead of being guessed.
with live_layers as (
  select layer.*,
         count(*) over(partition by layer.company_id,layer.location_id,layer.catalog_part_id,layer.uom_code) layer_count
  from inventory_aggregate_cost_layers layer
  where layer.quantity_on_hand > 0
), live_positions as (
  select balance.*,
         count(*) over(partition by balance.company_id,balance.location_id,balance.catalog_part_id,balance.uom_code) position_count
  from inventory_position_balances balance
  where balance.quantity > 0
), exact_scopes as (
  select layer.company_id,layer.location_id,layer.catalog_part_id,layer.uom_code,
         max(layer.layer_count) layer_count,max(position.position_count) position_count,
         sum(distinct case when layer.layer_count=1 then layer.quantity_on_hand else 0 end) single_layer_quantity,
         sum(distinct case when position.position_count=1 then position.quantity else 0 end) single_position_quantity,
         max(case when layer.layer_count=1 then layer.quantity_on_hand end) only_layer_quantity,
         max(case when position.position_count=1 then position.quantity end) only_position_quantity
  from live_layers layer
  join live_positions position
    on position.company_id=layer.company_id and position.location_id=layer.location_id
   and position.catalog_part_id=layer.catalog_part_id and position.uom_code=layer.uom_code
  group by layer.company_id,layer.location_id,layer.catalog_part_id,layer.uom_code
), exact_pairs as (
  select layer.company_id,layer.id cost_layer_id,layer.location_id,position.position_id,
         case when scope.layer_count=1 then position.quantity else layer.quantity_on_hand end quantity_on_hand
  from live_layers layer
  join live_positions position
    on position.company_id=layer.company_id and position.location_id=layer.location_id
   and position.catalog_part_id=layer.catalog_part_id and position.uom_code=layer.uom_code
  join exact_scopes scope
    on scope.company_id=layer.company_id and scope.location_id=layer.location_id
   and scope.catalog_part_id=layer.catalog_part_id and scope.uom_code=layer.uom_code
  where (scope.layer_count=1 and scope.only_layer_quantity=(
           select sum(p.quantity) from live_positions p
           where p.company_id=scope.company_id and p.location_id=scope.location_id
             and p.catalog_part_id=scope.catalog_part_id and p.uom_code=scope.uom_code
         ))
     or (scope.position_count=1 and scope.only_position_quantity=(
           select sum(l.quantity_on_hand) from live_layers l
           where l.company_id=scope.company_id and l.location_id=scope.location_id
             and l.catalog_part_id=scope.catalog_part_id and l.uom_code=scope.uom_code
         ))
)
insert into inventory_aggregate_cost_layer_positions(
  company_id,cost_layer_id,location_id,position_id,quantity_on_hand
)
select company_id,cost_layer_id,location_id,position_id,quantity_on_hand
from exact_pairs;

comment on table inventory_aggregate_cost_layer_positions is
  'Exact current physical placement of aggregate receipt-cost batches. Missing rows mean historical placement is unresolved, never inferred.';
comment on column inventory_aggregate_usage_cost_allocations.position_id is
  'Physical pickup position used for this cost-layer allocation when exact batch placement was available.';
