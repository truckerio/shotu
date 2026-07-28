create table if not exists units_of_measure (
  code text primary key,
  label text not null,
  symbol text not null,
  category text not null check (category in (
    'count', 'packaging', 'liquid_volume', 'mass', 'gas_volume', 'length'
  )),
  decimal_scale smallint not null check (decimal_scale between 0 and 3),
  reference_code text,
  conversion_factor numeric(20, 10) check (conversion_factor is null or conversion_factor > 0),
  odoo_name text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into units_of_measure (
  code, label, symbol, category, decimal_scale, reference_code, conversion_factor, odoo_name
) values
  ('ea', 'Each', 'ea', 'count', 0, 'ea', 1, 'Units'),
  ('pc', 'Piece', 'pc', 'count', 0, 'ea', 1, 'Units'),
  ('pair', 'Pair', 'pair', 'count', 0, 'ea', 2, ''),
  ('set', 'Set', 'set', 'packaging', 0, null, null, ''),
  ('pack', 'Pack', 'pack', 'packaging', 0, null, null, ''),
  ('box', 'Box', 'box', 'packaging', 0, null, null, ''),
  ('case', 'Case', 'case', 'packaging', 0, null, null, ''),
  ('roll', 'Roll', 'roll', 'packaging', 0, null, null, ''),
  ('tube', 'Tube', 'tube', 'packaging', 0, null, null, ''),
  ('cartridge', 'Cartridge', 'cartridge', 'packaging', 0, null, null, ''),
  ('bottle', 'Bottle', 'bottle', 'packaging', 0, null, null, ''),
  ('can', 'Can', 'can', 'packaging', 0, null, null, ''),
  ('jug', 'Jug', 'jug', 'packaging', 0, null, null, ''),
  ('pail', 'Pail', 'pail', 'packaging', 0, null, null, ''),
  ('drum', 'Drum', 'drum', 'packaging', 0, null, null, ''),
  ('cylinder', 'Cylinder', 'cyl', 'packaging', 0, null, null, ''),
  ('fl_oz', 'Fluid ounce', 'fl oz', 'liquid_volume', 3, 'ml', 29.5735295625, ''),
  ('pt', 'Pint', 'pt', 'liquid_volume', 3, 'ml', 473.176473, ''),
  ('qt', 'Quart', 'qt', 'liquid_volume', 3, 'ml', 946.352946, ''),
  ('gal', 'Gallon', 'gal', 'liquid_volume', 3, 'ml', 3785.411784, ''),
  ('ml', 'Milliliter', 'mL', 'liquid_volume', 3, 'ml', 1, 'Milliliters'),
  ('l', 'Liter', 'L', 'liquid_volume', 3, 'ml', 1000, 'Liters'),
  ('oz', 'Ounce', 'oz', 'mass', 3, 'g', 28.349523125, ''),
  ('lb', 'Pound', 'lb', 'mass', 3, 'g', 453.59237, 'lb'),
  ('g', 'Gram', 'g', 'mass', 3, 'g', 1, 'g'),
  ('kg', 'Kilogram', 'kg', 'mass', 3, 'g', 1000, 'kg'),
  ('ft3', 'Cubic foot', 'ft³', 'gas_volume', 3, 'ft3', 1, ''),
  ('m3', 'Cubic meter', 'm³', 'gas_volume', 3, 'ft3', 35.3146667215, ''),
  ('in', 'Inch', 'in', 'length', 3, 'mm', 25.4, ''),
  ('ft', 'Foot', 'ft', 'length', 3, 'mm', 304.8, 'ft'),
  ('yd', 'Yard', 'yd', 'length', 3, 'mm', 914.4, ''),
  ('mm', 'Millimeter', 'mm', 'length', 3, 'mm', 1, ''),
  ('cm', 'Centimeter', 'cm', 'length', 3, 'mm', 10, 'cm'),
  ('m', 'Meter', 'm', 'length', 3, 'mm', 1000, 'm')
on conflict (code) do update set
  label = excluded.label,
  symbol = excluded.symbol,
  category = excluded.category,
  decimal_scale = excluded.decimal_scale,
  reference_code = excluded.reference_code,
  conversion_factor = excluded.conversion_factor,
  odoo_name = excluded.odoo_name,
  active = true,
  updated_at = now();

alter table units_of_measure
  add constraint units_of_measure_reference_code_fkey
  foreign key (reference_code) references units_of_measure(code);

alter table parts_catalog add column if not exists uom_code text;
alter table inventory_items add column if not exists uom_code text;
alter table workorder_part_requests add column if not exists uom_code text;
alter table part_allocations add column if not exists uom_code text;

update parts_catalog set uom_code = 'ea' where uom_code is null;
update inventory_items set uom_code = 'ea' where uom_code is null;
update workorder_part_requests set uom_code = 'ea' where uom_code is null;
update part_allocations allocation
set uom_code = coalesce(request.uom_code, 'ea')
from workorder_part_requests request
where request.id = allocation.part_request_id
  and allocation.uom_code is null;

alter table parts_catalog alter column uom_code set default 'ea';
alter table parts_catalog alter column uom_code set not null;
alter table inventory_items alter column uom_code set default 'ea';
alter table inventory_items alter column uom_code set not null;
alter table workorder_part_requests alter column uom_code set default 'ea';
alter table workorder_part_requests alter column uom_code set not null;
alter table part_allocations alter column uom_code set default 'ea';
alter table part_allocations alter column uom_code set not null;

-- PostgreSQL will not alter inventory quantity types while this view depends on
-- them. Recreate it below as part of the same transaction.
drop view if exists v_inventory_availability;

alter table inventory_items drop constraint if exists inventory_items_quantity_on_hand_check;
alter table inventory_items drop constraint if exists inventory_items_quantity_reserved_check;
alter table workorder_part_requests drop constraint if exists workorder_part_requests_quantity_check;
alter table part_allocations drop constraint if exists part_allocations_quantity_check;

alter table inventory_items
  alter column quantity_on_hand type numeric(14, 3) using quantity_on_hand::numeric,
  alter column quantity_reserved type numeric(14, 3) using quantity_reserved::numeric;
alter table workorder_part_requests
  alter column quantity type numeric(14, 3) using quantity::numeric;
alter table part_allocations
  alter column quantity type numeric(14, 3) using quantity::numeric;

alter table inventory_items
  add constraint inventory_items_quantity_on_hand_check check (quantity_on_hand >= 0),
  add constraint inventory_items_quantity_reserved_check check (
    quantity_reserved >= 0 and quantity_reserved <= quantity_on_hand
  );
alter table workorder_part_requests
  add constraint workorder_part_requests_quantity_check check (
    quantity > 0 and quantity <= 999999.999
  );
alter table part_allocations
  add constraint part_allocations_quantity_check check (
    quantity > 0 and quantity <= 999999.999
  );

alter table parts_catalog
  add constraint parts_catalog_uom_code_fkey
  foreign key (uom_code) references units_of_measure(code);
alter table inventory_items
  add constraint inventory_items_uom_code_fkey
  foreign key (uom_code) references units_of_measure(code);
alter table workorder_part_requests
  add constraint workorder_part_requests_uom_code_fkey
  foreign key (uom_code) references units_of_measure(code);
alter table part_allocations
  add constraint part_allocations_uom_code_fkey
  foreign key (uom_code) references units_of_measure(code);

create table if not exists part_uom_conversions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  catalog_part_id uuid not null,
  from_uom_code text not null references units_of_measure(code),
  to_uom_code text not null references units_of_measure(code),
  conversion_factor numeric(20, 10) not null check (conversion_factor > 0),
  provider text not null default '',
  external_id text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint part_uom_conversions_catalog_company_fkey
    foreign key (company_id, catalog_part_id)
    references parts_catalog(company_id, id)
    on delete cascade,
  constraint part_uom_conversions_distinct_units_check
    check (from_uom_code <> to_uom_code),
  unique (company_id, catalog_part_id, from_uom_code, to_uom_code)
);

