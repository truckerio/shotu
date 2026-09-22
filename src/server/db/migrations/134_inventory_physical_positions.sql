set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table inventory_positions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  location_id uuid not null,
  parent_id uuid,
  code varchar(80) not null check (btrim(code) <> ''),
  name varchar(160) not null check (btrim(name) <> ''),
  kind varchar(24) not null check (kind in ('warehouse','zone','aisle','rack','shelf','bin','room','area')),
  usage varchar(32) check (usage in ('unassigned','receiving','storage','quarantine','returns','repair_staging','dispatch')),
  can_store boolean not null default false,
  is_pickable boolean not null default false,
  system_key varchar(32) check (system_key in ('unassigned','receiving')),
  is_active boolean not null default true,
  version integer not null default 1 check (version > 0),
  created_by uuid references user_profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_positions_location_company_fk foreign key (company_id,location_id)
    references locations(company_id,id) on delete restrict,
  constraint inventory_positions_parent_company_fk foreign key (company_id,location_id,parent_id)
    references inventory_positions(company_id,location_id,id) on delete restrict,
  constraint inventory_positions_company_location_id_key unique(company_id,location_id,id),
  constraint inventory_positions_company_id_key unique(company_id,id),
  constraint inventory_positions_storage_shape check (
    (can_store and usage is not null) or (not can_store and usage is null and not is_pickable)
  ),
  constraint inventory_positions_pickable_shape check (not is_pickable or (can_store and usage in ('unassigned','receiving','storage'))),
  constraint inventory_positions_system_shape check (
    system_key is null or (can_store and parent_id is null and system_key=usage)
  )
);
create unique index inventory_positions_shop_code_uidx
  on inventory_positions(company_id,location_id,lower(code));
create unique index inventory_positions_system_uidx
  on inventory_positions(company_id,location_id,system_key) where system_key is not null;
create index inventory_positions_tree_idx on inventory_positions(company_id,location_id,parent_id,is_active,name,id);

create table inventory_position_admin_commands (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  actor_id uuid not null references user_profiles(id) on delete restrict,
  action varchar(24) not null check(action in ('create')),
  idempotency_key varchar(160) not null,
  request_hash char(64) not null check(request_hash ~ '^[0-9a-f]{64}$'),
  position_id uuid not null,
  created_at timestamptz not null default now(),
  unique(company_id,actor_id,idempotency_key),
  constraint inventory_position_admin_command_position_fk foreign key(company_id,position_id)
    references inventory_positions(company_id,id) on delete restrict
);

create function inventory_position_tree_guard() returns trigger language plpgsql as $$
begin
  if new.parent_id is null then return new; end if;
  if new.parent_id=new.id then raise exception 'Inventory position cannot be its own parent.'; end if;
  if exists (
    with recursive descendants as (
      select id from inventory_positions where company_id=new.company_id and location_id=new.location_id and parent_id=new.id
      union all
      select child.id from inventory_positions child join descendants d on child.parent_id=d.id
       where child.company_id=new.company_id and child.location_id=new.location_id
    ) select 1 from descendants where id=new.parent_id
  ) then raise exception 'Inventory position hierarchy cannot contain a cycle.'; end if;
  return new;
end $$;
create trigger inventory_positions_tree_guard before insert or update of parent_id,company_id,location_id
  on inventory_positions for each row execute function inventory_position_tree_guard();

create table inventory_position_operations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  location_id uuid not null,
  actor_id uuid not null references user_profiles(id) on delete restrict,
  command_type varchar(32) not null check (command_type in ('receipt','put_away','move','workorder_pick','workorder_return','count_adjustment','reuse_release','opening_backfill')),
  idempotency_key varchar(160) not null check (char_length(idempotency_key) between 8 and 160),
  request_hash char(64) not null check (request_hash ~ '^[0-9a-f]{64}$'),
  reason varchar(500) not null default '',
  receipt_id uuid,
  workorder_id uuid,
  count_session_id uuid,
  effective_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint inventory_position_operations_location_fk foreign key(company_id,location_id)
    references locations(company_id,id) on delete restrict,
  unique(company_id,actor_id,idempotency_key),
  unique(company_id,id)
);

