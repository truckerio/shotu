set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table parts_catalog
  drop constraint if exists parts_catalog_tracking_mode_check;
alter table parts_catalog
  add constraint parts_catalog_tracking_mode_check
  check (tracking_mode is null or tracking_mode in ('quantity', 'serialized', 'measured_bulk', 'no_stock'));

comment on column parts_catalog.tracking_mode is
  'Company-wide tracking policy. no_stock is catalog-only and cannot participate in physical inventory mutations.';

create or replace function inventory_no_stock_has_physical_history(scope_company_id uuid, scope_catalog_part_id uuid)
returns boolean language sql stable as $$
  select
    exists(select 1 from inventory_items entry where entry.company_id=scope_company_id and entry.catalog_part_id=scope_catalog_part_id)
    or exists(select 1 from odoo_inventory_balances entry where entry.company_id=scope_company_id and entry.catalog_part_id=scope_catalog_part_id)
    or exists(select 1 from local_inventory_receipt_lines entry where entry.company_id=scope_company_id and entry.catalog_part_id=scope_catalog_part_id)
    or exists(select 1 from inventory_receipt_lines entry where entry.company_id=scope_company_id and entry.catalog_part_id=scope_catalog_part_id)
    or exists(select 1 from inventory_stock_movements entry where entry.company_id=scope_company_id and entry.catalog_part_id=scope_catalog_part_id)
    or exists(select 1 from inventory_serialization_batches entry where entry.company_id=scope_company_id and entry.catalog_part_id=scope_catalog_part_id)
    or exists(select 1 from inventory_manual_intake_batches entry where entry.company_id=scope_company_id and entry.catalog_part_id=scope_catalog_part_id)
    or exists(select 1 from inventory_count_import_lines entry where entry.company_id=scope_company_id and entry.catalog_part_id=scope_catalog_part_id)
    or exists(select 1 from inventory_position_balances entry where entry.company_id=scope_company_id and entry.catalog_part_id=scope_catalog_part_id)
    or exists(select 1 from inventory_position_movements entry where entry.company_id=scope_company_id and entry.catalog_part_id=scope_catalog_part_id)
    or exists(select 1 from inventory_position_count_lines entry where entry.company_id=scope_company_id and entry.catalog_part_id=scope_catalog_part_id)
    or exists(select 1 from inventory_position_count_unit_snapshots entry where entry.company_id=scope_company_id and entry.catalog_part_id=scope_catalog_part_id)
    or exists(select 1 from inventory_stocking_policies entry where entry.company_id=scope_company_id and entry.catalog_part_id=scope_catalog_part_id)
    or exists(select 1 from inventory_stock_tasks entry where entry.company_id=scope_company_id and entry.catalog_part_id=scope_catalog_part_id)
    or exists(select 1 from inventory_purchase_lines entry where entry.company_id=scope_company_id and entry.catalog_part_id=scope_catalog_part_id)
    or exists(select 1 from inventory_purchase_requests entry where entry.company_id=scope_company_id and entry.catalog_part_id=scope_catalog_part_id)
    or exists(select 1 from part_fulfillment_requests entry where entry.company_id=scope_company_id and entry.catalog_part_id=scope_catalog_part_id)
    or exists(select 1 from inventory_aggregate_cost_layers entry where entry.company_id=scope_company_id and entry.catalog_part_id=scope_catalog_part_id)
    or exists(select 1 from workorder_serialized_part_usages entry where entry.company_id=scope_company_id and entry.catalog_part_id=scope_catalog_part_id)
    or exists(select 1 from workorder_aggregate_part_usages entry where entry.company_id=scope_company_id and entry.catalog_part_id=scope_catalog_part_id)
    or exists(select 1 from inventory_reuse_catalog_policies entry where entry.company_id=scope_company_id and entry.catalog_part_id=scope_catalog_part_id)
    or exists(select 1 from inventory_direct_receipt_approval_requests entry where entry.company_id=scope_company_id and entry.catalog_part_id=scope_catalog_part_id);
$$;

create or replace function enforce_catalog_no_stock_tracking()
returns trigger language plpgsql as $$
declare
  unit_category text;
