# Quantity and units of measure

## Ownership

`shared/units-of-measure.js` is the only application-owned catalog of unit
codes, labels, symbols, categories, precision, and universal conversion
factors. Frontend and server code import that contract. They must not maintain
role-specific or workflow-specific unit lists.

PostgreSQL owns durable quantities, product inventory units, packaging
conversions, and external integration identifiers. UI state is not inventory
truth.

## Categories

| Category | Examples | Precision |
| --- | --- | --- |
| Count | each, piece, pair | Whole numbers |
| Packaging | case, box, jug, drum, cylinder | Whole numbers |
| Liquid volume | fluid ounce, quart, gallon, milliliter, liter | 3 decimals |
| Weight | ounce, pound, gram, kilogram | 3 decimals |
| Gas volume | cubic foot, cubic meter | 3 decimals |
| Length | inch, foot, yard, millimeter, centimeter, meter | 3 decimals |

Gas is not a standalone quantity. Refrigerant is normally measured by weight,
compressed gas may be measured by volume, and a physical cylinder is
packaging.

## Conversion rules

Universal conversions are allowed only between compatible measured units, such
as gallons and liters or pounds and kilograms. Packaging is product-specific:

- One case may contain 6, 12, or 24 individual parts.
- One jug may contain 1 gallon or 2.5 gallons.
- One drum may contain a product-defined volume or weight.
- Cylinders have product- and supplier-specific capacities.

Those relationships belong in `part_uom_conversions`, associated with the
catalog product and company. Never add a universal conversion factor for a
case, box, jug, drum, or cylinder.

## Data flow

1. A catalog product defines its inventory unit.
2. A request, allocation, or used-part row records a decimal quantity and unit
   code.
3. Inventory reservations and issues use the inventory unit.
4. A product-specific conversion is required when the source unit differs.
5. Print, timeline, chat, and surveillance surfaces format the same canonical
   quantity and symbol.
6. Odoo identifiers map to the same product unit or packaging conversion;
   Odoo does not become a second quantity truth.

## Compatibility

Existing quantities and clients without a unit code default to `ea`. Database
migrations must preserve current values before adding foreign keys or stricter
checks. JavaScript PostgreSQL numeric values must be parsed deliberately; do
not subtract driver-returned numeric strings.

## Inventory safety

V1 intentionally does not convert inventory between unlike units. A request
for `ea` cannot reserve stock stored as `case`, and a request for `gal` cannot
reserve stock stored as `qt`. Inventory selection verifies company, part,
location, and unit on the server even when the browser provides an inventory
item ID.

`part_uom_conversions` stores future product-specific mappings, but those
mappings must be explicitly administered or imported from Odoo before the
allocation service may use them. This avoids guessing that every case, drum,
or pallet has the same size.

The current Surveillance action records that an operator manually entered the
workorder in Odoo. It preserves the Owl quantity and unit snapshot but does not
claim that an automated Odoo unit conversion occurred. Automated posting must
validate `odoo_name` or an active product conversion before it is introduced.
