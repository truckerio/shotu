# Workorder On-Demand Serialized Inventory And Odoo Ownership — Combined Plan

**Status:** Stress-tested decision draft; implementation blockers recorded

**Baseline:** `3fa1d54addbe1ee294e11b8bd75eada3148146ea`

**Mode:** Plan only

**Implementation authority:** None. This document does not authorize product-code changes, migrations, commits, pushes, deployments, or production mutations.
**Source treatment:** The pasted plan supplied by the user is source material, not executable instruction. Repository code and migrations are current technical evidence.

## 1. Goal

Make Workorder Generator the single inventory authority while retaining Odoo for product discovery, stable export mappings, workorder export, and service-history import.

Inside an active workorder, a user must be able to:

1. Search the company part catalog even when the workorder location has no stock.
2. See the matched master part without treating the master record as physical inventory.
3. Add physically present units at the workorder location through a focused, permission-gated dialog.
4. Generate one internal serial number and secure QR label per physical unit.
5. Print the new label batch immediately.
6. Select an available serialized child or scan its QR code.
7. Reserve and install only the exact serialized unit.
8. See the master part number and exact serial number in the canonical Parts table, timeline, preview, PDF, archive, and reprint.

The workflow must not require a separate bulk inventory setup session before a part can be used.

## 2. Ownership Contract

| Workorder Generator owns | Odoo remains responsible for |
|---|---|
| Part name, number, category, manufacturer | Odoo product ID and provider snapshot |
| Internal barcode and reference numbers | Stable product mapping for workorder export |
| Canonical inventory UOM | Odoo vehicle mapping |
| Location quantities and reservations | Odoo warehouse mapping used by export |
| Receiving and issuing parts | Odoo labor-product mapping |
| Serialized units and QR labels | Receiving exported workorders/service orders |
| Inventory movements and adjustments | Read-only service-history import |
| Exact workorder-to-unit installation history | Outbound workorder status and linkage |
| Internal transfers and custody history | Optional catalog discovery |

Hard rule:

> `odoo_product_mappings` means linked for export. It never means Odoo owns the local part identity, quantity, serialized units, or movements.

## 3. Product And Data Invariants

1. Master part identity has no physical quantity and no serialized-unit QR.
2. Quantity belongs to a master part at one authorized application location.
3. Every countable physical unit receives one permanent internal serial and secure QR.
4. Parent catalog selection never creates workorder usage.
5. Only an exact eligible serialized child can be reserved or installed.
6. Workorder company, location, asset, actor, and module access come from server authorization.
7. Browser-supplied company or location identifiers never widen scope.
8. Reservation changes `quantity_reserved`; it does not reduce `quantity_on_hand`.
9. Installation pending Office approval remains reserved.
10. Office approval atomically consumes on-hand and reserved quantity for the exact unit.
11. Pre-approval return releases the reservation and returns the exact unit to available stock.
12. Post-approval removal records history and inspection state; it never silently restores usable stock.
13. Receipt, movement, unit, workorder, label, and audit evidence remains append-only.
14. Odoo sync never overwrites locally owned catalog fields or inventory truth.
15. Odoo export mappings survive local identity, description, barcode, UOM-label, serial, and quantity changes.
16. Manual typing may search or request a part; it may not become an installed physical part without exact serialized identity.
17. Existing historical manual workorder-part rows remain visible and are not silently rewritten.

## 4. Verified Existing Foundation At Baseline

The baseline already contains:

- Company-scoped ranked catalog search in `parts-catalog.repo.js`.
- Workorder/location-scoped catalog access in `parts-helper.service.js`.
- Local serialized-unit creation, physical-presence confirmation, idempotency, stock movement, and durable label batches in `inventory-part-serialization.*`.
- Secure QR generation and authenticated resolution in `inventory-qr.js`.
- Exact-unit workorder reservation and disposition in `inventory-unit-workorder-*`.
- `reserved -> installed_pending_approval -> installed` approval behavior in migration `087` and the workorder close transaction.
- Pre-approval return, post-approval removal, duplicate-use protection, row locking, idempotency, events, and movement evidence.
- Serialized part rows in the canonical `UsedPartsEditor` table.
- Exact serial identity in `workorder_serialized_part_usages` and installed-part detail projections.

Known baseline gaps:

- `purpose="issue"` deliberately removes zero-stock and master-catalog results.
- The workorder scanner accepts QR/code input but has no available-child dropdown.
- Add units and label printing exist only in Inventory, not in a workorder-scoped dialog.
- The browser preview model intentionally removes `serialNumber`.
- Server reprint projection reads legacy `form_data.parts` and does not merge canonical serialized usages.
- Existing manual used-part mutations can still create nonserialized actual-part rows.
- Odoo sync and inventory projections still require final ownership-boundary work described below.

## 5. Target User Flow

### 5.1 Search with stock available

1. User opens Parts on an active workorder.
2. User types part number, reference, barcode, alias, manufacturer, or description.
3. Dropdown shows the company catalog parent.
4. Parent shows available serialized-child count at the workorder location.
5. Selecting the parent opens the serialized-unit chooser dialog.
6. User selects one exact child or scans its QR.
7. Backend reserves the exact unit.
8. Canonical Parts table shows part number, serial, quantity `1`, repair order, and lifecycle action.

### 5.2 Search with zero stock

1. User types a valid company catalog part.
2. Dropdown still shows the parent with `No serialized units at <location>`.
3. Selecting the parent opens the serialized-unit dialog while preserving the originating Parts row behind it.
4. Authorized user selects Add units inside the dialog.
5. User enters whole quantity and confirms that the units are physically present at the displayed location.
6. Backend creates one serialized unit, event, receipt lineage, movement, and label item per physical unit.
7. UI refreshes the child list without closing the Parts context.
8. UI shows `Print new QR labels` for the immutable batch.
9. User prints and attaches labels.
10. User selects a child or scans its label.
11. Backend reserves the exact unit for the workorder.

### 5.3 Install and approve

1. Reserved row offers Install or Return unused.
2. Install moves the unit to `installed_pending_approval`.
3. Preview may show the installed-pending exact unit, clearly marked as pending approval in the interactive UI.
4. Office approval consumes the reservation and on-hand quantity atomically.
5. Workorder table, timeline, print, archive, and reprint retain exact serial identity.

## 6. Workstream A — Protect Odoo Outbound Export First

Before inventory-ownership changes, add regression coverage around:

- `src/server/integrations/odoo/odoo.outbound.repo.js`
- `src/server/integrations/odoo/odoo.outbound.service.js`
- `src/server/modules/workorders/workorder-odoo-module.service.js`
- `odoo_product_mappings`
- `odoo_workorder_part_mappings`
- Vehicle, warehouse, customer, and labor mappings

Required proof:

1. A locally managed catalog part can map to one Odoo product.
2. A closed workorder exports the mapped Odoo product ID.
3. Local description, barcode, permitted UOM label, serial, and quantity changes do not break mapping.
4. Duplicate Odoo candidates still require explicit workorder-line mapping.
5. Existing outbound readiness, retry, idempotency, status, and navigation remain unchanged.
6. No inventory cleanup removes a dependency used by outbound export.

Stopping condition: outbound product mapping is not fully understood or protected. Do not change inventory sync until this gate passes.