begin
  select category into unit_category from units_of_measure where code=new.uom_code;
  if unit_category='time'
     and new.tracking_mode is distinct from 'no_stock'
     and (
       tg_op='INSERT'
       or old.uom_code is distinct from new.uom_code
       or old.tracking_mode is distinct from new.tracking_mode
     ) then
    raise exception using errcode='23514', constraint='parts_catalog_time_requires_no_stock',
      message='Time-based catalog entries must use no_stock tracking.';
  end if;
  if new.tracking_mode='no_stock'
     and (tg_op='INSERT' or old.tracking_mode is distinct from 'no_stock')
     and inventory_no_stock_has_physical_history(new.company_id,new.id) then
    raise exception using errcode='23514', constraint='parts_catalog_no_stock_physical_history',
      message='Catalog entries with physical inventory history cannot use no_stock tracking.';
  end if;
  return new;
end;
$$;

drop trigger if exists parts_catalog_no_stock_tracking_trigger on parts_catalog;
create trigger parts_catalog_no_stock_tracking_trigger
before insert or update of uom_code,tracking_mode on parts_catalog
for each row execute function enforce_catalog_no_stock_tracking();

-- Only untouched time-based catalog rows are classified automatically. Rows with
-- any physical history or policy remain unchanged for explicit reviewed conversion.
update parts_catalog catalog
set tracking_mode='no_stock', version=version+1, updated_at=now()
from units_of_measure uom
where uom.code=catalog.uom_code and uom.category='time'
  and catalog.tracking_mode is distinct from 'no_stock'
  and not inventory_no_stock_has_physical_history(catalog.company_id,catalog.id);

create or replace function reject_no_stock_physical_mutation()
returns trigger language plpgsql as $$
begin
  if new.catalog_part_id is not null and exists(
    select 1 from parts_catalog catalog
    where catalog.company_id=new.company_id and catalog.id=new.catalog_part_id
      and catalog.tracking_mode='no_stock'
    for key share
  ) then
    raise exception using errcode='23514', constraint='inventory_no_stock_physical_mutation',
      message='no_stock catalog entries cannot participate in physical inventory.';
  end if;
  return new;
end;
$$;