create unique index if not exists part_uom_conversions_provider_external_uidx
  on part_uom_conversions(company_id, provider, external_id)
  where provider <> '' and external_id <> '';

create index if not exists part_uom_conversions_catalog_idx
  on part_uom_conversions(company_id, catalog_part_id)
  where active;

create view v_inventory_availability as
select
  inventory.id,
  inventory.company_id,
  company.slug as company_slug,
  location.id as location_id,
  location.name as location_name,
  inventory.catalog_part_id,
  inventory.normalized_part_number,
  inventory.part_number,
  inventory.manufacturer,
  inventory.description,
  inventory.quantity_on_hand,
  inventory.quantity_reserved,
  greatest(inventory.quantity_on_hand - inventory.quantity_reserved, 0) as quantity_available,
  inventory.uom_code,
  inventory.bin_location,
  inventory.updated_at
from inventory_items inventory
join companies company on company.id = inventory.company_id
left join locations location
  on location.id = inventory.location_id
 and location.company_id = inventory.company_id;

comment on table units_of_measure is
  'Canonical global unit catalog. Application definitions live in shared/units-of-measure.js.';
comment on table part_uom_conversions is
  'Company and product-specific packaging or purchase conversions, including Odoo mappings.';
comment on view v_inventory_availability is
  'Location inventory with computed available quantity and its canonical unit of measure.';