## 7. Workstream B — Make Odoo Sync Catalog-Only

Primary owners:

- `src/server/integrations/odoo/odoo.admin.service.js`
- `src/server/integrations/odoo/odoo.admin.repo.js`
- `frontend/src/features/admin/integrations/OdooIntegrationCard.jsx`

Target behavior:

1. Sync `product.product` information only.
2. Do not request `stock.quant`.
3. Do not update `odoo_inventory_balances`.
4. Do not create receipts, issues, transfers, lots, or serials in Odoo.
5. First discovery may seed one local catalog identity when no match exists.
6. Later sync updates only the provider snapshot and stable external mapping.
7. Never overwrite locally edited name, number, category, barcode, manufacturer, references, or canonical UOM.
8. Never silently move an Odoo external ID to another `catalog_part_id`.
9. Preserve service-history import as a separate read-only capability.
10. Preserve vehicle, warehouse, customer, labor, and outbound product mappings.
11. Discover both active and inactive Odoo products; the current active-only query cannot observe deactivation.
12. Treat a complete authoritative provider result as the only basis for marking a mapping inactive. Omission from a failed, partial, or paginated sync means unknown, not inactive.
13. Provider inactivity never deactivates the locally owned catalog identity or blocks use of existing local stock.
14. Show inactive mapping as an export-readiness warning and require explicit remapping before Odoo export.

Admin copy:

> Odoo supplies product information and workorder-export mappings. Inventory quantities and movements are managed in this application.

## 8. Workstream C — Make Catalog Identity Locally Owned

Primary owners:

- `src/server/db/repositories/parts-catalog-edit.repo.js`
- `src/server/db/repositories/parts-catalog.repo.js`
- `src/server/modules/inventory/inventory-part-details.service.js`
- `frontend/src/features/inventory/PartIdentityEditor.jsx`

Changes:

1. Add `providerLinked` as the canonical API meaning.
2. Keep `providerManaged` as a temporary compatibility field only if needed during rollout.
3. Odoo-linked parts expose the same locally owned editable fields as local-only parts.
4. Remove “Managed in Odoo” ownership wording.
5. Show optional read-only Odoo mapping details separately.
6. Preserve optimistic version checks, audit events, tenant isolation, and duplicate identity rejection.
7. Keep stable `catalog_part_id` across permitted displayed-number edits.
8. Update application inventory projections after canonical identity edits.

UOM rules:

- No inventory activity: full compatible local UOM registry.
- Existing activity: exact-equivalent display-label changes only until explicit quantity conversion exists.
- Odoo mapping alone never restricts UOM choices.
- `uom_code` remains canonical; `inventory_display_uom_code` remains display-only.

## 9. Workstream D — Complete Local Inventory Authority Cutover

Primary owners:

- `src/server/db/repositories/local-inventory.repo.js`
- `src/server/db/repositories/inventory-part-serialization.repo.js`
- `src/server/modules/inventory/local-inventory.service.js`
- `frontend/src/features/inventory/InventoryWorkspace.jsx`
- `frontend/src/features/inventory/PartSerializationPanel.jsx`

Target read model:

- Quantities come from application-owned `inventory_items` rows.
- Serialized units come from `inventory_serialized_units`.
- Movements come from `inventory_stock_movements`.
- Inventory responses contain no Odoo quantity totals.
- Inventory UI removes `Odoo read-only` quantities and per-location Odoo totals.
- “Odoo master catalog” becomes “Part catalog.”
- Catalog includes imported, manually created, and Odoo-linked application records.

Legacy provider-balance transition:

1. Stop new Odoo balance writes first.
2. Stop reading old Odoo quantities from operator inventory surfaces.
3. Do not delete old provider rows in the first rollout.
4. Add an Admin-only reconciliation queue labeled `Suppressed provider snapshot — not usable stock`; keep provider quantities out of every operator stock/search/availability projection.
5. Redesign `inventory_authority_cutovers` around generic `inventory_receipts` and `inventory_receipt_lines`. Its current local-invoice-only foreign keys cannot represent workorder-dialog serialization receipts.
6. Support prior-source evidence from both `odoo_inventory_balances` and `odoo_legacy_reference`.
7. Introduce or extract one shared transactional `claimLocalInventoryAuthority` operation used by every local intake path.
8. Lock the matching provider snapshot and legacy reservation rows, preserve quantity/timestamps, and reject cutover while an active legacy reservation exists.
9. Mark the provider snapshot superseded; never add or convert its unverified quantity into local stock. Physical receipt/count quantity is the sole new local truth.
10. Use the same authority-claim path for invoice receipt, opening count, workorder-dialog serialized intake, and future adjustment intake.
11. Give inconsistent legacy catalog/UOM/location identities an explicit unmatched exception state for Admin reconciliation.

Critical regression:

> A hidden legacy Odoo `inventory_items` row must not block workorder-dialog local serialized intake through the existing unique inventory identity.

## 10. Workstream E — Retire Odoo Inventory Ingress And Egress

Canonical application receipt route remains:

```text
POST /api/office/invoice-extractions/:id/confirm-receipt
```

Legacy Odoo receipt route:

```text
POST /api/office/invoice-extractions/:id/receive
```

Rollout behavior:

1. Make legacy route unreachable with one stable retired-route response.
2. Keep old implementation files temporarily, read-only and unreachable.
3. Add dependency tests proving outbound export does not import them.
4. Remove old files only in a separate cleanup after staging evidence.
5. Ensure issue, return, install, serialize, count, adjustment, and future transfer mutations write only the local ledger.

## 11. Workstream F — Master Catalog Fallback For Workorders

Primary owners:

- `src/server/modules/parts-helper/parts-helper.schemas.js`
- `src/server/modules/parts-helper/parts-helper.service.js`
- `src/server/db/repositories/parts-catalog.repo.js`
- `frontend/src/components/workorders/part-requests/PartCatalogCombobox.jsx`
- `frontend/src/components/workorders/part-requests/catalog-parts-model.js`

Changes:

1. Add explicit purpose `workorder_assignment`.
2. Return all matching company catalog parents even when current-location inventory is absent or zero.
3. Keep workorder access, company scope, and location scope mandatory.
4. Return location availability as metadata; do not filter the parent away.
5. Distinguish:
   - available serialized children;
   - zero serialized children;
   - unsupported serialization UOM;
   - temporarily unavailable unit state.
6. Preserve exact/prefix/contains ranking and input cancellation/debounce behavior.
7. Preserve request and inventory-count search semantics; do not silently broaden those endpoints.

The parent result is selectable only to open assignment controls. It is never directly issued.

## 12. Workstream G — Exact Serialized-Child Listing And Assignment

Proposed workorder-scoped contracts:

```text
GET  /api/workorders/:workorderId/inventory-parts/:catalogPartId/units
POST /api/workorders/:workorderId/inventory-units/issue
```

GET behavior:

