set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table parts_catalog
  add column if not exists inventory_display_uom_code text references units_of_measure(code);

create or replace function enforce_inventory_display_uom_equivalence()
returns trigger language plpgsql as $$
declare
  canonical units_of_measure%rowtype;
  preferred units_of_measure%rowtype;
begin
  if new.inventory_display_uom_code is null or new.inventory_display_uom_code = new.uom_code then
    new.inventory_display_uom_code := null;
    return new;
  end if;

  select * into canonical from units_of_measure where code = new.uom_code and active;
  select * into preferred from units_of_measure where code = new.inventory_display_uom_code and active;
  if not found or canonical.reference_code is null or canonical.conversion_factor is null
    or preferred.reference_code is distinct from canonical.reference_code
    or preferred.conversion_factor is distinct from canonical.conversion_factor
    or preferred.decimal_scale is distinct from canonical.decimal_scale then
    if tg_op = 'UPDATE' and new.uom_code is distinct from old.uom_code then
      new.inventory_display_uom_code := null;
      return new;
    end if;
    raise exception using errcode = '23514', constraint = 'inventory_display_uom_not_equivalent',
      message = 'Inventory display unit must be quantity-equivalent to the canonical unit.';
  end if;
  return new;
end;
$$;

drop trigger if exists parts_catalog_inventory_display_uom_trigger on parts_catalog;
create trigger parts_catalog_inventory_display_uom_trigger
before insert or update of uom_code, inventory_display_uom_code on parts_catalog
for each row execute function enforce_inventory_display_uom_equivalence();

comment on column parts_catalog.inventory_display_uom_code is
  'Local inventory label preference. Must be exactly quantity-equivalent to uom_code; canonical activity remains in uom_code.';
