set local lock_timeout = '5s';
set local statement_timeout = '60s';

create or replace function enforce_part_quantity_unit_scale()
returns trigger
language plpgsql
as $$
declare
  unit_scale smallint;
begin
  select decimal_scale into unit_scale
  from units_of_measure
  where code = new.uom_code and active;

  if not found then
    raise check_violation using
      message = 'Quantity unit must be active.',
      constraint = tg_table_name || '_quantity_uom_scale_check';
  end if;

  if unit_scale = 0 and new.quantity <> trunc(new.quantity) then
    raise check_violation using
      message = 'Count and packaging quantities must be whole numbers.',
      constraint = tg_table_name || '_quantity_uom_scale_check';
  end if;

  return new;
end;
$$;

create or replace function enforce_inventory_quantity_unit_scale()
returns trigger
language plpgsql
as $$
declare
  unit_scale smallint;
begin
  select decimal_scale into unit_scale
  from units_of_measure
  where code = new.uom_code and active;

  if not found then
    raise check_violation using
      message = 'Inventory unit must be active.',
      constraint = 'inventory_items_quantity_uom_scale_check';
  end if;

  if unit_scale = 0 and (
    new.quantity_on_hand <> trunc(new.quantity_on_hand)
    or new.quantity_reserved <> trunc(new.quantity_reserved)
  ) then
    raise check_violation using
      message = 'Count and packaging inventory quantities must be whole numbers.',
      constraint = 'inventory_items_quantity_uom_scale_check';
  end if;

  return new;
end;
$$;

drop trigger if exists workorder_part_requests_quantity_uom_scale_trigger
  on workorder_part_requests;
create trigger workorder_part_requests_quantity_uom_scale_trigger
before insert or update of quantity, uom_code
on workorder_part_requests
for each row execute function enforce_part_quantity_unit_scale();

drop trigger if exists part_allocations_quantity_uom_scale_trigger
  on part_allocations;
create trigger part_allocations_quantity_uom_scale_trigger
before insert or update of quantity, uom_code
on part_allocations
for each row execute function enforce_part_quantity_unit_scale();

drop trigger if exists inventory_items_quantity_uom_scale_trigger
  on inventory_items;
create trigger inventory_items_quantity_uom_scale_trigger
before insert or update of quantity_on_hand, quantity_reserved, uom_code
on inventory_items
for each row execute function enforce_inventory_quantity_unit_scale();

comment on function enforce_part_quantity_unit_scale() is
  'Enforces whole-number count and packaging quantities at the durable database boundary.';
comment on function enforce_inventory_quantity_unit_scale() is
  'Enforces whole-number count and packaging inventory balances at the durable database boundary.';