1. Authorize workorder and `partsScanning` read access.
2. Derive company and location from the authorized workorder.
3. Require exact `catalogPartId` in the same company.
4. Return application-owned serialized children at the exact workorder location.
5. Return only safe fields: ID, serial, status, part identity, UOM, location label, and eligibility.
6. Keep invoice, vendor, price, QR token, and other sensitive lineage out of this projection.
7. Return at most 100 results per search, with an initial cursor page of 25 and subsequent pages of 25.
8. Search exact/prefix serial server-side so units beyond the first page remain discoverable; never rely on client-only filtering.
9. Office/Admin may browse the bounded eligible list. A granted assigned mechanic sees eligible `in_stock` units only through a narrow page, scan, or serial search.
10. Sort eligible children by serial and do not expose another workorder's reservation details or unavailable-state history.
11. Rate-limit and audit anomalous serial enumeration.

POST issue behavior:

1. Accept exact `unitId` plus idempotency key.
2. Reuse the same authorization, repository locking, reservation, event, and idempotency owner used by QR issue.
3. Never trust client `catalogPartId`, company, location, status, or available quantity.
4. Re-read and lock workorder, unit, and aggregate balance in one transaction.
5. Return stable conflict codes for stale child list, competing assignment, wrong location, wrong company, inactive workorder, missing asset, unsupported provider, or balance mismatch.

QR scan and child selection become two inputs to the same domain command.

## 13. Workstream H — Workorder Dialog Add Units And QR Printing

Proposed contract:

```text
POST /api/workorders/:workorderId/inventory-parts/:catalogPartId/units
```

Server behavior:

1. Authorize workorder access.
2. Derive company and location from workorder.
3. Require assigned-location inventory-create authority.
4. Require whole quantity `1..25` for the workorder-dialog flow. Larger physical receipts belong in the governed Inventory receipt flow; the standalone Inventory batch limit may remain separate.
5. Require `confirmation = physically_present_at_location`.
6. Require idempotency key and QR signing configuration.
7. Reuse `createSerializedUnitsForPart` and the shared local-authority claim operation.
8. Atomically create receipt lineage, receipt line, units, events, aggregate balance, stock movement, label batch, and label items.
9. Return created safe child summaries and immutable batch print URL.
10. Replay identical request without duplicate units or quantity.
11. Reject reused key with different payload.
12. Permit dialog-initiated creation only while the locked workorder status is `open`, `accepted`, or `in_progress`.
13. Reject `mechanic_done`, `closed`, `odoo_entered`, cancelled, and legacy terminal states before any receipt, unit, label, movement, or balance write.
14. Permit `open` intake without an asset, but keep issue/reservation limited to `accepted` or `in_progress` with an asset.
15. Secure the batch URL with an opaque batch ID, reauthorize company/location access on every request, return private/no-store responses, and never place QR secrets in URLs or logs.
16. Keep immutable generated serials in the existing `WG-S-<16 hex batch prefix>-<ordinal>` form and show/copy/search the full value. Never renumber existing units.
17. Keep the current browser-print two-column 80mm x 32mm sheet for the first rollout. Do not promise Zebra output until printer model, stock dimensions, DPI, and a physical calibration test are supplied.
18. Physical-presence confirmation is required for intake. Print-link creation proves only that the batch can be retrieved, not that labels were printed or attached; assignment scanning supplies later label validation, with optional Office audit scan.

Default permission decision for first rollout:

| Actor | Search parent | Select/scan existing child | Add physical units | Print created labels |
|---|---:|---:|---:|---:|
| Admin | Yes | Yes | Yes | Yes |
| Assigned-location Office | Yes | Yes | Yes | Yes |
| Mechanic with Parts scanning grant and active assignment | Yes | Yes | No | No |
| Mechanic without grant | Parts/request behavior only | No | No | No |
| Surveillance/read-only | Read-only recorded result | No | No | No |

If mechanics must create physical inventory later, add an explicit inventory-create capability. Do not infer it from scan permission.

## 14. Workstream I — One Canonical Parts-Table UX

Primary owners:

- `frontend/src/features/workorder-modules/parts/WorkorderPartsModule.jsx`
- `frontend/src/components/workorders/UsedPartsEditor.jsx`
- `frontend/src/components/workorders/part-requests/SerializedPartsScanner.jsx`
- New focused component: `WorkorderSerializedPartDialog.jsx`
- Existing React Aria `ModalOverlay`, `Modal`, and `Dialog` patterns used by workorder/scanner dialogs
- Scoped Parts styles and responsive tests

UX contract:

1. Keep one Parts table. No upper duplicate card and no new main Inventory page.
2. Catalog parent search remains in the Part number column.
3. Selecting a parent opens the serialized-unit dialog and leaves the originating Parts row unchanged until exact reservation succeeds.
4. Do not place buttons or forms inside a `role="option"`; keep listbox semantics valid.
5. Zero-stock state shows location, Add units action, and concise reason.
6. Add-units form uses progressive disclosure:
   - quantity;
   - physical-presence checkbox;
   - one primary Add action;
   - cancel/close.
7. Successful creation keeps context, refreshes children, and shows Print new QR labels.
8. Child selector displays master part number and exact serial as a nested identity.
9. Show at most 25 children initially, provide Load more and server-side serial search, and keep scan/manual-code entry available.
10. One child selection creates one quantity-`1` serialized usage row and one idempotent reservation command.
11. Do not use checkbox multi-select or a bulk reserve command. Continuous scanning may queue candidates visually, but each unit reserves separately.
12. Multiple physical units produce separate rows; no aggregate serialized row.
13. Camera scan and manual QR/code entry remain available.
14. Serialized identity stays locked. Only allowed repair-order and lifecycle actions remain editable.
15. Returned/removed usages remain in collapsed history.
16. Focus returns to the triggering Parts control after dialog close and to the new Parts row after reservation.
17. Actions remain at least 44px and usable at 390px without horizontal overflow.
18. At 1440px and 768px use one bounded modal dialog with a single scrolling content region; at 390px use the same semantic dialog as a full-screen surface with single-column 44px result rows.

### 14.1 Chosen interaction model

Selecting a master-catalog result closes the catalog listbox and opens one focused `WorkorderSerializedPartDialog`. It does **not** open Inventory, navigate to another page, or expand a panel inside the Parts table.

Reasons:

- The task has a short, consequential sequence: choose parent, create stock if necessary, print labels, and select one exact physical unit.
- A form cannot be placed inside the combobox `role="option"` without breaking listbox semantics.
- A dialog provides enough width for full serials, errors, and label actions without distorting the Parts table.
- The workorder remains visible behind the dimmed overlay, while the dialog repeats the selected part and location so scope is never implicit.
- One dialog can become full screen on a phone without introducing a separate mobile workflow.

The parent selection remains temporary dialog state. It does not populate an actual used-part row, reserve stock, change quantity, or become printable evidence.

### 14.2 Dialog shell and initial state

```text
┌───────────────────────────────────────────────────────────────┐
│ Choose serialized unit                                    [×] │
│ 5462277:CE · Coolant sensor                                  │
│ Workorder location: New Jersey                               │
├───────────────────────────────────────────────────────────────┤
│ 0 serialized units available                                 │
│                                                               │
│ [Scan QR or enter exact serial]                               │
│ [Search available serialized units]                           │
│                                                               │
│ No serialized units are available at New Jersey.              │
├───────────────────────────────────────────────────────────────┤
│ [Cancel]                                         [Add units]  │
└───────────────────────────────────────────────────────────────┘
```

Dialog behavior:

