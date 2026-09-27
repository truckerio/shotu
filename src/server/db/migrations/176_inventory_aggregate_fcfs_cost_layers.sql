set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table inventory_aggregate_cost_layers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  location_id uuid not null,
  catalog_part_id uuid not null,
  receipt_line_id uuid,
  source_kind varchar(24) not null check (source_kind in ('receipt','legacy_unassigned','reconciliation')),
  received_quantity numeric(18,3) not null check (received_quantity > 0),
  quantity_on_hand numeric(18,3) not null check (quantity_on_hand >= 0),
  quantity_reserved numeric(18,3) not null default 0 check (quantity_reserved >= 0 and quantity_reserved <= quantity_on_hand),
  uom_code text not null references units_of_measure(code),
  unit_cost numeric(14,4) check (unit_cost is null or unit_cost >= 0),
  currency varchar(3) check (currency is null or currency ~ '^[A-Z]{3}$'),
  cost_source varchar(24) not null default 'unknown',
  received_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1 check (version > 0),
  constraint inventory_aggregate_cost_layer_location_fk foreign key(company_id,location_id)
    references locations(company_id,id) on delete restrict,
  constraint inventory_aggregate_cost_layer_catalog_fk foreign key(company_id,catalog_part_id)
    references parts_catalog(company_id,id) on delete restrict,
  constraint inventory_aggregate_cost_layer_receipt_fk foreign key(company_id,receipt_line_id)
    references inventory_receipt_lines(company_id,id) on delete restrict,
  constraint inventory_aggregate_cost_layer_source_shape check (
    (source_kind='receipt' and receipt_line_id is not null)
    or (source_kind<>'receipt' and receipt_line_id is null)
  ),
  constraint inventory_aggregate_cost_layer_cost_shape check (
    (unit_cost is null and currency is null) or (unit_cost is not null and currency is not null)
  ),
  unique(company_id,id)
);

create unique index inventory_aggregate_cost_layer_receipt_unique
  on inventory_aggregate_cost_layers(company_id,receipt_line_id)
  where receipt_line_id is not null;
create index inventory_aggregate_cost_layer_fcfs_idx
  on inventory_aggregate_cost_layers(company_id,location_id,catalog_part_id,uom_code,received_at,id)
  where quantity_on_hand > quantity_reserved;