drop trigger if exists inventory_items_no_stock_guard on inventory_items;
create trigger inventory_items_no_stock_guard before insert or update of company_id,catalog_part_id on inventory_items for each row when (new.catalog_part_id is not null) execute function reject_no_stock_physical_mutation();
drop trigger if exists odoo_inventory_balances_no_stock_guard on odoo_inventory_balances;
create trigger odoo_inventory_balances_no_stock_guard before insert or update of company_id,catalog_part_id on odoo_inventory_balances for each row execute function reject_no_stock_physical_mutation();
drop trigger if exists local_inventory_receipt_lines_no_stock_guard on local_inventory_receipt_lines;
create trigger local_inventory_receipt_lines_no_stock_guard before insert or update of company_id,catalog_part_id on local_inventory_receipt_lines for each row execute function reject_no_stock_physical_mutation();
drop trigger if exists inventory_receipt_lines_no_stock_guard on inventory_receipt_lines;
create trigger inventory_receipt_lines_no_stock_guard before insert or update of company_id,catalog_part_id on inventory_receipt_lines for each row execute function reject_no_stock_physical_mutation();
drop trigger if exists inventory_stock_movements_no_stock_guard on inventory_stock_movements;
create trigger inventory_stock_movements_no_stock_guard before insert or update of company_id,catalog_part_id on inventory_stock_movements for each row execute function reject_no_stock_physical_mutation();
drop trigger if exists inventory_serialization_batches_no_stock_guard on inventory_serialization_batches;
create trigger inventory_serialization_batches_no_stock_guard before insert or update of company_id,catalog_part_id on inventory_serialization_batches for each row execute function reject_no_stock_physical_mutation();
drop trigger if exists inventory_manual_intake_batches_no_stock_guard on inventory_manual_intake_batches;
create trigger inventory_manual_intake_batches_no_stock_guard before insert or update of company_id,catalog_part_id on inventory_manual_intake_batches for each row execute function reject_no_stock_physical_mutation();
drop trigger if exists inventory_count_import_lines_no_stock_guard on inventory_count_import_lines;
create trigger inventory_count_import_lines_no_stock_guard before insert or update of company_id,catalog_part_id on inventory_count_import_lines for each row when (new.catalog_part_id is not null) execute function reject_no_stock_physical_mutation();
drop trigger if exists inventory_position_balances_no_stock_guard on inventory_position_balances;
create trigger inventory_position_balances_no_stock_guard before insert or update of company_id,catalog_part_id on inventory_position_balances for each row execute function reject_no_stock_physical_mutation();
drop trigger if exists inventory_position_movements_no_stock_guard on inventory_position_movements;
create trigger inventory_position_movements_no_stock_guard before insert or update of company_id,catalog_part_id on inventory_position_movements for each row execute function reject_no_stock_physical_mutation();
drop trigger if exists inventory_position_count_lines_no_stock_guard on inventory_position_count_lines;
create trigger inventory_position_count_lines_no_stock_guard before insert or update of company_id,catalog_part_id on inventory_position_count_lines for each row execute function reject_no_stock_physical_mutation();
drop trigger if exists inventory_position_count_unit_snapshots_no_stock_guard on inventory_position_count_unit_snapshots;
create trigger inventory_position_count_unit_snapshots_no_stock_guard before insert or update of company_id,catalog_part_id on inventory_position_count_unit_snapshots for each row execute function reject_no_stock_physical_mutation();
drop trigger if exists inventory_stocking_policies_no_stock_guard on inventory_stocking_policies;
create trigger inventory_stocking_policies_no_stock_guard before insert or update of company_id,catalog_part_id on inventory_stocking_policies for each row execute function reject_no_stock_physical_mutation();
drop trigger if exists inventory_stock_tasks_no_stock_guard on inventory_stock_tasks;
create trigger inventory_stock_tasks_no_stock_guard before insert or update of company_id,catalog_part_id on inventory_stock_tasks for each row execute function reject_no_stock_physical_mutation();
drop trigger if exists inventory_purchase_lines_no_stock_guard on inventory_purchase_lines;
create trigger inventory_purchase_lines_no_stock_guard before insert or update of company_id,catalog_part_id on inventory_purchase_lines for each row when (new.catalog_part_id is not null) execute function reject_no_stock_physical_mutation();
drop trigger if exists inventory_purchase_requests_no_stock_guard on inventory_purchase_requests;
create trigger inventory_purchase_requests_no_stock_guard before insert or update of company_id,catalog_part_id on inventory_purchase_requests for each row when (new.catalog_part_id is not null) execute function reject_no_stock_physical_mutation();
drop trigger if exists part_fulfillment_requests_no_stock_guard on part_fulfillment_requests;
create trigger part_fulfillment_requests_no_stock_guard before insert or update of company_id,catalog_part_id on part_fulfillment_requests for each row execute function reject_no_stock_physical_mutation();
drop trigger if exists inventory_aggregate_cost_layers_no_stock_guard on inventory_aggregate_cost_layers;
create trigger inventory_aggregate_cost_layers_no_stock_guard before insert or update of company_id,catalog_part_id on inventory_aggregate_cost_layers for each row execute function reject_no_stock_physical_mutation();
drop trigger if exists workorder_serialized_part_usages_no_stock_guard on workorder_serialized_part_usages;
create trigger workorder_serialized_part_usages_no_stock_guard before insert or update of company_id,catalog_part_id on workorder_serialized_part_usages for each row execute function reject_no_stock_physical_mutation();
drop trigger if exists workorder_aggregate_part_usages_no_stock_guard on workorder_aggregate_part_usages;
create trigger workorder_aggregate_part_usages_no_stock_guard before insert or update of company_id,catalog_part_id on workorder_aggregate_part_usages for each row execute function reject_no_stock_physical_mutation();
drop trigger if exists inventory_reuse_catalog_policies_no_stock_guard on inventory_reuse_catalog_policies;
create trigger inventory_reuse_catalog_policies_no_stock_guard before insert or update of company_id,catalog_part_id on inventory_reuse_catalog_policies for each row execute function reject_no_stock_physical_mutation();
drop trigger if exists inventory_direct_receipt_approval_requests_no_stock_guard on inventory_direct_receipt_approval_requests;
create trigger inventory_direct_receipt_approval_requests_no_stock_guard before insert or update of company_id,catalog_part_id on inventory_direct_receipt_approval_requests for each row execute function reject_no_stock_physical_mutation();