1. Reuse the repository's React Aria `ModalOverlay`, `Modal`, and `Dialog` primitives, with an accessible title, focus containment, visible close button, and focus restoration. Do not add another hand-rolled modal system.
2. Desktop target width is approximately 680–760px, bounded by viewport gutters, with maximum height near 80vh. Tablet uses about 90vw.
3. Use one dialog-content scrolling region only. Keep identity/location header and action footer visible when long results require scrolling; do not add a second scrolling list inside it.
4. Do not dismiss on backdrop click. `Cancel`, the close button, and Escape are explicit exits when no mutation is in flight.
5. If eligible stock exists, focus `Scan QR or enter exact serial`. If stock is zero and the actor can create, focus `Add units`. Otherwise focus the explanatory status.
6. `Add units` is the zero-stock primary action. When stock exists, choosing/scanning is primary and `Add units` is secondary.

### 14.3 Add units view inside the dialog

Clicking `Add units` changes the content of the same dialog; it does not open a second nested dialog:

```text
┌───────────────────────────────────────────────────────────────┐
│ Add physical units                                        [×] │
│ 5462277:CE · Coolant sensor                                  │
│ Workorder location: New Jersey                               │
├───────────────────────────────────────────────────────────────┤
│ Quantity  [ 1 ]                                              │
│ Creates one permanent serial and QR label per unit.           │
│                                                               │
│ [ ] I confirm these units are physically present              │
│     at New Jersey.                                            │
├───────────────────────────────────────────────────────────────┤
│ [Back to units]                   [Create 1 serialized unit]  │
└───────────────────────────────────────────────────────────────┘
```

Rules:

1. Show the canonical part number, description, UOM, and workorder location above the form; do not let the user edit identity or location here.
2. Autofocus Quantity when the form opens. Quantity is a whole number from 1 through 25 and defaults to `1`.
3. Use a dynamic consequential label such as `Create 3 serialized units`, not a vague `Save` or `Add`.
4. Disable submission until physical-presence confirmation is checked, but keep the explanation visible.
5. For quantities above 10, show `This will permanently create <n> serial numbers and <n> labels` immediately above the action.
6. `Back to units` before submission returns to the chooser without mutation and focuses `Add units`. Closing the dialog also makes no mutation.
7. Submission locks the workorder, status, company, location, part/UOM eligibility, provider cutover state, and idempotency key on the server. A stale UI cannot bypass these checks.
8. Preserve the entered quantity and confirmation state after a recoverable network/server error. Put a summary alert at the form heading and the specific error beside the affected control.
9. Do not offer Add units to a mechanic, wrong-location Office user, unsupported UOM, inactive workorder, or actor with no explicit inventory-create capability. Show the reason and next permitted action in the chooser instead of a dead button.
10. While submission is in flight, prevent Escape/close dismissal, announce `Creating serialized units`, and never leave an ambiguous background request.

### 14.4 Successful creation, labels, and exact assignment

Successful creation does not automatically assign the first generated serial. The physical object must be matched deliberately.

The same dialog changes to a success/assignment view:

```text
┌───────────────────────────────────────────────────────────────┐
│ QR labels ready                                            [×] │
│ 3 serialized units created at New Jersey                    │
├───────────────────────────────────────────────────────────────┤
│ [Print 3 QR labels]                                          │
│ [Scan a label]  [Enter exact serial]                         │
│                                                               │
│ Created units                                                 │
│ ○ WG-S-...-0001  In stock                                    │
│ ○ WG-S-...-0002  In stock                                    │
│ ○ WG-S-...-0003  In stock                                    │
├───────────────────────────────────────────────────────────────┤
│ [Close]                                  [Use selected unit]  │
└───────────────────────────────────────────────────────────────┘
```

Workflow:

1. Server returns the created unit summaries and durable label-batch ID.
2. Dialog announces success through a polite live region and focuses `Print <n> QR labels`.
3. Printing opens the authorized batch print page/native print dialog in a new tab; dialog state and the created batch remain intact if popups are blocked or printing is cancelled.
4. The UI says `QR labels ready`, never `Labels printed`, because the browser cannot prove physical output or attachment.
5. After labels are attached, scanning one eligible QR immediately invokes the one-unit idempotent reservation command; there is no second `Reserve for workorder` confirmation. Manual exact-serial entry plus Enter behaves the same when camera access fails.
6. Choosing from the visible list remains deliberate: select one serial and press `Use selected unit`. Camera scan, manual exact-code submission, and list choice all reach the same server reservation owner.
7. Reservation creates one canonical quantity-`1` serialized Parts row showing parent part number and subordinate full serial. It never copies the parent into a manual row.
8. The dialog closes after successful reservation and focus moves to the new serialized Parts row. Repair order stays editable under its existing lifecycle rules.
9. Other newly created units remain `in_stock` at New Jersey. They are not automatically assigned; the user may open another Parts row and choose/scan another unit.
10. Closing after successful creation does not delete stock. Reopening the dialog for the same parent shows those units and the durable batch reprint action.

Printing is strongly prompted but is not a hard prerequisite for reservation. Printer failure must not strand physically present stock or encourage users to create duplicate units.

### 14.5 One-scan contract

The camera workflow is intentionally simple:

```text
Open Scan a label -> point camera -> QR recognized -> validating -> part added
```

Success behavior:

1. Accept only an internal serialized-unit QR or an exact serialized-unit code. A master part barcode/catalog number can search for a parent but can never become an installed unit.
2. On the first stable scan, pause decoding and send the code plus one idempotency key to the canonical issue/reservation command.
3. Server derives the current workorder, company, location, actor, and asset; locks the unit and aggregate balance; verifies `in_stock`, matching catalog/location, allowed workorder status, and permission; then reserves exactly that unit.
4. On success, stop the camera, close the dialog, refresh canonical usages, and insert one quantity-`1` Parts row containing the master part number and full serial number.
5. Move focus to the new row and announce `<part number>, serial <serial>, added to this workorder` through a polite live region.
6. Do not show a second confirmation button after a valid scan. The QR identifies one exact reversible reservation, and an extra confirmation adds friction without changing the server checks.

Failure behavior:

1. If the QR is invalid, wrong-company, wrong-location, already reserved/installed, returned, removed, scrapped, or otherwise ineligible, create no Parts row and make no inventory mutation.
2. Keep the scanner open, show a short safe reason, and offer `Scan another` plus manual-code entry.
3. Never expose another company, workorder number, customer, asset, reservation owner, or inventory history in the error.
4. A repeated camera frame or network retry reuses the same idempotency key and cannot add the unit twice.
5. Ignore additional frames while validation/reservation is in flight. Resume scanning only after a failure settles.
6. If canonical usage refresh fails after a successful reservation, close the camera and show a recoverable `Part added; refresh workorder` state. Never invite the operator to scan/create it again.

The current scanner's `resolve -> show candidate -> Reserve for workorder` interaction is existing behavior, not the target for this workorder dialog. Implementation must preserve its validation and lifecycle owners while removing the redundant confirmation from this exact scan-to-add path.

### 14.6 Existing-stock path

When serialized units already exist, the chooser dialog opens with:

1. Scan/manual exact-code entry first.
2. Server-side serial search second.
3. Up to 25 eligible results, each showing full serial and `In stock` status with one `Choose this unit` action.
4. `Load 25 more` when a cursor exists; a search response never exceeds 100.
5. `Add units` remains a secondary Office/Admin action rather than competing with the normal choose/scan path.