create table inventory_position_balances (
  company_id uuid not null references companies(id) on delete cascade,
  location_id uuid not null,
  position_id uuid not null,
  inventory_item_id uuid not null references inventory_items(id) on delete restrict,
  catalog_part_id uuid not null,
  uom_code text not null references units_of_measure(code),
  quantity numeric(18,3) not null check (quantity >= 0),
  quantity_reserved numeric(18,3) not null default 0 check (quantity_reserved >= 0 and quantity_reserved <= quantity),
  version integer not null default 1 check (version > 0),
  updated_at timestamptz not null default now(),
  primary key(company_id,position_id,inventory_item_id),
  constraint inventory_position_balances_position_fk foreign key(company_id,location_id,position_id)
    references inventory_positions(company_id,location_id,id) on delete restrict,
  constraint inventory_position_balances_catalog_fk foreign key(company_id,catalog_part_id)
    references parts_catalog(company_id,id) on delete restrict
);
create index inventory_position_balances_part_idx
  on inventory_position_balances(company_id,location_id,catalog_part_id,uom_code,position_id);

alter table inventory_serialized_units add column current_position_id uuid;
alter table inventory_serialized_units add constraint inventory_serialized_units_current_position_fk
  foreign key(company_id,location_id,current_position_id) references inventory_positions(company_id,location_id,id) on delete restrict;
create index inventory_serialized_units_current_position_idx
  on inventory_serialized_units(company_id,location_id,current_position_id,status,id) where current_position_id is not null;

create table inventory_position_movements (
  id uuid primary key default gen_random_uuid(),
  event_ordinal bigint generated always as identity,
  operation_id uuid not null,
  company_id uuid not null,
  location_id uuid not null,
  catalog_part_id uuid not null,
  uom_code text not null references units_of_measure(code),
  quantity numeric(18,3) not null check (quantity > 0),
  unit_id uuid,
  from_position_id uuid,
  to_position_id uuid,
  created_at timestamptz not null default now(),
  constraint inventory_position_movements_operation_fk foreign key(company_id,operation_id)
    references inventory_position_operations(company_id,id) on delete restrict,
  constraint inventory_position_movements_from_fk foreign key(company_id,location_id,from_position_id)
    references inventory_positions(company_id,location_id,id) on delete restrict,
  constraint inventory_position_movements_to_fk foreign key(company_id,location_id,to_position_id)
    references inventory_positions(company_id,location_id,id) on delete restrict,
  constraint inventory_position_movements_unit_fk foreign key(company_id,unit_id)
    references inventory_serialized_units(company_id,id) on delete restrict,
  constraint inventory_position_movements_shape check (
    from_position_id is distinct from to_position_id and (from_position_id is not null or to_position_id is not null)
    and (unit_id is null or quantity=1)
  ),
  unique(event_ordinal)
);
create index inventory_position_movements_watermark_idx
  on inventory_position_movements(company_id,location_id,event_ordinal);
create index inventory_position_movements_scope_idx
  on inventory_position_movements(company_id,location_id,catalog_part_id,from_position_id,to_position_id,event_ordinal);

