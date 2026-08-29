set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table parts_catalog add column if not exists uom_locked_at timestamptz;

with activity as (
  select company_id, catalog_part_id from inventory_items
  union select company_id, catalog_part_id from local_inventory_receipt_lines
  union select company_id, catalog_part_id from inventory_receipt_lines
  union select company_id, catalog_part_id from inventory_stock_movements
  union select company_id, catalog_part_id from inventory_serialization_batches
  union select company_id, catalog_part_id from inventory_count_import_lines where catalog_part_id is not null
  union select workorder.company_id, request.catalog_part_id
    from workorder_part_requests request
    join operational_workorders workorder on workorder.id = request.workorder_id
    where request.catalog_part_id is not null
  union select company_id, catalog_part_id from part_fulfillment_requests
  union select company_id, catalog_part_id from workorder_serialized_part_usages
  union select company_id, catalog_part_id from service_history_lines where catalog_part_id is not null
  union select company_id, catalog_part_id from part_repair_history where catalog_part_id is not null
)
update parts_catalog catalog
set uom_locked_at = coalesce(catalog.uom_locked_at, now())
from activity
where activity.company_id = catalog.company_id and activity.catalog_part_id = catalog.id;

create or replace function enforce_catalog_uom_activity_lock()
returns trigger language plpgsql as $$
declare
  parent_uom text;
  row_uom text;
  activity_company_id uuid;
begin
  if new.catalog_part_id is null then
    return new;
  end if;

  if tg_argv[0] = 'workorder_request_uom' then
    select company_id into activity_company_id
    from operational_workorders
    where id = new.workorder_id;
  else
    activity_company_id := (to_jsonb(new) ->> 'company_id')::uuid;
  end if;

  select uom_code into parent_uom
  from parts_catalog
  where company_id = activity_company_id and id = new.catalog_part_id
  for key share;

  if not found then
    raise exception using errcode = '23503', constraint = 'catalog_uom_activity_catalog_fk',
      message = 'Catalog part does not exist in this company.';
  end if;

  if tg_argv[0] in ('uom', 'workorder_request_uom') then
    row_uom := to_jsonb(new) ->> 'uom_code';
    if row_uom is distinct from parent_uom then
      raise exception using errcode = '23514', constraint = 'catalog_uom_activity_uom_mismatch',
        message = 'Activity unit does not match the catalog unit.';
    end if;
  end if;

  update parts_catalog
  set uom_locked_at = coalesce(uom_locked_at, clock_timestamp())
  where company_id = activity_company_id and id = new.catalog_part_id;
  return new;
end;
$$;

create or replace function prevent_locked_catalog_uom_change()
returns trigger language plpgsql as $$
begin
  if new.uom_code is distinct from old.uom_code and old.uom_locked_at is not null then
    raise exception using errcode = '23514', constraint = 'parts_catalog_uom_locked',
      message = 'Unit is locked after inventory activity.';
  end if;
  return new;
end;
$$;

create or replace function enforce_related_catalog_uom_activity()
returns trigger language plpgsql as $$
declare
  parent_uom text;
begin
  if tg_argv[0] = 'allocation' then
    select catalog.uom_code into parent_uom
    from workorder_part_requests request
    join operational_workorders workorder on workorder.id = request.workorder_id
    join parts_catalog catalog on catalog.company_id = workorder.company_id and catalog.id = request.catalog_part_id
    where request.id = new.part_request_id
    for key share of catalog;
  elsif tg_argv[0] = 'fulfillment_leg' then
    select catalog.uom_code into parent_uom
    from part_fulfillment_requests request
    join parts_catalog catalog on catalog.company_id = request.company_id and catalog.id = request.catalog_part_id
    where request.company_id = new.company_id and request.id = new.fulfillment_request_id
    for key share of catalog;
  end if;

  if parent_uom is not null and new.uom_code is distinct from parent_uom then
    raise exception using errcode = '23514', constraint = 'catalog_uom_activity_uom_mismatch',
      message = 'Activity unit does not match the catalog unit.';
  end if;
  return new;
end;
$$;

drop trigger if exists parts_catalog_uom_locked_trigger on parts_catalog;
create trigger parts_catalog_uom_locked_trigger
before update of uom_code on parts_catalog
for each row execute function prevent_locked_catalog_uom_change();