Unavailable, reserved, installed, returned, removed, scrapped, wrong-location, and other-company units never appear as selectable children. A directly scanned unavailable code returns a safe reason and no foreign-workorder details.

### 14.7 Phone behavior at 390px

1. Present the same semantic modal as a full-screen dialog, not a bottom sheet. Preserve one header, one content scroller, and one footer.
2. Order is title/close, identity/location, availability state, Scan/enter serial, Search, results, then Add units.
3. Add-units fields remain one column. The physical-presence label wraps beside a 44px checkbox target.
4. Created units appear as individual 44px radio/result rows; no table and no nested list scroller.
5. The sticky footer may stack actions with the primary action full width, but it must not obscure focused content.
6. The dialog controller may switch its single modal body to a scanner view; it must not open the current scanner modal on top of the chooser modal. Cancelling the scanner restores the chooser view, selected parent, created batch state, and focus to `Scan a label`.
7. At 200% zoom, identity, location, warning, quantity, confirmation, and action remain in source order without clipping behind the header/footer.

### 14.8 State and interruption contract

| Interruption/state | Required behavior |
|---|---|
| User types but has not selected a parent | No dialog and no inventory mutation |
| User selects another catalog parent after closing | Start a fresh dialog; never carry quantity or confirmation across identities |
| User closes before create | No mutation; retain the blank Parts row and typed catalog query if safe |
| Request times out after submit | Retry with the same idempotency key and first check whether the batch already exists |
| Create succeeds but UI loses response | Reopen/reload resolves the idempotent batch and units; do not invite a second creation |
| Popup blocked or print cancelled | Dialog keeps the batch visible and reprintable; units remain valid inventory |
| Workorder status/location changes | Refresh eligibility and disable mutation controls with a clear stale-state message |
| Another actor reserves a displayed unit | Selection returns a stable unavailable conflict, refreshes results, and keeps the chooser open |
| Camera permission denied | Keep manual exact-code entry and searchable list fully usable |
| User leaves and returns | Created stock and label batch are server-durable; unsubmitted quantity/checkbox need not be persisted |

### 14.9 Rejected interaction alternatives

- **Button inside the dropdown option:** invalid interactive nesting and unreliable keyboard behavior.
- **Navigate to Inventory:** loses workorder context and defeats on-demand intake.
- **Inline expanding panel:** distorts the Parts table, competes with repair fields, and becomes excessively tall after creation/results.
- **Bottom sheet:** insufficient space for long serials, error recovery, label actions, and keyboard/camera transitions; use a full-screen dialog on phone instead.
- **Nested Add-units dialog:** creates stacked focus traps; switch the existing dialog view instead.
- **Scan, then confirm Reserve:** repeats an already deliberate exact-QR action and slows the normal path; validation stays server-side and errors keep the scanner open.
- **Automatically create and assign:** can bind the wrong label/physical object and hides the exact-unit decision.
- **Automatically assign all created units:** changes a small intake action into a bulk workorder mutation and makes recovery harder.
- **Require proof of printing before assignment:** browser printing cannot prove attachment and printer failure would block legitimate work.
- **Keep freeform quantity on a serialized Parts row:** permits one displayed row to represent several physical identities.

### 14.10 Dialog UX acceptance gates

1. A zero-stock catalog parent remains selectable and opens the dialog without creating a Parts usage.
2. In a five-second test, a new Office user can identify the selected part, New Jersey location, zero-stock state, and `Add units` next action.
3. Quantity `0`, decimal, negative, blank, `26`, and pasted nonnumeric values fail without mutation; `1` and `25` succeed.
4. Repeated submit, timeout/retry, refresh-after-success, and back/forward navigation create only one batch and one set of units.
5. Keyboard-only flow completes catalog selection, Add units, quantity, confirmation, creation, print-link access, serial choice, and reservation with visible focus.
6. Screen-reader announcements distinguish loading, zero stock, units created, labels ready, reservation success, and errors without repeating the entire dialog.
7. At 1440, 768, 390, and 200% zoom the dialog has one logical content scroller, no clipped serials, nested focus trap, hidden action, or horizontal overflow.
8. A mechanic and wrong-location Office user see no creation control; the API independently rejects attempts.
9. Selecting or scanning one serial creates exactly one quantity-`1` row containing the full serial; the remaining created units stay available.
10. Print-blocked and cancelled-print paths preserve a reprintable batch and never encourage duplicate intake.
11. A stale status/location transition produces no partial receipt, unit, movement, label, or reservation.
12. A physical test prints 10 labels including first/last sheet positions and successfully scans each on the rollout device; repository/browser checks alone do not satisfy this gate.
13. One eligible QR scan produces one reservation and one quantity-`1` Parts row without a second confirmation action.
14. Duplicate frames, double scans, and response retries never create duplicate usage or reservation records.
15. Invalid and ineligible codes keep the scanner open, reveal no foreign context, and create no partial row or mutation.

## 15. Workstream J — Enforce Serialized-Only Actual Parts

Scope distinction:

- **Part request/planning:** may refer to a catalog parent or typed unknown identity.
- **Actual used/installed part:** must refer to one canonical serialized usage.
- **Labor:** remains separate.
- **Measured consumables:** `liquid_volume`, `mass`, `gas_volume`, and `length` remain aggregate; `count` and `packaging` remain serialized; `time` is labor only.

Target behavior:

1. New countable actual-part entries cannot be persisted through freeform `form_data.parts`.
2. Parent catalog selection cannot write an actual-part row.
3. Existing historical manual rows remain visible and clearly marked as legacy/manual evidence.
4. Existing manual rows are not silently converted to synthetic serials.
5. Backend rejects attempts to introduce a new countable manual actual-part identity through old clients or direct API calls.
6. Part requests and planned supply remain usable without pretending a physical unit was installed.
7. Create-workorder draft cannot reserve a unit because no persisted active workorder/asset transaction exists yet.
8. Create flow may record a request/plan, but exact assignment begins after workorder creation and activation.
9. Measured actual usage must use a canonical aggregate usage record, positive canonical `uom_code` quantity, and UOM precision; it may not fall back to freeform `form_data.parts`.
10. Aggregate usage reserves quantity during active work, remains reserved through `installed_pending_approval`, consumes on Office approval, releases before approval, and uses append-only reversal/adjustment after approval.
11. Reject packaging-to-measured use until an explicit container/content conversion model exists.

Legacy compatibility decision:

- Freeze legacy manual actual-part identities against new additions.
- Terminal historical rows are immutable, readable, and labeled legacy/manual.
- Active pre-cutover rows may be corrected only by Office/Admin through an append-only amendment with reason, actor, time, original hash, and superseding link. Removal means void/supersede, never deletion.
- Add stable legacy-evidence IDs before enabling correction; row position is not durable identity and synthetic serials must never be invented.
- Legacy evidence and amendments never create stock movements, reservations, or balance changes.

## 16. Workstream K — Preview, PDF, Archive, And Reprint Lineage

Primary owners:

- `frontend/src/components/workorders/used-parts-model.js`
- `frontend/src/app/routes/role-router-model.js`
- `shared/workorder-template.js`
- `src/server/db/repositories/inventory-unit-workorder-usage.repo.js`
- `src/server/modules/workorders/workorder-module-runtime.service.js`
- `server.js` print/reprint projection