create table inventory_aggregate_usage_position_allocations (
  company_id uuid not null references companies(id) on delete cascade,
  usage_id uuid not null,
  position_id uuid not null,
  inventory_item_id uuid not null references inventory_items(id) on delete restrict,
  quantity numeric(18,3) not null check (quantity > 0),
  status varchar(24) not null default 'reserved' check(status in ('reserved','picked','released','consumed','reversed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(company_id,usage_id,position_id),
  constraint inventory_aggregate_usage_position_usage_fk foreign key(company_id,usage_id)
    references workorder_aggregate_part_usages(company_id,id) on delete restrict,
  constraint inventory_aggregate_usage_position_position_fk foreign key(company_id,position_id)
    references inventory_positions(company_id,id) on delete restrict
);

create table inventory_position_reconciliation_exceptions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  location_id uuid not null,
  inventory_item_id uuid references inventory_items(id) on delete restrict,
  catalog_part_id uuid,
  exception_code varchar(64) not null,
  details jsonb not null default '{}',
  status varchar(24) not null default 'open' check(status in ('open','resolved')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint inventory_position_reconciliation_location_fk foreign key(company_id,location_id)
    references locations(company_id,id) on delete restrict,
  unique(company_id,inventory_item_id,exception_code)
);

create table inventory_position_count_sessions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  location_id uuid not null,
  position_id uuid not null,
  status varchar(24) not null default 'open' check(status in ('open','ready','applied','needs_recount','superseded')),
  start_watermark bigint not null default 0,
  version integer not null default 1 check(version>0),
  created_by uuid not null references user_profiles(id) on delete restrict,
  idempotency_key varchar(160) not null,
  request_hash char(64) not null check(request_hash ~ '^[0-9a-f]{64}$'),
  superseded_by_session_id uuid,
  applied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_position_counts_position_fk foreign key(company_id,location_id,position_id)
    references inventory_positions(company_id,location_id,id) on delete restrict,
  unique(company_id,created_by,idempotency_key),
  unique(company_id,id),
  constraint inventory_position_count_superseded_by_fk foreign key(company_id,superseded_by_session_id)
    references inventory_position_count_sessions(company_id,id) on delete restrict
);

create table inventory_position_count_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  session_id uuid not null,
  inventory_item_id uuid not null references inventory_items(id) on delete restrict,
  catalog_part_id uuid not null,
  uom_code text not null references units_of_measure(code),
  expected_quantity numeric(18,3) not null,
  observed_quantity numeric(18,3) check(observed_quantity is null or observed_quantity>=0),
  balance_version integer not null,
  observation_watermark bigint not null default 0,
  version integer not null default 1 check(version>0),
  status varchar(24) not null default 'open' check(status in ('open','observed','applied','needs_recount')),
  observed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint inventory_position_count_lines_session_fk foreign key(company_id,session_id)
    references inventory_position_count_sessions(company_id,id) on delete restrict,
  unique(company_id,session_id,inventory_item_id),
  unique(company_id,id)
);