drop trigger if exists inventory_items_catalog_uom_activity_trigger on inventory_items;
create trigger inventory_items_catalog_uom_activity_trigger before insert or update of company_id, catalog_part_id, uom_code on inventory_items for each row execute function enforce_catalog_uom_activity_lock('uom');
drop trigger if exists local_inventory_receipt_lines_catalog_uom_activity_trigger on local_inventory_receipt_lines;
create trigger local_inventory_receipt_lines_catalog_uom_activity_trigger before insert or update of company_id, catalog_part_id, uom_code on local_inventory_receipt_lines for each row execute function enforce_catalog_uom_activity_lock('uom');
drop trigger if exists inventory_receipt_lines_catalog_uom_activity_trigger on inventory_receipt_lines;
create trigger inventory_receipt_lines_catalog_uom_activity_trigger before insert or update of company_id, catalog_part_id, uom_code on inventory_receipt_lines for each row execute function enforce_catalog_uom_activity_lock('uom');
drop trigger if exists inventory_stock_movements_catalog_uom_activity_trigger on inventory_stock_movements;
create trigger inventory_stock_movements_catalog_uom_activity_trigger before insert or update of company_id, catalog_part_id, uom_code on inventory_stock_movements for each row execute function enforce_catalog_uom_activity_lock('uom');
drop trigger if exists workorder_part_requests_catalog_uom_activity_trigger on workorder_part_requests;
create trigger workorder_part_requests_catalog_uom_activity_trigger before insert or update of workorder_id, catalog_part_id, uom_code on workorder_part_requests for each row execute function enforce_catalog_uom_activity_lock('workorder_request_uom');
drop trigger if exists part_fulfillment_requests_catalog_uom_activity_trigger on part_fulfillment_requests;
create trigger part_fulfillment_requests_catalog_uom_activity_trigger before insert or update of company_id, catalog_part_id, uom_code on part_fulfillment_requests for each row execute function enforce_catalog_uom_activity_lock('uom');
drop trigger if exists workorder_serialized_part_usages_catalog_uom_activity_trigger on workorder_serialized_part_usages;
create trigger workorder_serialized_part_usages_catalog_uom_activity_trigger before insert or update of company_id, catalog_part_id, uom_code on workorder_serialized_part_usages for each row execute function enforce_catalog_uom_activity_lock('uom');

drop trigger if exists inventory_serialization_batches_catalog_uom_activity_trigger on inventory_serialization_batches;
create trigger inventory_serialization_batches_catalog_uom_activity_trigger before insert or update of company_id, catalog_part_id on inventory_serialization_batches for each row execute function enforce_catalog_uom_activity_lock('marker');
drop trigger if exists inventory_count_import_lines_catalog_uom_activity_trigger on inventory_count_import_lines;
create trigger inventory_count_import_lines_catalog_uom_activity_trigger before insert or update of company_id, catalog_part_id on inventory_count_import_lines for each row when (new.catalog_part_id is not null) execute function enforce_catalog_uom_activity_lock('marker');
drop trigger if exists service_history_lines_catalog_uom_activity_trigger on service_history_lines;
create trigger service_history_lines_catalog_uom_activity_trigger before insert or update of company_id, catalog_part_id on service_history_lines for each row when (new.catalog_part_id is not null) execute function enforce_catalog_uom_activity_lock('marker');
drop trigger if exists part_repair_history_catalog_uom_activity_trigger on part_repair_history;
create trigger part_repair_history_catalog_uom_activity_trigger before insert or update of company_id, catalog_part_id on part_repair_history for each row when (new.catalog_part_id is not null) execute function enforce_catalog_uom_activity_lock('marker');

drop trigger if exists part_allocations_catalog_uom_activity_trigger on part_allocations;
create trigger part_allocations_catalog_uom_activity_trigger before insert or update of part_request_id, uom_code on part_allocations for each row execute function enforce_related_catalog_uom_activity('allocation');
drop trigger if exists part_fulfillment_legs_catalog_uom_activity_trigger on part_fulfillment_legs;
create trigger part_fulfillment_legs_catalog_uom_activity_trigger before insert or update of company_id, fulfillment_request_id, uom_code on part_fulfillment_legs for each row execute function enforce_related_catalog_uom_activity('fulfillment_leg');