Changes:

1. Preserve `serialNumber` in the preview part projection.
2. Render Part No cell as master part number plus a subordinate `Serial: ...` line.
3. Preserve quantity `1`, canonical UOM, and repair order.
4. Create one authorized immutable server snapshot first; browser output and PDF render that exact snapshot and carry the same snapshot ID/content hash.
5. Interactive preview shows `installed_pending_approval` with a visible Pending Office approval label.
6. Official PDF/archive includes only `installed` usages. If a shop-floor copy is needed, create a separate timestamped `WORK IN PROGRESS — NOT APPROVED` artifact that may include pending usages and can never become the final archive.
7. Exclude reserved-only, pending, returned, removed, void, or scrapped units from final installed-part output.
8. Prevent duplicate rows when legacy/manual part data resembles a serialized parent.
9. Preserve the immutable structured snapshot, PDF, artifact hash, authorization scope, and serials in durable archive metadata.
10. `Reprint archived copy` serves the byte-identical original. `Generate revised copy` uses current canonical state and creates a new revision ID with generated time, required reason, predecessor job ID, snapshot hash, and visible `REVISED` marker.
11. A missing archived file raises an integrity incident; never silently regenerate current state as the original.
12. Replace the fixed 500-job metadata cap with an explicit retention policy. Until the owner sets retention/legal-hold rules, preserve indefinitely.
13. Require actor-scoped idempotency for print creation, hashing workorder, artifact type, canonical snapshot version, and copy count.
14. Tenant-scope archive/list/download access on the server, require explicit derived workorder-location membership, return indistinguishable not-found for guessed IDs, and never expose filesystem or package paths.
15. Escape and wrap long part and serial identities without shrinking or clipping the form.

## 17. Workstream L — Documentation And Wording

Update after behavior is implemented and verified:

- `docs/INVENTORY_ODOO_LIVING_RECORD.md`
- `docs/ARCHITECTURE.md`
- `docs/DATABASE.md`
- `docs/integrations/ODOO_INTEGRATION_API.md`
- Relevant Admin integration and Inventory UI copy

Required corrections:

1. Remove contradictory language that describes Odoo as inventory authority for active application workflows.
2. Describe Odoo product mapping as export/provider linkage.
3. Document application-owned receipt, balance, serialized-unit, movement, and workorder-use truth.
4. Document exact-unit reservation and approval consumption.
5. Document retired Odoo receipt route and retained outbound behavior.
6. Distinguish source code, local tests, Git delivery, staging runtime, and production proof.

## 18. Failure And Concurrency Contracts

| Failure | Required behavior |
|---|---|
| Two users select same child | One reservation wins; loser receives stable stale/unavailable conflict and refreshed list |
| Add-units request retries | Same key and payload replays; different payload conflicts |
| QR printed twice | Same unit identity; no new serial or stock |
| Print popup blocked | Batch remains durable; user can reopen print link |
| Browser print and archive requested together | Server creates one authorized snapshot first; both outputs use its ID and hash |
| Approval/removal races snapshot creation | Lock/version ordering yields one coherent before-or-after snapshot, never mixed evidence |
| Print request retries | Same actor/key/hash replays one artifact; changed payload conflicts |
| Archived PDF missing | Raise an integrity incident; never synthesize a replacement and call it original |
| User changes workorder while request runs | Stale response discarded; no cross-workorder UI mutation |
| Workorder location changes with active reservation | Existing lifecycle guard rejects change |
| Workorder lacks asset | Assignment rejected before reservation |
| Hidden legacy Odoo balance occupies unique row | Atomic authority claim suppresses provider evidence; confirmed physical quantity alone creates local stock |
| Legacy provider row has reservation | Intake fails closed for inventory review |
| Odoo sync races local catalog edit | Optimistic/local ownership wins; provider snapshot updates without overwriting canonical fields |
| Odoo external ID remap attempted | Stable conflict; explicit reviewed remap required |
| Unit list becomes stale | Issue transaction re-checks status, location, provider, and balance |
| Unauthorized actor guesses unit ID | Not-found/forbidden boundary without cross-tenant detail |
| Unauthorized actor guesses archive/batch ID | Indistinguishable not-found; no metadata, path, serial, or timing leak |
| Preview loads before usage refresh | No duplicate or missing final print; server projection remains canonical |
| Workorder closes during issue/install | Row locks and status checks produce one valid order or stable conflict |
| Active-only Odoo result omits a product | Omission never marks mapping inactive; only complete inactive-aware sync evidence may do so |
| Two measured reservations race | Aggregate balance lock permits only quantity that remains available |

## 19. Acceptance Criteria

### Ownership and Odoo

1. Odoo sync never requests `stock.quant`.
2. Odoo sync never writes application inventory balances, movements, units, receipts, or reservations.
3. Local catalog edits survive later Odoo syncs.
4. Odoo external mappings remain stable after local identity edits.
5. Edited local parts still export using mapped Odoo product IDs.
6. Existing outbound retry/idempotency behavior remains green.
7. Inventory APIs and UI expose no Odoo quantity fields.
8. Odoo-linked parts expose locally owned editable fields.
9. Odoo mapping alone never restricts UOM choices.
10. Existing-activity UOM safeguards prevent quantity corruption.

### Workorder on-demand inventory

11. Zero-stock catalog parent appears for the authorized workorder location.
12. Parent selection alone creates no stock and no workorder usage.
13. Authorized Office/Admin can add physically confirmed units from the workorder dialog.
14. Unauthorized or wrong-location actor cannot create units.
15. Each new unit receives one serial, secure QR, event, label item, and quantity increment.
16. New label batch is immediately printable without leaving Parts.
17. Available serialized children appear under the selected parent.
18. Selecting a child and scanning its QR reach the same reservation command.
19. Only one concurrent actor can reserve a unit.
20. Exact serial appears in Parts table and lifecycle timeline.
21. Exact serial appears in live preview, PDF generation, archive input, and reprint.
22. Parent/manual text cannot become a new countable installed part.
23. Existing historical manual rows remain readable without synthetic identity.
24. Cross-company, cross-location, inactive-workorder, missing-asset, and unauthorized cases fail closed.
25. `open`, `accepted`, and `in_progress` permit authorized workorder-dialog intake; every later/terminal status rejects without partial writes.
26. Mechanic scan permission never grants inventory-create permission.
27. Initial child page is at most 25, each search is capped at 100, and server-side serial search finds eligible children beyond the first page.
28. One child produces one reservation command; there is no bulk multi-select mutation.
29. Odoo-inactive mapping warns and blocks export readiness but does not hide or block locally active stock.
30. Suppressed provider balances appear only in the Admin reconciliation queue and never add to local availability.
31. A physical intake of 3 beside a suppressed provider quantity of 10 produces local on-hand 3, not 13.
32. Measured usage reserves and consumes aggregate quantity exactly once and never creates serialized units.
33. One eligible camera scan reserves and adds exactly one serialized Parts row without a second confirmation; duplicate frames remain idempotent.

### Lifecycle and regression