create table inventory_position_count_commands (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  actor_id uuid not null references user_profiles(id) on delete restrict,
  session_id uuid not null,
  line_id uuid,
  action varchar(24) not null check(action in ('observe','apply')),
  idempotency_key varchar(160) not null,
  request_hash char(64) not null check(request_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  constraint inventory_position_count_commands_session_fk foreign key(company_id,session_id)
    references inventory_position_count_sessions(company_id,id) on delete restrict,
  constraint inventory_position_count_commands_line_fk foreign key(company_id,line_id)
    references inventory_position_count_lines(company_id,id) on delete restrict,
  unique(company_id,actor_id,idempotency_key)
);

create function inventory_position_archive_guard() returns trigger language plpgsql as $$
begin
  if old.is_active and not new.is_active then
    if old.system_key is not null then raise exception 'System inventory positions cannot be archived.'; end if;
    if exists(select 1 from inventory_positions where company_id=old.company_id and location_id=old.location_id and parent_id=old.id and is_active)
      or exists(select 1 from inventory_position_balances where company_id=old.company_id and position_id=old.id and (quantity<>0 or quantity_reserved<>0))
      or exists(select 1 from inventory_serialized_units where company_id=old.company_id and current_position_id=old.id)
      or exists(select 1 from inventory_position_count_sessions where company_id=old.company_id and position_id=old.id and status='open')
    then raise exception 'Inventory position still has active children or stock, or an open count.'; end if;
  end if;
  return new;
end $$;
create trigger inventory_positions_archive_guard before update of is_active on inventory_positions
  for each row execute function inventory_position_archive_guard();

insert into inventory_positions(company_id,location_id,code,name,kind,usage,can_store,is_pickable,system_key)
select company_id,id,'SYS-UNASSIGNED','Unassigned','area','unassigned',true,true,'unassigned' from locations;
insert into inventory_positions(company_id,location_id,code,name,kind,usage,can_store,is_pickable,system_key)
select company_id,id,'SYS-RECEIVING','Receiving','area','receiving',true,true,'receiving' from locations;

update inventory_serialized_units unit set current_position_id=position.id
from inventory_positions position, inventory_receipts receipt
where position.company_id=unit.company_id and position.location_id=unit.location_id and position.system_key='unassigned'
  and receipt.company_id=unit.company_id and receipt.id=unit.receipt_id
  and receipt.provider in ('local','local_count','local_serialization','legacy_tracking')
  and unit.status in ('in_stock','reserved') and unit.custody_holder_type='inventory_location';

insert into inventory_position_reconciliation_exceptions(company_id,location_id,inventory_item_id,catalog_part_id,exception_code,details)
select distinct item.company_id,item.location_id,item.id,item.catalog_part_id,'serialized_provider_ambiguous',
  jsonb_build_object('provider',receipt.provider)
from inventory_serialized_units unit
join inventory_receipts receipt on receipt.company_id=unit.company_id and receipt.id=unit.receipt_id
join inventory_receipt_lines line on line.company_id=unit.company_id and line.id=unit.receipt_line_id
join inventory_items item on item.company_id=unit.company_id and item.location_id=unit.location_id
  and item.catalog_part_id=line.catalog_part_id and item.uom_code=line.uom_code and item.source_provider='local'
where unit.status in ('in_stock','reserved') and unit.custody_holder_type='inventory_location'
  and receipt.provider not in ('local','local_count','local_serialization','legacy_tracking')
on conflict do nothing;

insert into inventory_position_reconciliation_exceptions(company_id,location_id,inventory_item_id,catalog_part_id,exception_code,details)
select item.company_id,item.location_id,item.id,item.catalog_part_id,'active_legacy_allocation',
  jsonb_build_object('reservedQuantity',item.quantity_reserved)
from inventory_items item where item.source_provider='local' and exists(
  select 1 from part_allocations allocation where allocation.inventory_item_id=item.id and allocation.status in ('reserved','issued')
);

with aggregate_state as (
  select item.*, coalesce((select sum(usage.quantity+usage.adjustment_total) from workorder_aggregate_part_usages usage
    where usage.company_id=item.company_id and usage.location_id=item.location_id and usage.catalog_part_id=item.catalog_part_id
      and usage.uom_code=item.uom_code and usage.status='installed_pending_approval'),0) pending,
    coalesce((select sum(usage.quantity) from workorder_aggregate_part_usages usage
    where usage.company_id=item.company_id and usage.location_id=item.location_id and usage.catalog_part_id=item.catalog_part_id
      and usage.uom_code=item.uom_code and usage.status='reserved'),0) canonical_reserved
  from inventory_items item join parts_catalog part on part.company_id=item.company_id and part.id=item.catalog_part_id
  where item.source_provider='local' and item.location_id is not null and part.tracking_mode in ('quantity','measured_bulk')
), invalid as (
  select * from aggregate_state where quantity_on_hand < pending or quantity_reserved <> pending+canonical_reserved
)
insert into inventory_position_reconciliation_exceptions(company_id,location_id,inventory_item_id,catalog_part_id,exception_code,details)
select company_id,location_id,id,catalog_part_id,'aggregate_balance_ambiguous',
  jsonb_build_object('accountedOnHand',quantity_on_hand,'accountedReserved',quantity_reserved,'pending',pending,'canonicalShelfReserved',canonical_reserved)
from invalid on conflict do nothing;

with aggregate_state as (
  select item.*, coalesce((select sum(usage.quantity+usage.adjustment_total) from workorder_aggregate_part_usages usage
    where usage.company_id=item.company_id and usage.location_id=item.location_id and usage.catalog_part_id=item.catalog_part_id
      and usage.uom_code=item.uom_code and usage.status='installed_pending_approval'),0) pending,
    coalesce((select sum(usage.quantity) from workorder_aggregate_part_usages usage
    where usage.company_id=item.company_id and usage.location_id=item.location_id and usage.catalog_part_id=item.catalog_part_id
      and usage.uom_code=item.uom_code and usage.status='reserved'),0) canonical_reserved
  from inventory_items item join parts_catalog part on part.company_id=item.company_id and part.id=item.catalog_part_id
  where item.source_provider='local' and item.location_id is not null and part.tracking_mode in ('quantity','measured_bulk')
)
insert into inventory_position_balances(company_id,location_id,position_id,inventory_item_id,catalog_part_id,uom_code,quantity,quantity_reserved)
select state.company_id,state.location_id,position.id,state.id,state.catalog_part_id,state.uom_code,
  state.quantity_on_hand-state.pending,state.canonical_reserved
from aggregate_state state join inventory_positions position on position.company_id=state.company_id and position.location_id=state.location_id and position.system_key='unassigned'
where state.quantity_on_hand>=state.pending and state.quantity_reserved=state.pending+state.canonical_reserved
  and not exists(select 1 from inventory_position_reconciliation_exceptions exception where exception.company_id=state.company_id and exception.inventory_item_id=state.id and exception.status='open');

insert into inventory_aggregate_usage_position_allocations(company_id,usage_id,position_id,inventory_item_id,quantity,status)
select usage.company_id,usage.id,position.id,item.id,usage.quantity+usage.adjustment_total,
  case when usage.status='reserved' then 'reserved' else 'picked' end
from workorder_aggregate_part_usages usage
join inventory_positions position on position.company_id=usage.company_id and position.location_id=usage.location_id and position.system_key='unassigned'
join inventory_items item on item.company_id=usage.company_id and item.location_id=usage.location_id
  and item.catalog_part_id=usage.catalog_part_id and item.uom_code=usage.uom_code and item.source_provider='local'
where usage.status in ('reserved','installed_pending_approval') and usage.quantity+usage.adjustment_total>0
  and not exists(select 1 from inventory_position_reconciliation_exceptions exception
    where exception.company_id=item.company_id and exception.inventory_item_id=item.id and exception.status='open');

with serial_state as (
  select item.company_id,item.location_id,item.id inventory_item_id,item.catalog_part_id,item.quantity_on_hand,
    count(distinct unit.id) filter(where unit.status in ('in_stock','reserved') and unit.custody_holder_type='inventory_location'
      and receipt.provider in ('local','local_count','local_serialization','legacy_tracking')) shelf,
    count(distinct unit.id) filter(where unit.status='installed_pending_approval') pending
  from inventory_items item join parts_catalog part on part.company_id=item.company_id and part.id=item.catalog_part_id and part.tracking_mode='serialized'
  left join inventory_receipt_lines line on line.company_id=item.company_id and line.catalog_part_id=item.catalog_part_id and line.uom_code=item.uom_code
  left join inventory_serialized_units unit on unit.company_id=line.company_id and unit.receipt_line_id=line.id and unit.location_id=item.location_id
  left join inventory_receipts receipt on receipt.company_id=unit.company_id and receipt.id=unit.receipt_id
  where item.source_provider='local' and item.location_id is not null
  group by item.company_id,item.location_id,item.id,item.catalog_part_id,item.quantity_on_hand
)
insert into inventory_position_reconciliation_exceptions(company_id,location_id,inventory_item_id,catalog_part_id,exception_code,details)
select company_id,location_id,inventory_item_id,catalog_part_id,'serialized_balance_ambiguous',
  jsonb_build_object('accountedOnHand',quantity_on_hand,'positionedShelf',shelf,'pending',pending)
from serial_state where quantity_on_hand<>shelf+pending on conflict do nothing;

comment on table inventory_positions is 'Stable hierarchical shop map; hierarchy kind is independent from physical stock usage.';
comment on table inventory_position_movements is 'Append-only physical movement evidence. Same-shop moves do not change inventory_items accounting totals.';
comment on table inventory_position_reconciliation_exceptions is 'Explicit gate for legacy or ambiguous balances; no inferred bin quantity is created.';
