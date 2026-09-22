# Inventory basics implementation

## User workflow

Inventory → Storage locations manages the structure below an existing shop. Create a warehouse, then optional zones, aisles, racks, shelves and bins. Rooms and areas are also supported. Each position has a shop-unique code and a readable full path. Grouping positions organize the tree; stock positions can hold parts. Names can change and empty unused positions can be archived. Codes and parent links remain stable in this release.

Part details show configured selling/internal prices, purchase-cost evidence and physical stock by position. Missing cost remains Unknown, including when the latest receipt has no cost. Price edits retain reason, author and prior versions. Authorized financial readers see these details.

Receive stock through the existing intake or invoice flow. New receipts enter Receiving; move them into a chosen shelf or bin without changing shop totals. Existing stock with no trustworthy position enters Unassigned. Free-text historical bin labels are not treated as verified placement. Source selection limits serialized moves to eligible exact units currently at that position.

Start a count from a stock position, record observed quantities and let an authorized Admin apply corrections. Changes during counting require a fresh count. If another transaction is updating the count or its stock, applying returns a retry message without changing any quantities; retrying keeps the same request key. Serialized discrepancies require identity review rather than an automatic quantity correction.

## Research basis

The optional parent/child structure follows [Odoo location hierarchies](https://www.odoo.com/documentation/18.0/applications/inventory_and_mrp/inventory/warehouses_storage/inventory_management/use_locations.html). Separating the warehouse from aisle, rack, shelf and bin identifiers follows [Microsoft inventory location guidance](https://learn.microsoft.com/en-us/dynamics365/supply-chain/inventory/inventory-locations). These informed this application design; no external warehouse system is required.

## Integration rules

- Existing company and shop access remain the permission boundary. A warehouse is a child of a shop.
- Inventory owns physical positions. Workorders retain their existing assignment and approval workflow.
- A physical pick and the accounting consumption at approval are separate events; approval must not deduct bin stock twice.
- Receiving is pickable for compatibility with current shop availability.
- Nonpickable custody destinations use existing governed custody workflows; the new placement command does not implement aggregate quarantine/release.
- Unresolved legacy allocation or identity discrepancies block affected placement commands until reconciled.
- Purchases/PO automation, advanced valuation and AI actions remain subsequent phases of the master plan.

## Delivery and recovery

New migrations 133 and 134 add commercial history and physical positions to this repository's 132-migration baseline. The developer ZIP is reference material and is not overlaid onto this application.

Implementation and verification use disposable local databases only. Before an authorized hosted rollout, back up the target database and rehearse the populated upgrade against a restored copy. Capture accounting totals, reservations, exact-unit states and physical balances before and after migration. Stop rollout if reconciliation differs.

After new stock movements exist, do not drop the new tables or resume an older writer that ignores positions. Recovery requires a reviewed forward repair or restoring the database together with the matching application version; a database restore loses later writes unless separately recovered. Deployment and recovery actions require separate authorization.

See [the master plan](INVENTORY_OPERATING_SYSTEM_AND_SHARED_BRAIN_PLAN.md) for later phases and shared-brain architecture.