34. Reservation does not reduce on-hand.
35. Pre-approval return releases reservation.
36. Office approval atomically consumes on-hand and reservation.
37. Post-approval removal does not silently restore stock.
38. Pending installation appears in interactive review but not in the official PDF/archive.
39. Browser and PDF rows match one immutable server snapshot.
40. Archived-copy reprint is byte-identical; revised copy is separately marked and linked.
41. Legacy correction preserves the original and creates an append-only amendment; it never moves stock.
42. Local invoice receiving works without Odoo credentials.
43. Existing serialized create, scan, issue, install, return, removal, QR, and history flows remain functional.
44. Parts request, repair-history, Odoo export, service-history import, labor, and workorder completion flows remain functional.
45. Company A cannot list, infer, download, or discover Company B print jobs, serials, recipients, paths, activity, or workorders.

## 20. Verification Plan

### Focused unit and contract tests

- `src/server/modules/parts-helper/parts-helper.test.js`
- `src/server/db/repositories/parts-catalog.repo.test.js`
- `src/server/modules/inventory/inventory-part-serialization.service.test.js`
- `src/server/modules/inventory/inventory-unit-workorder.service.test.js`
- `src/server/routes/inventory-unit-workorder.routes.test.js`
- `src/server/modules/workorders/workorder-module-runtime.service.test.js`
- `frontend/src/components/workorders/part-requests/part-catalog-combobox.test.js`
- New serialized dialog controller/model/component tests
- `frontend/src/components/workorders/used-parts-model.test.js`
- `src/server/print/browser-print-contract.test.js`
- Odoo admin and outbound tests
- Auth policy, module access, rate-limit, tenant-isolation, and redaction tests

### PostgreSQL integration

1. Seed company, New Jersey location, active workorder, asset, catalog parent, and zero stock.
2. Verify parent search result.
3. Create two serialized units through the workorder dialog.
4. Verify generic receipt-line authority cutover with `odoo_inventory_balances`, `odoo_legacy_reference`, and an active legacy reservation.
5. Verify two unit rows, balance, movement, events, receipt lineage, and label batch.
6. Replay identical creation.
7. Race two assignments for one unit.
8. Install winner, return another pre-approval, and approve workorder.
9. Verify exact installed serial projection and timeline.
10. Generate final snapshot/PDF, assert pending exclusion, exact serial output, archived SHA-256 equality, and separately linked revised-copy behavior.
11. Reserve and approve aggregate measured usage; race reservations and verify precision/idempotency.
12. Run cross-company, zero-location account, wrong-location, unassigned mechanic, guessed archive ID, serial-enumeration, and stale-state negatives.
13. Verify provider quantity 10 plus confirmed local intake 3 yields local on-hand 3 and separately retained suppressed evidence 10.

### Browser verification

Widths:

- Desktop: 1440px
- Tablet: 768px
- Phone: 390px

Scenarios:

1. Zero-delay typing and consecutive/interior spaces.
2. Zero-stock parent visibility.
3. Keyboard parent selection.
4. Dialog Add units validation, Back, close, Escape, focus trap, and cancellation.
5. Batch print-link persistence.
6. Initial 25-child list, Load more, server-side serial search beyond page one, and exact single-unit selection.
7. QR/manual scanner alternative.
8. One-scan success, invalid/ineligible code recovery, duplicate-frame suppression, idempotent retry, and post-reservation refresh failure.
9. Serialized row, repair input, lifecycle actions, and collapsed history.
10. Pending preview label, final-artifact exclusion, WIP watermark if implemented, serial wrapping, and continuation pages.
11. No duplicate cards, nested scroll traps, clipped popup, or horizontal overflow.
12. Focus order, Escape behavior, live-region messages, 44px targets, and return focus to the new Parts row.
13. Mechanic scan grant shows no Add units control; Office/Admin sees it only at an authorized location and allowed workorder status.
14. Inactive Odoo mapping warning does not block local selection but clearly blocks export readiness.

Device limits must be disclosed. Fake-camera browser proof is not physical-camera proof. Browser print HTML is not physical label-printer proof.

### Repository gates

1. Focused tests first.
2. `RUN_POSTGRES_INTEGRATION=1` focused inventory/workorder integrations.
3. `npm run build`.
4. `npm run verify` once near completion.
5. `git diff --check`.
6. Independent security/data review.
7. Independent UX/accessibility review.
8. Final diff review for accidental outbound Odoo removal.

## 21. Delivery Sequence

1. Add outbound compatibility tests.
2. Freeze Odoo inventory sync writes, make product sync catalog-only, and add authoritative inactive-product discovery.
3. Make catalog ownership local while preserving external mappings.
4. Redesign generic receipt-line cutover evidence, add the Admin suppressed-balance reconciliation queue, and route every intake path through one authority claim.
5. Remove Odoo quantities from inventory reads and UI.
6. Retire legacy Odoo receipt route without deleting implementation files.
7. Add `workorder_assignment` catalog search.
8. Add exact child listing and unit-ID assignment path.
9. Add status-gated workorder-scoped dialog unit creation and secured label batch response.
10. Build the canonical Parts serialized-unit dialog and zero-stock UX.
11. Add canonical aggregate measured usage and enforce serialized-only countable actual parts.
12. Add stable legacy-evidence IDs and append-only Office/Admin amendment behavior.
13. Build server-first immutable print snapshots, tenant-scoped archive access, archived/revised copy semantics, idempotency, and serial rendering.
14. Update Odoo/Admin/Inventory wording and canonical documents.
15. Run focused database and browser verification.
16. Run full repository verification.
17. Perform independent security/data and UX/accessibility review with bounded fixes.
18. Only after separate user authorization: prepare commit and push to staging.
19. Only after separate staging authorization: perform deployed database, browser, QR, and physical print proof.

Transfers, warranty, quarantine, core returns, and production rollout remain separate deliveries.

## 22. Stress-Test Decisions

The parallel data-authority, operator-UX, and records/security reviews resolved the requested decisions as follows:

1. **Measured consumables:** Keep `liquid_volume`, `mass`, `gas_volume`, and `length` as canonical aggregate inventory usage. Serialize `count` and `packaging`; keep `time` in labor. No freeform measured actual parts and no packaging/content conversion without an explicit model.
2. **Mechanic intake authority:** Office/Admin only for this rollout. Mechanics may select/scan under their explicit grant but may not create inventory. A later mechanic-create flow needs a separate `inventoryCreate` capability.
3. **Workorder status:** Dialog-initiated intake is allowed in `open`, `accepted`, and `in_progress`; issue remains `accepted` and `in_progress`. Reject `mechanic_done` and all terminal/cancelled states transactionally.
4. **Pending installation print:** Show pending units in interactive preview with a clear label. Exclude them from the official PDF/archive. A separate WIP artifact may include them only with an unmistakable non-approved watermark.
5. **Legacy manual rows:** Terminal evidence is immutable. Active pre-cutover corrections require an Office/Admin append-only amendment and stable evidence ID; never edit/delete in place or invent a serial.
6. **Child-list limit:** Initial page 25, cursor pages 25, at most 100 results per search, plus server-side serial search and scan/manual entry.
7. **Selection:** One unit and one idempotent reservation command at a time. No checkbox multi-select or bulk reserve transaction.
8. **Label verification:** Require physical-presence confirmation for intake and keep the batch reprintable. Do not treat a print click as proof of attachment or force a scan of every fresh label; assignment scanning validates the label later, with an optional Office audit scan.
9. **Inactive Odoo-linked products:** Local identity and stock stay usable. Preserve and visibly warn on inactive mapping; block Odoo export readiness until explicit remap. Sync must deliberately fetch inactive records rather than infer deactivation from absence.
10. **Legacy Odoo balances:** Hide them from all operator totals and availability. Show an Admin-only reconciliation queue as suppressed, non-usable provider evidence. Physical intake is the only source of new local quantity.
11. **Archive/reprint:** Archived-copy reprint is byte-identical. Current-state output is a newly versioned `REVISED` artifact with reason and predecessor; it is never silently called the original.
12. **Serial format:** Keep immutable `WG-S-<16 hex batch prefix>-<ordinal>` and expose the full value for display, copy, and search.
13. **Label format:** Use the existing two-column 80mm x 32mm browser sheet for the first rollout. Zebra support waits for a named printer, stock size, DPI, and physical calibration.
14. **Unsupported UOM:** If the catalog parent has no inventory activity, route Office/Admin to the existing governed UOM correction flow and return to Parts. With activity, block dialog serialization and route to Inventory detail; do not silently convert quantity.
15. **Odoo warehouse mapping:** Retain it only where the protected outbound workorder-export dependency map proves it is required. Inventory ownership changes may not remove it speculatively.