create table inventory_aggregate_usage_cost_allocations (
  company_id uuid not null references companies(id) on delete cascade,
  usage_id uuid not null,
  cost_layer_id uuid not null,
  quantity numeric(18,3) not null check (quantity > 0),
  status varchar(24) not null default 'reserved'
    check (status in ('reserved','picked','consumed','released','reversed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(company_id,usage_id,cost_layer_id),
  constraint inventory_aggregate_usage_cost_usage_fk foreign key(company_id,usage_id)
    references workorder_aggregate_part_usages(company_id,id) on delete restrict,
  constraint inventory_aggregate_usage_cost_layer_fk foreign key(company_id,cost_layer_id)
    references inventory_aggregate_cost_layers(company_id,id) on delete restrict
);

create index inventory_aggregate_usage_cost_layer_idx
  on inventory_aggregate_usage_cost_allocations(company_id,cost_layer_id,status);

create table workorder_part_price_snapshot_allocations (
  company_id uuid not null references companies(id) on delete cascade,
  snapshot_id uuid not null,
  cost_layer_id uuid not null,
  receipt_line_id uuid,
  quantity numeric(18,3) not null check (quantity > 0),
  unit_price numeric(14,4) not null check (unit_price >= 0),
  total_price numeric(18,4) not null check (total_price >= 0),
  currency varchar(3) not null check (currency ~ '^[A-Z]{3}$'),
  created_at timestamptz not null default now(),
  primary key(company_id,snapshot_id,cost_layer_id),
  constraint workorder_price_snapshot_allocation_snapshot_fk foreign key(company_id,snapshot_id)
    references workorder_part_price_snapshots(company_id,id) on delete restrict,
  constraint workorder_price_snapshot_allocation_layer_fk foreign key(company_id,cost_layer_id)
    references inventory_aggregate_cost_layers(company_id,id) on delete restrict,
  constraint workorder_price_snapshot_allocation_receipt_fk foreign key(company_id,receipt_line_id)
    references inventory_receipt_lines(company_id,id) on delete restrict
);

alter table workorder_part_price_snapshots
  drop constraint workorder_part_price_source_shape,
  add constraint workorder_part_price_source_shape check(
    (selection='batch_cost' and selling_policy_version_id is null
      and ((serialized_usage_id is not null and receipt_line_id is not null)
        or aggregate_usage_id is not null))
    or (selection='selling_price' and selling_policy_version_id is not null)
  );

insert into inventory_aggregate_cost_layers(
  company_id,location_id,catalog_part_id,source_kind,received_quantity,
  quantity_on_hand,quantity_reserved,uom_code,cost_source,received_at
)
select item.company_id,item.location_id,item.catalog_part_id,'legacy_unassigned',
       item.quantity_on_hand,item.quantity_on_hand,0,item.uom_code,'unknown',
       coalesce(item.last_seen_at,item.updated_at,now())
from inventory_items item
join parts_catalog catalog on catalog.company_id=item.company_id and catalog.id=item.catalog_part_id
where item.source_provider='local' and item.location_id is not null and item.quantity_on_hand>0
  and catalog.tracking_mode in ('quantity','measured_bulk');

insert into inventory_aggregate_usage_cost_allocations(company_id,usage_id,cost_layer_id,quantity,status)
select usage.company_id,usage.id,layer.id,usage.quantity+usage.adjustment_total,
       case when usage.status='installed_pending_approval' then 'picked' else 'reserved' end
from workorder_aggregate_part_usages usage
join inventory_aggregate_cost_layers layer
  on layer.company_id=usage.company_id and layer.location_id=usage.location_id
 and layer.catalog_part_id=usage.catalog_part_id and layer.uom_code=usage.uom_code
 and layer.source_kind='legacy_unassigned'
where usage.status in ('reserved','installed_pending_approval');

update inventory_aggregate_cost_layers layer
set quantity_reserved=allocation.quantity,updated_at=now(),version=version+1
from (
  select company_id,cost_layer_id,sum(quantity) quantity
  from inventory_aggregate_usage_cost_allocations
  where status in ('reserved','picked')
  group by company_id,cost_layer_id
) allocation
where layer.company_id=allocation.company_id and layer.id=allocation.cost_layer_id;

insert into inventory_aggregate_cost_layers(
  id,company_id,location_id,catalog_part_id,source_kind,received_quantity,
  quantity_on_hand,quantity_reserved,uom_code,cost_source,received_at
)
select usage.id,usage.company_id,usage.location_id,usage.catalog_part_id,'reconciliation',
       usage.quantity+usage.adjustment_total,0,0,usage.uom_code,'unknown',coalesce(usage.consumed_at,usage.updated_at)
from workorder_aggregate_part_usages usage
where usage.status='consumed';

insert into inventory_aggregate_usage_cost_allocations(company_id,usage_id,cost_layer_id,quantity,status)
select usage.company_id,usage.id,layer.id,usage.quantity+usage.adjustment_total,'consumed'
from workorder_aggregate_part_usages usage
join inventory_aggregate_cost_layers layer
  on layer.company_id=usage.company_id and layer.id=usage.id
where usage.status='consumed';

comment on table inventory_aggregate_cost_layers is
  'FCFS accounting layers for aggregate stock. Receipt layers preserve invoice cost lineage; legacy and reconciliation layers make unknown cost explicit.';
comment on table inventory_aggregate_usage_cost_allocations is
  'Current FCFS layer allocation for one aggregate Workorder usage. Physical position allocation remains separate.';
comment on table workorder_part_price_snapshot_allocations is
  'Immutable mixed-layer price evidence supporting transparent blended Workorder totals.';