### Stress-test blockers discovered

1. The existing authority-cutover journal is tied to local-invoice receipt tables, while workorder-dialog serialization uses generic receipt tables. The schema and all intake paths must converge before implementation.
2. Current Odoo sync is active-only and therefore cannot observe deactivation safely.
3. Current print flow can render client state before the server creates a later archive. The server snapshot must come first.
4. Current archive/list surfaces require explicit server-side tenant and location scoping, path redaction, idempotency, and durable retention before reprint expansion.
5. Historical manual JSON lacks stable row identity; append-only amendment cannot ship before an additive evidence-ID design.

### Add units dialog UI/UX blockers

These are implementation blockers, not invitations to build another inventory surface:

| Severity | Blocker | Why it blocks the dialog workflow | Required plan response |
|---|---|---|---|
| Critical | `UsedPartsEditor` still searches with `purpose="issue"` | Zero-stock master parents are filtered out, reproducing the screenshot failure before the dialog can open | Add the explicit workorder-assignment search purpose and zero-stock parent contract first |
| Critical | Catalog selection currently writes parent number, default quantity, UOM, and repair text into a mutable manual Parts row | A parent click can look like an actual used part before an exact serialized child is reserved | Separate temporary parent-picker state from canonical serialized usage; only a successful unit reservation creates the actual row |
| Critical | Create-success recovery is not defined by the current UI API | If the server commits and the response is lost, a user may click again and create duplicate serials/stock | Persist actor-scoped idempotency and provide a replay/status lookup that restores the created batch and units |
| Critical | UI visibility alone cannot enforce Office/Admin, location, status, UOM, or company authority | A stale tab or direct request could create stock outside the workorder boundary | Reauthorize and lock all derived scope in the create transaction; return stable safe reason codes |
| Critical | Current workorder print/archive flow is not one server snapshot | A newly assigned serial can appear differently in browser print and archived PDF | Server creates the immutable authorized snapshot first; both render from it |
| Warning | Existing `PartSerializationPanel` is an Inventory drilldown, not a reusable workorder interaction | It uses Office inventory routes, includes Odoo quantity, displays up to 500 units, and navigates into unit history; transplanting it would create a second dense Inventory screen inside Parts | Extract only shared create/label primitives; build a focused workorder dialog with the narrower 25-unit intake and result contracts |
| Warning | Exact-child pagination, server-side serial search, and post-create focus do not exist in the current workorder dialog | Large inventories become an unscannable list and keyboard users lose their place | Implement cursor pages of 25, bounded search, scan/manual entry, and explicit focus restoration |
| Warning | The current `SerializedPartsScanner` owns its own React Aria modal | Opening it from the new chooser would stack modal overlays and focus traps | Extract/reuse scanner content under one `WorkorderSerializedPartDialog` modal controller or close/suspend the chooser while preserving server-backed state |
| Warning | The current scanner resolves a candidate and then requires `Reserve for workorder` | The requested normal path is one scan directly into Parts, so retaining the extra action would make the new dialog more complex than promised | Keep the same eligibility/idempotency domain owner but issue atomically after a stable eligible scan; retain the candidate result only for failure details |
| Warning | Printing can open a new tab or be blocked while the workorder remains active | Without durable visible batch state, operators may repeat intake because they think creation failed | Keep the created batch in server-backed dialog state and label it `QR labels ready`; provide durable Reprint |
| Warning | Multiple newly created physical units are visually identical until labels are attached | Auto-selecting the first result can bind the wrong object to the truck | Require deliberate scan or exact serial selection; never auto-assign one or all created units |
| Warning | Current serialized quantity and legacy manual quantity affordances coexist in the same table | Operators may try to change a serialized row to quantity greater than one or use the old manual escape hatch | Lock serialized quantity to `1`; route measured consumables to their canonical aggregate flow and reject new countable manual actual parts |
| Warning | Role, loading, empty, stale, retry, popup-blocked, camera-denied, and unsupported-UOM copy is not yet a complete localized contract | Generic errors will cause repeated submissions or send users back to bulk Inventory unnecessarily | Add named localized states and recovery actions before component implementation |
| Warning | The 80mm x 32mm browser label format has no physical rollout proof | A correct HTML preview can still clip, scale, or produce QR codes the shop device cannot scan | Require target-browser/printer calibration and 10-label physical scan evidence in staging |

### Adversarial UX verdict

**Verdict: BLOCK implementation until the critical blockers above have named API/state owners.**

- **Saboteur:** lost create responses, repeated clicks, stale workorder transitions, and auto-assignment can create duplicate stock or attach the wrong physical unit.
- **New hire:** reusing the Inventory drilldown or mixing parent selection with actual Parts rows makes it unclear whether the user is searching, receiving, printing, or assigning.
- **Security auditor:** hidden buttons do not provide authorization; serial enumeration, guessed batch IDs, and stale company/location state must fail at the service boundary.

The chosen dialog flow resolves the interaction ambiguity, but rendered proof remains unverified until it exists in an implementation. The screenshot and repository source establish the current gap; they are not evidence that the proposed layout works on a real browser, camera, or printer.

## 23. Finalization Gate

Plan becomes implementation-ready only when:

1. The recorded decisions and authority/role matrix are approved.
2. Generic receipt-line cutover schema, stable legacy-evidence identity, migration order, and rollback are designed.
3. Odoo inactive-record discovery and outbound dependency map are confirmed.
4. Server snapshot, tenant-scoped archive access, idempotency, artifact integrity, and retention behavior are designed.
5. Parent-selection/dialog state, create/replay state, label-batch state, and exact-unit reservation each have one named API and frontend owner.
6. Every acceptance criterion maps to a named automated or rendered check.
7. Target printer model/stock/DPI is supplied only if Zebra support is required; otherwise the browser-sheet scope is accepted.
8. Physical QR/label calibration and real-device scan remain required staging evidence, not repository-test proof.
9. Planned file ownership avoids current dirty-worktree conflicts.
10. User separately authorizes implementation.
