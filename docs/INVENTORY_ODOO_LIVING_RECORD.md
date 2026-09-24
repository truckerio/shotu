# Odoo Inventory And Workorder Parts — Living Record

**Status:** Canonical current-state record<br>
**Last verified:** 2026-09-22<br>
**Verified against:** local working tree at base commit `8602591cfdbe1d9d2f37050f66ecfcf13cd78409`<br>
**Scope:** Odoo product/inventory integration, workorder part requests, local inventory projection, future receiving/scanning/issuing/core workflows

## How To Use This File

Start every inventory- or Odoo-parts task here. Source code and migrations remain executable truth; this file is the maintained map of that truth.

Every related implementation change must do both:

1. Update the affected statement in **Current Verified State**.
2. Append one entry to **Change Log** with files, behavior, evidence, and remaining gaps.

Do not silently replace history. If an earlier statement becomes wrong, update the current-state section and preserve the transition in the log. Mark unverified claims `UNKNOWN`; never promote a plan to `IMPLEMENTED` without repository and test evidence.

### Change-entry format

```md
### INV-YYYYMMDD-NN — Short title

- Status: PLANNED | IMPLEMENTED | VERIFIED | RELEASED | REVERTED
- Decision/requirement:
- Before:
- After:
- Canonical owners:
- Data/API changes:
- User-experience changes:
- Authorization/security changes:
- Failure/reconciliation behavior:
- Verification:
- Release evidence:
- Remaining gaps:
```

`IMPLEMENTED` means code exists locally. `VERIFIED` means named checks passed against the recorded revision. `RELEASED` requires deployment and production evidence; a local test is not release proof.

## Product Decision

As of the local-inventory vertical, Workorder Generator is the inventory system
of record for application-owned invoice receipts, stock movements, and current
location balances. Odoo is optional compatibility/integration software and is
not required to add, read, or audit local inventory.

Local authority rules:

- One reviewed invoice posts at most one local receipt.
- `inventory_stock_movements` is append-only audit evidence.
- `inventory_items` rows with `source_provider = 'local'` are the current-balance projection.
- Corrections use compensating movements; receipt and movement history is not deleted.
- Odoo inventory synchronization may not overwrite a local-authority balance row.
- Company, role, and location scope always come from the authenticated server actor.

The following Odoo authority description applies only when a company explicitly
uses the optional Odoo-controlled inventory mode and to the retained historical
Odoo receipt slice:

Odoo remains inventory system of record for:

- Products and product barcodes
- Warehouses, stock locations, and bins
- Lots, serial numbers, and packages
- On-hand and reserved quantities
- Receipts, transfers, and stock movements
- Inventory valuation

Workorder Generator owns:

- Mechanic part requests and Office decisions
- Shop scan sessions and evidence
- User-facing receiving, pick, issue, installation, return, and core tasks
- Exact workorder, truck, mechanic, and part relationships
- Core obligations and their business workflow
- Provider-command status, exceptions, and reconciliation tasks
- Fast read-only Odoo projections for operator screens

Boundary rule: Workorder Generator may store workflow state and projections. It must not become a second authoritative stock ledger after Odoo stock commands are introduced. Quantity-changing success must follow confirmed Odoo results, not precede them.

## Current Verified State

### Developer source integration (2026-09-15, local)

Currency entry uses the shared `CurrencySelector` dropdown in purchase orders, supplier bills, part prices, tax profiles and purchase approval settings. Existing currency values and API payloads are retained.

Local stabilization: PO and purchase-request receiving retain the completed receipt and label-print action until explicitly dismissed. An unsubmitted receipt draft cannot override a different explicitly selected shop; previously submitted commands retain their original shop and idempotency key for recovery. New damage/transfer tasks reset their prior part, serial and destination state. Verification is recorded in the external inventory-stabilization task report.

`IMPLEMENTED`: the developer ZIP's purchasing, approval, delivery, bill-document, stock-task and reporting workflow is integrated into the staging-derived local application. Existing position accounting and Workorder lifecycle are retained; incompatible imported count writes are routed to position counts. See [Developer source integration](specs/DEVELOPER_SOURCE_INTEGRATION.md) for source decisions, verification boundaries and unfinished batch/location pricing work. No hosted release is claimed.

### Inventory catalog pricing — 2026-09-15 local implementation

Part detail now presents compact stock totals, a single Prices summary, contextual editors and secondary history/tax controls. Empty identity fields and repeated header facts are omitted from the read view; edits retain the complete identity form. The UX change preserves existing financial services and stock actions. Local rendered and regression evidence is tracked in the part-detail-ux task.

`IMPLEMENTED` locally: purchase-cost observations remain distinct from independently versioned internal and selling prices. Migration 135 adds company tax profiles and immutable versions; each price records explicit tax treatment and an exact profile version. Older price tax assumptions remain unknown. Inventory previews calculate quantity, discount, net, named taxes and total using exact decimal arithmetic. Office/Admin financial permissions and company scope apply. See [pricing design and research](specs/INVENTORY_PRICING_AND_TAX_IMPLEMENTATION.md). Local authenticated browser checks pass; full-suite and independent review evidence is tracked in the pricing task. This is not a hosted release. Workorder billing snapshots and Odoo commercial export mapping remain separate work.

`IMPLEMENTED` locally on 2026-09-17: migration 152 adds location-scoped internal and selling price versions while preserving a company default. Reads identify whether the effective value came from a location override or the company default; an explicit Unknown override masks the default and a zero value remains known. Receipt-cost evidence is filtered to the requested location and distinguishes invoice-linked cost, missing invoice-line cost, and unpriced receipts. The current Part detail UI has not yet moved these controls inside each location; this slice establishes the safe data and API boundary first.

`IMPLEMENTED` locally on 2026-09-22: migration 173 adds current Odoo `standard_price` and `lst_price`/`list_price` commercial snapshots, currency, provider timestamp and stable labor-source linkage. Catalog sync introspects supported product fields and refreshes mapped part and already-discovered service-product snapshots. Local configured price versions remain authoritative; Odoo values appear only as labeled fallback/reference when no local decision exists. Confirmed receipt cost and Odoo purchase-order history remain separate evidence. Authorized Office/Admin labor searches can see the linked Odoo selling rate; mechanic responses redact provider commercial facts. No hosted migration or live Odoo price import is claimed.

### Tracking-aware manual intake — local implementation, 2026-09-10

Saved catalog tracking now chooses physical intake: serialized parts retain exact-unit creation and labels; `quantity` uses whole counts/packages; `measured_bulk` uses the canonical measurement and precision. Inventory, Create, and saved Workorder aggregate intake reuse `StockIntakeControl`. Catalog selection does not receive or issue stock. Unreviewed count parts are not silently treated as serialized.

The new `/api/office/inventory/parts/:id/locations/:id/stock-intake` endpoint records an idempotent manual intake batch, confirmed receipt, aggregate receipt line, movement, and local balance in one transaction. Migration `130_inventory_manual_stock_intake.sql` is required. It was tested on disposable PostgreSQL, not applied to the configured database. Authenticated in-app verification and deployment remain unverified.

### Executive verdict

The repository has a self-contained local inventory vertical. Office and Admin
can confirm a complete physical delivery from a reviewed invoice without Odoo,
producing one idempotent receipt, durable lines, append-only stock movements,
location balances, one application serial per discrete unit, and a durable
printable-label batch. A shared Inventory workspace exposes bounded stock,
invoice history, and a reusable right-side part detail surface. An authorized
workorder actor can reserve an exact QR/manual unit without reducing on-hand,
record installation pending Office approval, or explicitly return it to
available stock. Office approval atomically consumes pending installed units;
later removal is recorded in unit/workorder history without silently returning
the used item to on-hand. Aggregate supply recommendations remain a separate
legacy allocation path and are not bound to exact serialized reservations.

The retained Odoo receipt path remains optional compatibility behavior. A
bounded opening-count import now reuses Odoo-synchronized master identities,
persists every source row as review evidence, and applies only physically
confirmed exact matches as serialized local stock. It does not create or edit
master parts. The local vertical still does not implement partial/damaged receipt posting,
transfer execution, purchasing, valuation, warranty/problem
reporting, cores, or a dedicated Parts role.

### Capability matrix

| Capability | State | Current owner/evidence | Meaning |
|---|---|---|---|
| Company part catalog | IMPLEMENTED | `parts_catalog`; `part_reference_numbers`; catalog/inventory repositories | Company-scoped part search and audited Office/Admin editing. Odoo-managed identity fields remain provider-owned. |
| Odoo location discovery/mapping | IMPLEMENTED | `src/server/db/migrations/042_odoo_inventory_sync.sql`; `odoo.admin.service.js` | Admin maps Odoo internal locations to app locations. |
| Odoo product mapping | IMPLEMENTED | migrations `043` and `059` | Stable `product.product` mapping; explicit workorder-line choice when duplicate Odoo products map to one catalog part. |
| Odoo catalog read sync | IMPLEMENTED | `syncOdooPartsAndInventory`; `importOdooInventory` | Reads active products, reconciles only explicitly mapped inactive products, and upserts catalog/product mappings without changing local stock. |
| Lot/serial/package projection | PARTIAL, LOCAL AND ODOO RECEIPTS VERIFIED | `inventory_serialized_units`; migrations `064` and `066`; local and Odoo receipt repositories | Whole count/package local receipts and Odoo serialized receipts preserve exact unit identities in one canonical table. Measured local quantities remain aggregate; general lot/package lifecycle is still absent. |
| Mechanic part request | IMPLEMENTED | mechanic parts route, `MechanicPartRequestForm.jsx` | Mechanic submits structured request inside a workorder. |
| Office review and supply recommendation | PARTIAL, LOCAL VERIFIED | `part-fulfillment.service.js`; `OfficeRequestCard.jsx`; `GetPartsFlow.jsx` | Office can ask the backend for a location-scoped local-stock recommendation and approve that recommendation. Approval is audit evidence only; it does not reserve or move stock. Legacy aggregate allocation remains separate. |
| Local issue/return quantity updates | IMPLEMENTED, TEMPORARY ARCHITECTURE | `part-requests.repo.js` | Reserved→issued decrements local balance; issued→returned increments it. No Odoo stock command is made. |
| Serialized-part workorder disposition | LOCAL VERIFIED | `SerializedPartsScanner.jsx`; `inventory-unit-workorder.service.js`; inventory reuse/custody services; migrations `087` and `169` | Exact local units move through reserved → installed pending approval → installed. A post-install removal creates exact custody with Workorder, Unit, receipt, and purchase lineage; physical receipt, inspection, repair, quarantine, core, scrap, and exact-position reuse remain separate guarded transitions. Mechanics remain denied by default and require an explicit Part scanning grant plus active assignment. |
| Workorder completion guard | PARTIAL, EXACT-UNIT LOCAL VERIFIED | operational workorder repository lifecycle guards | Work done continues to block unresolved reserved units but accepts an explicitly installed-pending-approval unit. Office close consumes every pending installed unit in the same transaction and records approval evidence. Cancel, reassignment, and self-release fail closed while exact reservations remain active. Legacy aggregate requests retain their existing guards. |
| Odoo service-order export | IMPLEMENTED, SEPARATE DOMAIN | `odoo.outbound.*`; migrations `048`, `056`, `059` | Creates a draft Odoo Sales service order after readiness checks. It intentionally does not confirm orders, create invoices, post payments, or mutate stock. |
| Dedicated Parts role and permissions | PARTIAL | shared `partsScanning` module policy; Admin Modules | Roles remain mechanic, office, surveillance, and admin. Exact workorder scan/issue has a dedicated role/named-user module permission; a standalone Parts role and broader inventory permission family remain absent. |
| Parts inventory workspace | LOCAL VERIFIED | `InventoryWorkspace.jsx`; `InventoryInboundWorkspace.jsx`; `InventoryPurchases.jsx`; `InventoryTaskQueue.jsx`; `InventoryReports.jsx` | Inventory exposes Stock, Inbound, Purchasing, Tasks, and Reports. Inbound coordinates canonical PO, invoice, receipt, condition, and no-PO evidence; Purchasing derives demand and keeps compact/direct PO paths; Tasks routes canonical exceptions; Reports reconciles stock, positions, purchasing, transfers, receipt cost, no-PO, and custody evidence. Mutation workflows remain with their canonical owners. |
| Stock by location placement | LOCAL VERIFIED | inventory position repository; `InventoryLocationStockWorkspace.jsx`; realistic Inventory demo seed | A selected parent can show direct stock or its complete subtree. Every part row retains its total and identifies each exact physical placement with a compact coordinate such as `A1 › S2 › B3`, a plain-language bin name, and the quantity stored there. |
| Inventory stock entry and physical count | LOCAL VERIFIED | `InventoryWorkspace.jsx`; `InventoryLocationStockWorkspace.jsx`; `InventoryStockTasks.jsx`; `AddInventoryStockDialog.jsx`; `PositionCountPanel.jsx`; direct-receipt and inventory-position owners; migration 172 | The daily Stock header exposes Add stock. Physical count is contextual: it appears only after the operator opens By location and selects the final active stock-holding child, normally a bin. Parent locations remain browse/drill-down surfaces. Counting uses compact inline counters, progress, autosave/resume, found-part handling, and exact serialized identity entry. Setup-only starting-inventory import lives under Tasks → Physical counts. Finish count submits observation evidence without changing inventory; only reviewed Admin reconciliation creates an adjustment. |
| Invoice/receiving documents | LOCAL PARTIAL-DELIVERY VERIFIED; ODOO COMPATIBILITY RETAINED | `InvoiceExtractionWorkspace.jsx`; `PhysicalReceiptConfirmation.jsx`; `ReceiptLinesEditor.jsx`; local receipt and purchase-invoice allocation services/repositories | Invoice Intake keeps the source document visible beside a guided review rail on desktop and uses an accessible Document/Review switch on compact screens. Reviewed invoices require an explicit exact-PO or truthful no-PO route, physical quantities, condition evidence, and attestation before posting. Repeated partial episodes post only entered outcomes; serialized lines require exact identities; quantity and measured/bulk lines remain aggregate. Completed receipts collapse to truthful summaries, while partial receipts remain Pending. Approval and receipt posting remain separate mutations. |
| Scanner and secure QR resolution | PARTIAL, LOCAL VERIFIED | `inventory-qr.js`; canonical workorder inventory-unit routes; `InventoryScanWorkspace.jsx`; `SerializedPartsScanner.jsx` | Authenticated-encrypted QR tokens resolve one exact serialized unit under authenticated company/location scope. Office Parts exposes compact scan, confirmation, atomic issue, installed/returned disposition, physical count, transfer, and custody handoffs where exact identities are required. Quantity and measured stock use quantity entry; a dedicated Parts role and general warehouse pick-wave scanning remain absent. |
| Label jobs/printing | PARTIAL, DURABLE BATCH VERIFIED | `inventory_label_batches`; label repository/routes; `GET /api/office/inventory/receipts/:receiptId/labels`; QR SVG route | Full delivery creates a durable immutable batch and a bounded on-screen preview with a complete print-batch link. Printer delivery status, configurable templates, and putaway completion remain absent. |
| Opening inventory import | IMPLEMENTED, LOCAL VERIFIED | migrations `071`–`073`; `inventory-count-imports.*`; `InventoryCountImportPanel.jsx` | A bounded XLSX upload creates a durable review draft, exact-matches company master parts, isolates duplicates/unmatched/invalid quantities, and requires physical-count attestation before replacing an unreserved provider projection or creating local serialized stock and printable label batches. It remains separate from routine exact-position physical counts. |
| Core obligations and disposition | LOCAL VERIFIED FOR SERIALIZED REMOVALS | inventory reuse/custody migrations, service, routes, Tasks and Reports | A removed exact unit can enter a core route with external destination/date and optional supplier, PO, bill, and credit references. Missing financial evidence remains Unknown. Aggregate core programs and accounting settlement remain future work. |
| Provider command outbox/reconciliation | PARTIAL, RECEIPTS ONLY | `inventory_provider_commands`; `inventory-receiving.service.js` | Provider receipt commands persist pending/processing/succeeded/reconciliation-required state and reject key/hash conflicts. Local transfers, Workorder issues/returns, counts, and custody use their local canonical ledgers and reconciliation reports; equivalent outbound provider commands remain absent. |

## Current Architecture

### 1. Durable data

#### Aggregate catalog and availability

- `parts_catalog` stores one stable canonical company part per normalized primary part number and carries an optimistic edit version.
- `part_reference_numbers` stores operator-managed alternate numbers separately from learned search aliases; normalized identity is unique within one company.
- `part_catalog_edit_events` stores append-only before/after evidence for each committed manual catalog edit.
- `odoo_product_mappings` preserves stable Odoo `product.product` identities independently of mutable SKU text.
- `odoo_inventory_locations` preserves Odoo stock-location identity and explicit app-location mapping status.
- `inventory_items` stores one aggregate balance per company, app location, normalized part, and unit of measure.
- `v_inventory_availability` calculates available quantity as on-hand minus reserved.
- `local_inventory_receipts` and `local_inventory_receipt_lines` preserve reviewed-invoice lineage.
- `inventory_stock_movements` is the append-only local stock audit ledger.
- Local invoice posting updates `inventory_items` with `source_provider = 'local'` in the same transaction.
- On the first local receipt for a matching legacy provider projection, an unreserved row is atomically cut over to local authority and its projected quantity is replaced by the physically confirmed receipt quantity. `inventory_authority_cutovers` preserves the replaced provider identity, quantities, and timestamps in the same transaction. Existing local rows remain additive. Any provider row with reserved quantity fails closed until those reservations are released, preventing double counting or takeover of active allocations.
- Opening-count imports persist filename, SHA-256, actor, location, original row values, exact master match or exception reason, and apply lineage. Applying ready rows uses opening-count semantics: it replaces an unreserved provider projection, rejects local/reserved stock, preserves the replaced provider snapshot in `inventory_authority_cutovers`, creates append-only adjustment evidence, and creates one serialized unit plus label item per whole counted unit.
- Quantity/UOM migrations allow decimal quantities for divisible materials and enforce whole values for count/package units.

Primary migrations:

- `src/server/db/migrations/029_quantity_units_of_measure.sql`
- `src/server/db/migrations/030_inventory_unit_identity.sql`
- `src/server/db/migrations/031_quantity_scale_enforcement.sql`
- `src/server/db/migrations/042_odoo_inventory_sync.sql`
- `src/server/db/migrations/043_odoo_product_identity.sql`
- `src/server/db/migrations/044_parts_catalog_search.sql`
- `src/server/db/migrations/058_odoo_inventory_projection_identity.sql`
- `src/server/db/migrations/059_odoo_workorder_part_mapping.sql`
- `src/server/db/migrations/071_inventory_count_imports.sql`
- `src/server/db/migrations/072_inventory_movement_generic_receipts.sql`
- `src/server/db/migrations/073_inventory_count_authority_audit.sql`

Important naming warning: `030_inventory_unit_identity.sql` adds unit of measure to **aggregate row identity**. It does not create individual physical-item identity.

#### Workorder parts

- `workorder_part_requests` owns request, approval, fitment, and manual usage state.
- `part_allocations` owns planned supply source and aggregate allocation status.
- `part_request_events` records request/allocation/usage activity.
- `odoo_workorder_part_mappings` resolves ambiguous workorder-line→Odoo-product selection for service-order export.

Migration `064_inventory_receipt_serialization.sql` adds `inventory_receipts`, `inventory_receipt_lines`, `inventory_serialized_units`, append-only `inventory_unit_events`, and `inventory_provider_commands`. These records cover the reviewed-invoice receipt slice only. No current durable record represents a physical count/condition session, pick/issue session, core obligation, or durable printer job.

### 2. Odoo read path

Admin route:

```text
POST /api/integrations/odoo/sync
  -> syncOdooPartsAndInventory(companyId)
  -> reads active product.product records
  -> reads inactive state only for existing Odoo product mappings
  -> importOdooInventory(companyId, { products })
  -> upserts catalog/product mappings
  -> queues durable odoo/service_history_sync integration job
  -> returns catalog success without waiting for history reconciliation

Integration worker:

  odoo/service_history_sync
  -> syncOdooServiceHistory(companyId)
  -> incrementally imports or periodically reconciles service history
  -> records success/failure state and uses bounded job retries
```

Current product fields: ID, SKU/default code, barcode, name, category, UOM, and provider update time.

The catalog sync does not read `stock.quant`, alter local balances, or infer inactivity from a product missing from the active-product response.

All `/api/integrations/*` routes require `integration:admin`; only Admin currently receives that permission.

Admin UI owner: `frontend/src/features/admin/integrations/OdooIntegrationCard.jsx`. It supports connection, sync, and inventory-location mapping. It is configuration UI, not a warehouse workspace.

### 3. Workorder request and issue path

```text
Mechanic submits request
  -> POST /api/mechanic/workorders/:id/parts
  -> workorder_part_requests(submitted)

Office reviews
  -> POST /api/office/workorders/:id/parts/:requestId/decision
  -> approved / needs_info / rejected
  -> optional part_allocations

Local inventory allocation
  -> Office chooses aggregate inventory row
  -> local quantity_reserved increases

Office marks allocation issued
  -> PATCH .../allocations/:allocationId
  -> local quantity_reserved decreases
  -> local quantity_on_hand decreases

Mechanic selects usage
  -> PATCH /api/mechanic/workorders/:id/parts/:requestId/usage
  -> manual usage_status update and event
```

Server validation checks workorder access, approved request state, company, part, location, UOM, and available aggregate quantity. Row locks protect local balance updates. This remains a local ledger path; Odoo is not commanded or confirmed.

### 4. Current role experience

#### Mechanic

- Works inside shared workorder Parts section.
- Chooses “I used a part” or “I need a part” when allowed.
- Searches catalog optionally, enters request and quantity, reads Office decision/allocation status, and manually chooses final usage status.

#### Office

- Reviews every submitted request inside workorder detail.
- Can use catalog and repair-history suggestions.
- Confirms fitment, supply type, aggregate inventory row, quantity, and response.
- Manually advances allocation status.

#### Surveillance

- Receives read-only shared parts surface when module policy exposes it.
- Cannot perform inventory workflow.

#### Admin

- Has integration configuration and location mapping.
- Uses Office-compatible workorder detail for parts operations.

#### Parts

- Role does not exist.

Frontend ownership follows `docs/FRONTEND_OWNERSHIP.md`:

- Shared entry: `frontend/src/components/workorders/PartRequestsPanel.jsx`
- Mechanic surface: `part-requests/MechanicPartsSurface.jsx`
- Office surface: `part-requests/OfficePartsSurface.jsx`
- Read-only surface: `part-requests/ReadOnlyPartsSurface.jsx`
- Catalog search: `part-requests/PartCatalogCombobox.jsx`
- Role capabilities: `frontend/src/app/routes/role-capabilities.js`

Do not create competing role-specific workorder detail pages for future inventory actions.

## Verified Gaps And Risks

### P0 architecture boundary — local and optional Odoo authority must not mix

Application-owned rows (`source_provider = 'local'`) are the local inventory
authority. Odoo-owned projections remain provider-controlled compatibility data.
All availability and fulfillment queries must preserve that discriminator; an
Odoo sync may not overwrite local balances, and a local command may not claim an
Odoo-controlled movement succeeded.

### P0 traceability gap — no exact physical identity

Current projection cannot answer which serial, lot, package, or physical unit was received, picked, issued, installed, returned, or scrapped. A QR scanner built on current aggregate rows would imply traceability that does not exist.

### P0 workflow gap — no physical receiving truth

The released receipt slice preserves reviewed-document lineage and confirmed
Odoo receipt/serial evidence, but it does not establish physical count,
condition, putaway, discrepancy, or PO-match truth. An invoice or vendor bill
is never itself proof of physical receipt. The next receiving flow must add
human physical confirmation without weakening the existing explicit Odoo
confirmation boundary.

### P1 reliability gap — command/reconciliation coverage is receipt-only

The released receipt slice has durable provider-command state and reconciliation
for receipt creation. Timeout, uncertain response, retry, replay, and
reconciliation behavior remain undefined for reservations, transfers, issues,
returns, and scrap.

### P1 authorization gap — no least-privilege Parts role

Warehouse users would currently need broader Office/Admin access. Future work needs a Parts role, inventory-specific permissions, company/location scoping, route policy, invitations, QA identities, and negative tests.

### P1 UX gap — manual work dominates

Office chooses supply and advances statuses manually; mechanic chooses from a raw lifecycle dropdown. No prioritized task engine, universal scan resolver, backend-generated next action, pick routing, or exception inbox exists.

### P1 completion gap — unresolved issued items

Closing blocks pending approval decisions but does not comprehensively require final disposition for issued items. Future completion preflight needs Installed, Returned/Not used, Damaged, or an audited supervisor override with a generated follow-up task.

### P2 legacy gap — identity cannot be invented

Existing aggregate balances must remain `Identity unknown` until physical count/labeling or authoritative Odoo identity evidence exists. Never backfill synthetic serials merely to satisfy a new schema.

## Accepted Target Experience — Not Yet Implemented

Product promise:

> Photograph or scan once. Backend resolves context, validates policy, performs safe Odoo coordination, and presents one next action. Humans confirm physical truth and exceptions.

### Parts workspace

Four destinations:

1. **Today** — prioritized receive, pick, return, core, label, and reconciliation tasks.
2. **Scan** — universal entry; backend resolves document, bin, product, serial, lot, package, workorder, or core.
3. **Stock** — product, availability, location, and identity search.
4. **History** — immutable part, workorder, truck, receipt, and core history.

Receiving is a Today task, not a competing navigation destination.

### Tracking policy

Backend applies a product policy:

- Individual serial: high-value, safety-critical, warranty, or core-bearing item.
- Lot: batch-controlled product.
- Container/lot with remaining quantity: fluid or divisible material.
- Quantity movement: low-value consumable.
- `Identity unknown`: legacy stock without evidence.

Do not create one fake serial for every countable object.

### Backend automation

Backend should perform document deduplication, extraction, Odoo/PO/product matching, discrepancy calculation, tracking-policy selection, location recommendation, eligible-stock selection, pick ordering, scan validation, idempotent Odoo command submission, safe retries, reconciliation, and exception-task creation.

Humans retain physical receipt/condition confirmation, uncertain product matching, sensitive discrepancy approval, installation/return/damage confirmation, and audited overrides.

### Proposed durable owners

Names remain design targets until implemented:

- `inventory_documents`
- `inventory_document_extractions`
- `receiving_sessions`
- `receiving_session_lines`
- `inventory_identity_projection`
- `inventory_workflow_events`
- `inventory_pick_sessions`
- `inventory_pick_items`
- `workorder_inventory_links`
- `core_obligations`
- `inventory_label_jobs`
- `inventory_provider_commands`
- `inventory_reconciliation_exceptions`

`inventory_identity_projection` mirrors Odoo identity. It does not own stock quantity or location truth. `inventory_workflow_events` records app-owned tasks and relationships; it must not duplicate Odoo stock movements as competing authority.

## Workflow-First Target Operating Model — Not Yet Implemented

### Product lens

Do not design this as separate Inventory, Receiving, Scanner, Core, and History features. Design one closed operational loop:

```text
Need identified
  -> request is understood and policy-checked
  -> approved source becomes a concrete task
  -> physical item is verified and issued through Odoo
  -> mechanic records physical outcome
  -> return/core/reconciliation work is closed
  -> truck and part history becomes durable evidence
```

Each screen must answer one question: **what must I do next, and what proof is required?**

The system chooses and prepares routine work. People confirm physical truth, make policy/financial decisions, and resolve exceptions.

### Operator state model

Users should not see raw database/provider states. Every part task presents one operator state:

| Operator state | Meaning | Main action | Next owner |
|---|---|---|---|
| Needs decision | Request, discrepancy, or exception needs a permitted decision. | Review | Office or Admin |
| Ready to act | Preconditions are met and physical work can begin. | Scan / start | Parts or Mechanic |
| Waiting on Odoo | Command submitted; outcome is not yet confirmed. | Wait; do not repeat | System reconciliation |
| With mechanic | Confirmed issued item awaits installation, return, or damage result. | Record outcome | Mechanic |
| Needs resolution | Physical/provider evidence conflicts or is missing. | Resolve exception | Named owner |
| Complete | Required evidence and Odoo/app relationships are durable. | View history | None |

Provider states such as timeout, replay, stale scan, or Odoo rejection stay in backend workflow data. They are translated into a clear operator message and one safe next action. Never show false success or require users to guess whether an item moved.

### Role contract

| Role | Accountable outcome | Starts from | Can decide | Cannot decide/view |
|---|---|---|---|---|
| Mechanic | Correct repair outcome and truthful disposition of issued item | Active workorder | Request, install, not-used return, damage, core-ready | Stock adjustment, vendor/cost/invoice, Odoo override |
| Parts | Correct physical receipt, pick, issue, return, and core custody | Today task or authenticated scan | Physical match, condition, bin, handoff confirmation | Price approval, stock adjustment without policy, cross-location issue |
| Office | Correct commercial/policy decision and exception resolution | Needs decision inbox | Approval, source choice, discrepancy tolerance, override with reason | Physical scan attestation not personally performed |
| Admin | Safe configuration, access, Odoo mapping, and reconciliation governance | Exception/configuration queue | Role access, mappings, policies, adjustment approval, recovery action | Routine receipt/pick completion unless acting as Parts |
| Surveillance | Trustworthy read-only operational visibility | Workorder, truck, or event history | No mutations | Prices, invoices, vendor terms, scans, stock actions |
| System | Fast, deterministic preparation and safe coordination | Event, scan, scheduled reconciliation | Match, propose, validate, queue, retry safe work, flag exception | Invent physical arrival, identity, condition, or final human decision |

No role should use another role's home page as a workaround. Roles share workorder/truck history, but each receives a distinct next-action queue and least-privilege commands.

### Workflow 1 — Mechanic needs a part

**Trigger:** Mechanic discovers need while diagnosing or repairing a workorder.

1. Mechanic says what is needed using part search, part number, photo, or short description. Workorder, truck, location, mileage, repair concern, and mechanic identity are filled by the system.
2. System finds catalog/Odoo candidates, known fitment, prior truck service history, availability, and policy requirements. It proposes a request; it never silently substitutes a part.
3. Mechanic confirms the requested quantity and urgency. Request becomes **Needs decision** only when approval/policy is required.
4. Office receives a prepared recommendation, not a blank form. Routine policy-valid requests can be batch-approved; uncertain fitment, price, source, or quantity goes to an explicit exception card.
5. After approval, system creates a Parts task with exact workorder, truck, mechanic, identity policy, source location, and due priority.

**Handoff proof:** Office approval or documented policy auto-approval; no inventory movement yet.

**Exception examples:** no fitment confidence, no eligible stock, split source, invalid UOM, request changed after approval, or workorder cancelled. System preserves the request and opens the next owner task; it does not erase evidence.

### Workflow 2 — Parts fulfills the request

**Trigger:** Approved request is ready to pick.

1. Parts opens **Today**. Top card shows the next pick, not a table of all inventory: workorder, truck, mechanic, bin, item/lot/serial policy, quantity, and priority.
2. Parts scans the bin, then product/identity. Backend validates company, location, product, lot/serial/package when required, reservation, and current workflow state.
3. A valid scan shows a concise physical confirmation. An invalid scan says what is wrong: wrong bin, wrong product, already issued, stale reservation, or inaccessible location.
4. Parts confirms handoff. Backend sends one idempotent Odoo issue/transfer command.
5. Until Odoo confirms, task remains **Waiting on Odoo**. No duplicate scan can create another issue.
6. After confirmation, mechanic receives an issued-item card inside the workorder. Parts task completes.

**Handoff proof:** Odoo movement reference plus scan/session evidence and issuer identity.

**Exception examples:** damaged barcode, camera unavailable, keyboard-wedge input, competing scan, Odoo timeout, Odoo rejection, or stock mismatch. System either offers a safe retry/reconcile action or assigns a named exception owner. It never lets a user declare an unconfirmed issue complete.

### Workflow 3 — Mechanic installs, returns, or reports damage

**Trigger:** Item is confirmed issued to the active workorder.

1. Workorder shows one issued-item card: exact identity where tracked, quantity where not, source, issue time, and one required next action.
2. Mechanic selects **Installed**, **Not used—return**, or **Damaged**. For core-bearing items, Installed also creates a core obligation.
3. Installed binds the item/lot/quantity to workorder, truck, mechanic, mileage, and timestamp. Odoo stock movement remains authoritative; app owns the installation relationship.
4. Not used creates a return task for Parts. Damaged creates a condition/exception task with optional evidence; it does not silently restore stock.
5. Workorder completion preflight lists only unresolved issued items. Mechanic or Office resolves them, or an authorized override records a reason and creates a follow-up task.

**Handoff proof:** Final disposition plus required identity/quantity and actor/time. For installed tracked items, durable truck linkage is required.

### Workflow 4 — Physical receiving

**Trigger:** Delivery arrives, with or without a vendor invoice.

1. Parts starts **Receive** from a Today task or scans an authenticated receiving/PO label. An invoice photo or PDF may be added before or during receiving.
2. System stores original document evidence, hashes it for duplicate detection, extracts candidate fields, and matches vendor, purchase order, scheduled Odoo receipt, product, UOM, and price/core-charge rules.
3. Parts scans/counts physical goods and confirms condition, actual quantity, and putaway bin. The system compares ordered, invoiced, and physically counted values.
4. Clean receipt: system prepares the Odoo receipt command and required serial/lot labels. Discrepant receipt: task becomes **Needs decision** for Office/authorized Parts according to policy.
5. Odoo confirms receipt. Only then does stock become available in the read-only projection and putaway/label tasks complete.

**Handoff proof:** Source document where present, physical count/condition, Odoo receipt reference, identity/lot evidence, receiver, and timestamp.

**Non-negotiable:** Invoice capture is evidence and matching input. It is not proof that inventory physically arrived.

### Workflow 5 — Return and core lifecycle

**Trigger:** Mechanic marks Not used, Damaged, or installs a core-bearing replacement.

1. System creates exactly one relevant task: return-to-stock, damaged inspection, or core due.
2. Parts scans returned item/core and verifies its originating workorder, replacement identity where relevant, condition, and destination.
3. A returned usable item is not available until Odoo confirms its transfer/receipt. Damaged items go to an explicit inspection/quarantine workflow.
4. Core-bearing installation creates one core obligation. The removed core receives a durable identity and enters quarantine, never regular available stock.
5. Office records vendor shipment/credit/rejection; Parts records physical custody. History retains replacement↔core linkage.

**Handoff proof:** one obligation to one resolved core outcome; no duplicate core credit and no silent disposal.

### Workflow 6 — Reconciliation and recovery

**Trigger:** Provider timeout, Odoo rejection, stale scan, duplicate request, missing physical evidence, or scheduled consistency check.

1. System freezes unsafe automatic progress and marks the item/task **Needs resolution** with a specific reason.
2. The designated owner sees the evidence: requested action, scan/session, Odoo reference or absence, current projection, and recommended recovery.
3. Owner chooses only safe actions: retry known-safe command, refresh/reconcile Odoo truth, cancel/release reservation, record counted discrepancy, or escalate adjustment.
4. Corrections create compensating events. History is append-only; no silent overwrite of receipt, issue, install, or core evidence.

**Handoff proof:** reconciled provider state or an authorized compensating decision with reason.

### UX rules for every role

- Start from an event or assigned task, not from a generic page.
- One task card has one primary action. Secondary information stays behind Details.
- Context travels with the task: company, location, workorder, truck, identity, policy, and due reason.
- Scans are inputs, not authorization. Server resolves every scan under the current authenticated actor and location scope.
- Use progressive disclosure. Normal flow stays one or two confirmations; exceptions expose only the evidence needed to resolve them.
- Keep prices, vendor data, invoices, and adjustment controls out of mechanic and surveillance views.
- Preserve `UNKNOWN`, pending, degraded, rejected, and reconciliation-required states. No optimistic “done.”
- Mobile scanner flow must work with camera, damaged-code/manual fallback, and keyboard wedge.

### Vertical-product build rule

Do not ship a scanner page, inventory table, or core page in isolation. Each delivery must complete one user outcome across data, Odoo, authorization, task UX, history, and failure recovery.

First candidate vertical slice:

```text
Approved workorder request
  -> Parts task
  -> authenticated bin + item scan
  -> idempotent Odoo issue confirmation
  -> mechanic Installed / Not used / Damaged
  -> durable workorder + truck history
```

Prerequisites: exact identity projection for tracked products, Parts role/permissions, provider-command lifecycle, and explicit completion preflight. This slice proves the core operating loop before invoice receiving or full core-credit automation.

## Delivery Sequence

1. **Read-only identity foundation** — Parts role/permissions, exact Odoo identity projection, secure authenticated QR resolution, Stock, History, tenant/location negatives. No quantity writes.
2. **Task engine and universal scanner** — Today queue, scan classification/resolution, keyboard-wedge fallback, deterministic correction states.
3. **Receiving** — source documents, PO/receipt matching, physical confirmation, Odoo receipt command, labels, putaway, pending/error/reconciliation.
4. **Request, reserve, pick, and issue** — backend proposal, Office confirmation, pick tasks, Odoo-confirmed movement.
5. **Installation and truck history** — exact issued cards, final disposition, completion preflight, audited override.
6. **Core lifecycle** — obligation, returned-core identity, quarantine, vendor return/credit, rebuild/reuse, rejection, scrap.
7. **Legacy reconciliation and rollout** — controlled counts, unknown identity preservation, per-company/location feature flags, rollback evidence.

## Required Evidence For Future Changes

Each implementation slice records applicable evidence:

- Database: fresh migration, upgraded migration, constraints, tenant/location negatives, concurrency/replay, rollback/restore.
- API: authorization matrix, idempotency, stale/conflict behavior, provider pending/unknown/reconciliation.
- UI: rendered workflow at 390×844 and 430×932, camera denied, damaged code, keyboard scanner, no horizontal overflow, accessibility.
- Performance: scan lookup p95 ≤300 ms; first inventory page within existing 750 ms budget; cursor pagination; no N+1.
- Integration: Odoo sandbox receipt/transfer/reversal and reconciliation rehearsal.
- Repository: focused tests, `npm run test:role-workflow` when roles/routes change, and `npm run verify` on final files.
- Release: exact commit/deployment/environment and production-safe evidence. Local success alone remains local.

## Canonical Owner Map

| Concern | Current owner | Future extension point |
|---|---|---|
| Odoo configuration/read sync | `src/server/integrations/odoo/odoo.admin.service.js` and `.repo.js` | Preserve exact provider identity and reconciliation metadata. |
| Odoo client | `src/server/integrations/odoo/odoo.client.js` | Inventory command adapter behind domain service; UI never calls provider directly. |
| Odoo service-order export | `src/server/integrations/odoo/odoo.outbound.*` | Keep separate from inventory receipt/transfer commands. |
| Catalog search/edit | `src/server/db/repositories/parts-catalog.repo.js`; `parts-catalog-edit.repo.js` | Keep search bounded/indexed and manual edits tenant-scoped, versioned, audited, and provider-safe. |
| Request/allocation workflow | `src/server/db/repositories/part-requests.repo.js` | Transition away from local quantity ownership. |
| Parts domain validation | `src/server/modules/parts/*` | Add explicit workflow state machines and policies. |
| Auth/route policy | `src/server/auth/roles.js`, `permissions.js`, `policy.js` | Add least-privilege Parts capabilities. |
| Workorder parts UI | `frontend/src/components/workorders/PartRequestsPanel.jsx` and `part-requests/*` | Consume issued identities and next actions without forking shared detail. |
| Admin Odoo UI | `frontend/src/features/admin/integrations/OdooIntegrationCard.jsx` | Configuration/mapping/reconciliation administration only. |
| Product history | `src/server/modules/workorders/unit-service-history.service.js` | Join installed inventory identities without replacing service-history ownership. |

## Change Log

### INV-20260920-02 — Full-height invoice review and realistic Chino map

- Status: LOCAL VERIFIED; not released.
- Decision/requirement: Use the available desktop viewport for invoice work and make the local Chino fixture resemble a readable shop map rather than a technical test tree.
- Before: Invoice review stopped at an 820px desktop height and left unused space on tall displays. Chino used one warehouse with mixed wrapper areas and only four aisle-like branches.
- After: Desktop invoice review grows to the viewport while its document and review rail retain independent scrolling. Chino presents Warehouse 1, Warehouse 2, Warehouse 3, Core area, and the system Receiving area. Warehouse 1 contains naturally ordered A1 through A12; every aisle has a named shelf and storable bin with short unique codes.
- Canonical owners: `invoice-extraction.css`; `inventory-location-model.js`; inventory position projection; realistic Inventory demo seed.
- Data/API changes: Position reads now include the existing `systemKey` so system Receiving and Unassigned can be ordered clearly. No schema change. The local fixture reconciler adds or updates only its defined positions and leaves unrelated user-created locations intact.
- Verification: Focused invoice/location contracts, repeatable local fixture replay, database hierarchy and stock reconciliation, production build, and authenticated browser geometry and hierarchy checks.
- Release evidence: Local working tree and local test database only. No commit, push, deployment, hosted mutation, accounting post, or Odoo write was authorized.

### INV-20260920-01 — Scannable location stock paths

- Status: LOCAL VERIFIED; not released.
- Decision/requirement: Make parent-location stock useful on the floor by showing where each quantity is physically stored, using short coordinate codes plus plain-language orientation names.
- Before: Subtree rows showed one total but did not identify the contributing aisle, shelf, rack, or bin. The local realistic fixture used long shop-prefixed codes throughout the tree.
- After: Each row keeps its total and lists the exact contributing placements and quantities. Coordinate paths suppress non-coordinate wrapper levels when aisle/shelf/rack/bin values are available, producing labels such as `A1 › S2 › B3`. The local fixture uses short shop-local codes such as `WH`, `A1`, `S1`, and `B1`, with descriptive names such as `Filters and brake parts` and `Brake pads`.
- Canonical owners: inventory position stock repository; `InventoryLocationStockWorkspace.jsx`; `inventory-location-model.js`; realistic Inventory demo seed.
- Data/API changes: The existing location-stock response adds a `placements` array with position identity, compact path inputs, and quantity/reserved totals. No schema migration and no stock quantity mutation.
- Authorization/security changes: Existing company, authorized-shop, selected-location, and direct/subtree scope checks remain on both total and placement queries.
- Verification: Focused model/contracts, PostgreSQL position integration, production build, and authenticated local browser checks. Local demo label reconciliation preserves existing fixture position IDs, hierarchy, parts, quantities, and Workorders.
- Release evidence: Local working tree and local test database only. No commit, push, deployment, hosted mutation, accounting post, or Odoo write was authorized.

### INV-20260917-01 — Location pricing foundation, Workorder pickup, and Purchases invoice entry

- Status: VERIFIED locally for the completed slices; not released.
- Decision/requirement: Build the first inventory-foundation slices on the developer-integrated base without changing Workorder stock accounting or allowing invoice and PO paths to post the same stock twice.
- Before: Detail Workorder parts used a separate desktop presentation and did not show aggregate pickup paths; commercial prices had only a company scope; invoice upload was not reachable from Purchase Requests or Purchase Orders.
- After: Detail uses the shared flat desktop row structure and shows the complete aggregate pickup path; location price overrides inherit from a company default with explicit Unknown and zero semantics; Purchases opens Invoice Intake with its selected shop preselected.
- Canonical owners: `UsedPartsEditor.jsx`; `WorkorderPartsTable.jsx`; inventory-part-prices repository/service/routes; `InventoryPurchaseRequests.jsx`; `InventoryPurchases.jsx`; `InventoryWorkspace.jsx`; `InvoiceExtractionWorkspace.jsx`.
- Data/API changes: Migration `152_inventory_location_price_overrides.sql`; location-scoped price write and pricing-preview routes; commercial reads can resolve effective location pricing and location-filtered invoice receipt cost evidence.
- User-experience changes: Desktop Workorder rows match the established flat operational structure; phone rows remain compact. The pickup column names warehouse, aisle, rack, shelf and bin. Purchases provides one `Add supplier invoice` action and retains shop context through upload.
- Authorization/security changes: Existing financial and Office/Admin permissions remain authoritative; company and location scope are validated server-side.
- Failure/reconciliation behavior: Explicit Unknown location prices mask the company default; zero is preserved as a known value; missing receipt cost is never shown as zero. PO extraction does not auto-link or post inventory yet because PO receipt and invoice receipt lack one atomic allocation guard.
- Verification: Focused frontend contracts passed 52/52; pricing service/route contracts passed; opt-in PostgreSQL pricing integration passed 27/27 after migration 152; production build passed. Authenticated desktop and 390px browser checks showed the full pickup path, flat Labor/Parts rows, Purchases-owned invoice dialog with `Basics Shop` selected, no horizontal overflow and no page or HTTP 5xx errors.
- Release evidence: Local working tree and localhost only. No commit, push, deployment, production mutation, or Odoo write was authorized.
- Remaining gaps: Move commercial controls into each location in Part detail; add read-only exact PO suggestions and then atomic invoice-to-PO line allocation before matched invoice receipt; complete mobile Inventory containment and blank Create draft cleanup.

### INV-20260915-CURRENCY — Currency selectors

- Status: IMPLEMENTED locally.
- Replaced free-text currency fields with the shared dropdown; common codes appear first, followed by runtime-supported currencies. Existing saved codes remain selectable.
- Owners: `CurrencySelector`, purchasing/bills, part commercial details, PO approval settings.
- Data/API changes: none. Verification: production build and local browser selector checks; no deployment.

### INV-20260915-STABILIZE — Existing receiving and task interactions

- Status: IMPLEMENTED locally; verification evidence in the inventory-stabilization task report.
- Before: purchase receiving dismissed completion immediately; receipt drafts could reopen against a previous shop; repeated damage/transfer actions could retain stale identities or destinations.
- After: receipt confirmation and labels remain available until Done; explicit shop selection controls unsubmitted draft restoration; uncertain submitted commands remain recoverable. New task entry clears stale selections.
- Owners: `InventoryPurchases`, `InventoryPurchaseRequests`, `AddInventoryStockDialog`, `direct-receipt-model`, `InventoryStockTasks`.
- Data/API changes: none; existing stock, permission and idempotency APIs are retained.
- Verification: focused draft/command tests and browser regression scripts for receiving and stock-task state. Final results recorded externally.
- Release evidence: local only; no commit, push or deployment.
- Remaining gaps: roadmap unchanged; this repairs existing workflows without adding batch prices, warranties or AI modules.

### INV-20260915-DEVELOPER — Integrate developer inventory workflow

- Status: IMPLEMENTED locally; see external task report for final verification evidence.
- Decision: use the developer's submitted workflow as the basis for subsequent fixes and polish.
- Before: local staging-derived implementation; ZIP was reference material only.
- After: developer purchase requests, POs, approval, receiving, bills, tasks and reports are connected to the application. Existing storage positions and pricing/tax remain available.
- Canonical owners: `InventoryWorkspace`, `InventoryPurchases`, inventory purchasing/bills/stock-task services and repositories; migrations 136–151.
- Compatibility: historical migrations/checksums preserved. Populated disposable upgrade retained 265 existing rows across 41 inventory tables without changing their original values.
- Failure/reconciliation: held deliveries stay outside usable positions; stock tasks reconcile positions; unsupported independent count writes are blocked in favor of Storage locations counts. Target-company roles govern imported service access.
- Verification: migration compatibility tests, fresh database workflow tests, unit/build checks and authenticated local browser QA are recorded in the external developer-integration task report.
- Release evidence: none; local integration only.
- Remaining gaps: batch costs/warranty, automatic invoice matching, full partial-delivery workflow, location price overrides and AI orchestration remain future work.

### INV-20260910-01 — Tracking-aware manual stock intake

- Status: IMPLEMENTED locally; in-app validation pending.
- Decision/requirement: Add stock according to the part's saved tracking rather than forcing serial identities on all parts.
- Before: Inventory's location drilldown only offered serialized creation; saved Workorder counted catalog parts always opened the serial picker.
- After: Quantity and measured-bulk parts have a shared quantity intake control in Inventory/Create/Detail; saved Workorder usage honors explicit quantity policy and whole-number constraints. Serialized paths remain separate and unchanged.
- Canonical owners: `inventory-stock-intake.repo.js`, `inventory-stock-intake.service.js`, `inventory-aggregate-workorder-usage.repo.js`, `StockIntakeControl.jsx`, `stock-intake-model.js`.
- Data/API changes: Migration 130 adds manual intake lineage and preserves aggregate usage tracking snapshots. New POST `/stock-intake`; existing location metadata exposes canonical UOM and intake capability.
- Authorization/security changes: Office/Admin, company and current location scope; request-hash replay; canonical tracking/UOM checks under a catalog lock; legacy authority conflicts fail without adding stock.
- Verification: Focused frontend tests and build passed; backend route/schema and disposable PostgreSQL migration/transaction tests passed. Final review recorded in external task state.
- Release evidence: None. No configured database migration, stock receipt, commit, push, or deployment performed.
- Remaining gaps: In-app browser controls unavailable in this session; authenticated end-to-end receiving and final bulk rendered check not verified.

### INV-20260824-01 — Baseline audit and target decision record

- Status: VERIFIED
- Decision/requirement: Establish one repository-grounded living record before inventory implementation continues.
- Before: Product idea and prior planning existed outside a maintained repository record; current implementation and target state could be confused.
- After: Current aggregate inventory/workorder-parts/Odoo behavior, canonical owners, gaps, accepted target experience, delivery order, and maintenance contract are recorded here.
- Canonical owners: Documentation only; source owners listed above remain unchanged.
- Data/API changes: None.
- User-experience changes: None.
- Authorization/security changes: None.
- Failure/reconciliation behavior: Audited and documented; not changed.
- Verification: Targeted source audit of migrations `029`–`031`, `042`–`044`, `048`, `056`, `058`–`060`; Odoo admin/outbound code; part repositories/schemas/routes; auth policy; shared workorder parts UI; relevant tests and package scripts.
- Release evidence: Not applicable. Documentation-only local change.
- Remaining gaps: All items in **Verified Gaps And Risks** and **Accepted Target Experience — Not Yet Implemented**.

### INV-20260824-02 — Workflow-first role operating model

- Status: PLANNED
- Decision/requirement: Define target product by role outcomes, handoffs, evidence, and exception ownership rather than a collection of pages/features.
- Before: Target design named four destinations and delivery slices but did not fully specify role-by-role operational loops.
- After: Added operator state model, role contract, mechanic request/installation workflows, Parts fulfillment/receiving/return/core workflows, Office/Admin/Surveillance boundaries, reconciliation flow, and a vertical-product build rule.
- Canonical owners: Product design only. Future implementation must use the canonical owners in **Canonical Owner Map**.
- Data/API changes: None.
- User-experience changes: None yet; target behavior documented.
- Authorization/security changes: Target requires Parts role, task-scoped commands, authenticated server-side scan resolution, and least-privilege evidence visibility.
- Failure/reconciliation behavior: Target defines Waiting on Odoo and Needs resolution as visible safe states; no false completion.
- Verification: Documentation structure reviewed against current-state/target separation; no runtime behavior claimed.
- Release evidence: Not applicable. Documentation-only local change.
- Remaining gaps: Target remains unimplemented; first vertical slice requires exact identity, Parts authorization, inventory provider-command lifecycle, and completion preflight.

### INV-20260825-01 — Reviewed invoice to serialized Odoo receipt and encrypted QR

- Status: RELEASED
- Decision/requirement: Prove the smallest complete receiving/identity loop without making the app a competing stock ledger or changing untracked Odoo products.
- Before: Invoice approval stopped before inventory; no receipt command, exact serial identity, QR label, or authenticated scan resolver existed.
- After: A reviewed invoice with whole-quantity lines mapped to exactly one serial-tracked Odoo product stages a durable receipt/outbox command, creates or safely replays one incoming Odoo picking, validates it, confirms local state only after Odoo reports `done`, stores one unit per provider lot/serial, renders authenticated-encrypted QR labels, and resolves one exact unit on a phone-oriented scan surface.
- Canonical owners: `src/server/modules/inventory/*`; `src/server/integrations/odoo/odoo.receipts.js`; `src/server/db/repositories/inventory-receipts.repo.js`; `frontend/src/features/inventory/*`; `frontend/src/features/office/InvoiceExtractionWorkspace.jsx`.
- Data/API changes: Migration `064_inventory_receipt_serialization.sql`; exact receipt/label/QR/resolve routes named in the capability matrix; AES-256-GCM unit tokens with random nonces; provider marker `WG-REC-<receipt-id>` plus immutable idempotency-key/request-hash and frozen Odoo picking-type/source/destination replay validation; receipt-wide limit of 500 serialized units and bounded provider batches.
- User-experience changes: Office/Admin invoice review exposes one next action after approval, then a minimal printable label grid. An encrypted QR opens part, serial, status, location, Odoo receipt, and event history; signed-out scans resume after login, and `Scan another` supports camera and manual fallback.
- Authorization/security changes: Existing workorder-office policy protects receiving/labels; scan resolution requires authentication plus company and mapped-location scope. QR payload contains no vendor, price, invoice, tenant, or predictable serial data and is integrity protected by a dedicated signing key.
- Failure/reconciliation behavior: Fractional or excessive quantities, duplicate part lines, missing/ambiguous product mapping, non-serial Odoo tracking, missing incoming route, provider rejection, incomplete picking, replay conflict, and token tampering fail closed. Claimed commands enter reconciliation-required on uncertain provider failure; local units do not become in-stock before provider confirmation.
- Verification: Focused inventory/Odoo/UI tests passed; a fresh temporary PostgreSQL database applied all migrations including `064`; production build and structure checks passed; rendered local invoice upload/OCR/review passed; signed QR resolved the expected local fixture at 390×844. Repository-wide unit run retained four pre-existing failures in untouched workspace-header/supporting-text tests.
- Release evidence: Core workflow commit `63e091e3fd40f4904c094dd8559c4e79337257de`; confirmed-warehouse route fix `4cbd2905d4f10e3e2c3a1528bf3a429f3734b5ca`; Odoo 18 serial-allocation reconciliation fix `52bac4d11cbde49b4645f651c47aa940f5a84220`; Railway production deployment `83855aeb-1fb4-46cf-b5bf-9bd298190ad9` succeeded and `/health/ready` reported database available. Rendered production upload used synthetic reviewed invoice run `a46181bc-b526-412c-a580-d2d1d732f1e6`. Odoo staging database `protechrepair-july16staging-36196899` confirmed picking `CHI/IN/00312` (`13567`) on route `245 / 4 / 471`, product `QA-QR-20260825` (`95842`), two distinct serial lots (`1`, `2`), and two unreserved quants of quantity one at `CHI/Stock`. The app retained one confirmed receipt, one line, two in-stock units, their append-only events, and one succeeded command. The production QR SVG decoded to its scan URL; the authenticated 390x844 scan opened the exact first unit with `scrollWidth = innerWidth = 390`; an unauthenticated same-origin resolve returned `401`; receipt replay returned the same two labels without a second provider receipt.
- Remaining gaps: Dedicated Parts role, physical arrival/count/condition and putaway confirmation, general lot/package sync, issuing/installing/return/core flows, durable printer jobs, receipt reversal/void workflow, and actual-device camera permission testing. The clearly labeled synthetic Odoo product, done receipt, two lots/quants, app invoice run, confirmed receipt, line, units/events, and command are intentionally retained as staging audit fixtures because no safe receipt-reversal workflow exists yet.

### INV-20260825-02 — Application-owned invoice receipts and inventory workspace

- Status: VERIFIED
- Decision/requirement: Operate invoice receiving and inventory inside Workorder Generator without requiring another inventory product.
- Before: The invoice review action required configured Odoo routes, products, receipt confirmation, and provider serial identity before stock could become available.
- After: A reviewed invoice posts one idempotent local receipt, durable receipt lines, append-only stock movements, and local location balances in one transaction. Whole count/package quantities create exact local serial identities and QR labels in that same transaction. Admin and Office share stock in Inventory; Invoice Intake owns the receipt-enriched invoice history surface.
- Canonical owners: `src/server/modules/inventory/local-inventory.service.js`; `src/server/db/repositories/local-inventory.repo.js`; `frontend/src/features/inventory/InventoryWorkspace.jsx`; `frontend/src/features/office/InvoiceExtractionWorkspace.jsx`; `frontend/src/features/office/InvoiceHistoryPanel.jsx`.
- Data/API changes: Migrations `065_local_inventory_ledger.sql` and `066_local_inventory_serial_identity.sql`; `POST /api/office/invoice-extractions/:runId/post-inventory`; bounded `GET /api/office/inventory/stock` and `/invoices` read models; shared label, QR SVG, and scan routes.
- User-experience changes: Reviewed invoices expose “Add to inventory,” printable local serial labels, and exact QR scans. Inventory shows only master/location stock; Invoice Intake groups new uploads with searchable history and its contextual Review, Add inventory, View, and Print QRs actions.
- Authorization/security changes: Existing Office permission protects the route family; repository queries enforce authenticated company and location scope; request bodies cannot select company or location; replay conflicts fail closed.
- Failure/reconciliation behavior: Unsupported UOM, invalid quantity/cost, missing part number, unreviewed invoice, cross-location access, duplicate conflict, and concurrent repeat posting fail before a second stock increase. Corrections require future compensating-movement commands rather than history deletion.
- Verification: `npm run verify` passed structure, backup/restore tooling, performance tooling, 1,104 unit tests (2 opt-in PostgreSQL tests skipped there), syntax checks, and the production Vite build. The opt-in real-PostgreSQL inventory integration passed concurrent retry, opening-balance adoption, reservation preservation, replay conflict, and location isolation. `npm run db:check` reported all 68 migrations healthy. Rendered Admin evidence showed the local receipt surviving refresh, 2 EA at Chino Yard, truthful Added/Needs review/Failed history, and no horizontal overflow at phone or desktop test widths.
- Release evidence: Not released. No commit, push, deployment, external provider write, or production mutation was authorized.
- Remaining gaps: Receipt reversal UI, movement-history UI, transfers, issues/returns on the new ledger, counts/adjustments, valuation, purchasing, exact serial/lot lifecycle, and dedicated Parts authorization.

### INV-20260825-03 — Local serial identities and encrypted QR labels

- Status: VERIFIED
- Decision/requirement: Application-owned invoice receipts must produce serial numbers, printable QR labels, and exact scans without Odoo.
- Before: The local receipt path stopped at aggregate stock; serialized units and labels were created only by the provider-confirmed Odoo path. Localhost also had no dedicated QR signing key.
- After: Migration `066_local_inventory_serial_identity.sql` extends the canonical identity projection to `provider = local`, backfills eligible existing local receipts, and records `receipt_recorded` events. New local count/package lines create one in-stock unit per quantity in the same transaction as receipt, ledger, and balance updates. Measured quantities remain aggregate.
- Security/configuration: Authenticated-encrypted QR tokens still expose only an opaque unit capability and resolve under server-owned company/location scope. An explicit `INVENTORY_QR_SIGNING_KEY` remains highest priority; otherwise the app derives a domain-separated key from its strong auth root secret, making localhost restart-stable without another service.
- User experience: The reviewed invoice shows printable labels immediately and after refresh. The scanner truthfully says “Local invoice receipt” and “Added to local inventory.”
- Verification: `npm run verify` passed structure, backup/restore and performance tooling, 1,107 unit tests (2 opt-in PostgreSQL tests skipped), syntax, and the production build. The real-PostgreSQL local inventory test separately passed concurrent posting with exactly two serialized units. All 69 migrations are healthy. Rendered localhost evidence showed two loaded 256×256 QR SVGs without phone/desktop overflow; scanning `WG-L-00CC246F632B47E3-1-1` resolved QA-QR-20260825 as in stock at Chino Yard with local receipt history.
- Release evidence: Local only. No commit, push, deploy, production mutation, or external provider write was authorized.
- Remaining gaps: Physical serial capture for manufacturer-provided serials, serial-specific issue/install/return actions, durable printer jobs, and receipt reversal remain unimplemented.

### INV-20260826-01 — Shared secondary part detail window

- Status: VERIFIED
- Decision/requirement: Keep Inventory as the primary workspace and open part information in one reusable right-side detail window instead of adding more pages.
- Before: Stock rows expanded an inline location breakdown; no shared secondary-detail component existed for part, vendor, invoice, unit, transfer, or warranty records.
- After: Selecting a stock row opens the shared `SecondaryDetailPanel`. The initial part adoption shows current aggregate totals, per-location quantities, available part identity, and explicitly labeled future record groups. The base component owns the accessible header, dismiss behavior, scrollable grouped content, sticky footer, desktop right-side layout, and phone full-width layout.
- Canonical owners: `frontend/src/components/ui/SecondaryDetailPanel.jsx`; `frontend/src/components/ui/secondary-detail-panel.css`; consumer `frontend/src/features/inventory/InventoryWorkspace.jsx`.
- Data/API changes: None. Existing bounded stock read model remains unchanged.
- User-experience changes: Inventory remains visible as context behind a right-side part window inspired by the supplied reference's information hierarchy while retaining Workorder Generator styling.
- Authorization/security changes: None. The window renders only data already returned by the authorized company/location-scoped stock endpoint.
- Failure/reconciliation behavior: Missing vendor, purchase, serial, activity, or warranty read models are not fabricated; those groups are labeled as planned. Localhost rendered interaction remains unverified when the authenticated company has zero stock rows.
- Verification: Focused inventory contract tests and production Vite build passed. Authenticated localhost rendered the Inventory workspace without console errors or horizontal overflow at desktop and phone widths, but had zero stock rows, so part-window opening could not be exercised without mutating inventory data.
- Release evidence: Local only. No commit, push, deploy, database write, or production mutation was authorized.
- Remaining gaps: Add the part-detail read model and contextual actions; verify open/close/focus and responsive geometry against real stock data; reuse the shared component for vendor, invoice, serialized-unit, transfer, and warranty records.

### INV-20260826-02 — Physical receiving, fulfillment recommendation, and exact-unit workorder use

- Status: VERIFIED
- Decision/requirement: Deliver the first application-owned inventory operating slices with minimal operator actions, server-owned authorization and state transitions, bounded reads, and exact physical identity.
- Before: Local invoice posting had no explicit physical-arrival step or durable label batch; Inventory detail lacked rendered stock evidence; “Get parts” had no backend recommendation record; mechanics could not bind a scanned local unit to a workorder.
- After: A reviewed invoice can confirm a complete delivery and atomically create local stock, serialized units, events, and a durable printable-label batch. Inventory shows stock with the shared part detail panel; Invoice Intake owns invoice history. “Get parts” recommends company/location-scoped local stock and records an approval without falsely reserving or moving it. A mechanic can resolve one exact unit and issue, install, or return it, while workorder lifecycle transitions fail closed on unresolved issued units.
- Canonical owners: `src/server/modules/inventory/*`; `src/server/db/repositories/local-inventory.repo.js`; `src/server/db/repositories/inventory-labels.repo.js`; `src/server/db/repositories/inventory-unit-workorder.repo.js`; `src/server/modules/parts/part-fulfillment.*`; `frontend/src/features/inventory/*`; `frontend/src/features/office/InvoiceExtractionWorkspace.jsx`; shared workorder part surfaces.
- Data/API changes: Migrations `067_part_fulfillment.sql`, `068_local_receipt_confirmation_labels.sql`, and `069_inventory_unit_workorder_usage.sql`; full-delivery confirmation, label-batch, fulfillment recommendation/approval, exact-unit issue/install/return, and guarded workorder lifecycle routes/services.
- User-experience changes: The common path has one clear next action: confirm full delivery, open the complete label batch, inspect a part in the right-side panel, approve a recommendation, or scan/enter one unit. Reviewed invoice values are locked, label preview is capped at 12, mobile panels remain viewport-width, and exception copy does not claim stock changed.
- Authorization/security changes: All mutations derive company, user, workorder, and allowed locations from the authenticated actor. Parts module policy is enforced for fulfillment; inventory availability is restricted to local-authority rows; idempotency keys and transaction locks close concurrent replay races; scan resolution stays opaque and location scoped.
- Failure/reconciliation behavior: Mismatch/damage stops without posting. Recommendation approval remains explicit audit evidence only. Cancel/close/reassignment/self-release cannot orphan an issued serialized unit. Duplicate idempotency keys replay only the same request hash and conflict otherwise.
- Verification: Repository unit suite passed 1,158 tests with 4 opt-in PostgreSQL tests skipped and zero failures. The opt-in PostgreSQL suite passed concurrent full-receipt replay, exact-unit issue/install/return, bounded fulfillment lookup, and concurrent fulfillment create/approval. Structure checks, syntax checks, and the Vite production build passed. Authenticated rendered walkthrough verified reviewed-field locking, mismatch no-write, full receipt and persistence, inventory/detail/history, exact QR and manual-code resolution, phone no-overflow, fulfillment recommendation, and truthful approval copy. Synthetic QA invoice, receipt, two units, workorder, asset, catalog part, and fulfillment records were removed after proof.
- Release evidence: Local working tree only. No commit, push, deployment, production mutation, or external provider write was authorized.
- Remaining gaps: Partial/damaged receipt write flow, actual reserve/transfer/send/receive execution, purchase-from-vendor fallback, warranty/problem reporting, cores, cycle counts/adjustments, valuation, dedicated Parts permissions, durable printer completion, and real-device camera-permission proof.

### INV-20260826-03 — Chino opening-count import and serialized labels

- Status: VERIFIED
- Decision/requirement: Load the unfinished Chino spreadsheet as a safe review draft, reuse company master-part identity, and make physical quantities printable as individually serialized labels without re-entering parts.
- Before: Inventory could be added from reviewed invoices, but a location opening count had no bounded import, persisted exception review, or safe provider-projection replacement workflow.
- After: Inventory contains an opening-count flow that parses the XLSX lazily in the browser, persists all original rows and match decisions, exact-matches only the authenticated company catalog, and applies only ready rows after explicit physical-count attestation. One operator apply processes every ready unit without a separate serialized-unit ceiling; the backend keeps receipt and QR-label batches capped at 500 units without exposing batching controls. Applied rows create append-only adjustment evidence, local balances, exact serialized children, and bounded label batches. The supplied 192-row workbook is stored locally as Chino draft `057de8fb-30e0-4313-908a-b61c563113a4`: 84 automatic exact matches plus 2 manually reviewed matches (86 ready), 106 review, 0 applied.
- Canonical owners: `inventory_count_imports`; `inventory_count_import_lines`; `src/server/modules/inventory/inventory-count-imports.service.js`; `src/server/db/repositories/inventory-count-imports.repo.js`; `frontend/src/features/inventory/InventoryCountImportPanel.jsx`.
- Data/API changes: Migrations `071_inventory_count_imports.sql`, `072_inventory_movement_generic_receipts.sql`, and `073_inventory_count_authority_audit.sql`; scoped catalog search plus count create/read/list/resolve/apply routes.
- User-experience changes: The operator chooses Count inside Inventory, uploads the workbook once, resolves only visible exceptions against master data, confirms the numbers were physically counted, applies ready rows, and prints generated label batches. Refresh preserves the draft.
- Authorization/security changes: Company and location derive from authenticated scope; input is capped at 2 MB/500 rows and validated again server-side; spreadsheet values cannot create or overwrite master parts; stale versions, duplicate part selections, local stock, reserved stock, and missing QR configuration fail closed.
- Failure/reconciliation behavior: Duplicate part numbers, `12 pack`, missing/invalid identity, and unmatched parts remain visible non-writing exceptions. Replacing an Odoo projection preserves its provider identity, quantity, reservation, and timestamps in the immutable authority-cutover audit.
- Verification: Focused service, contract, and real-route tests passed; real PostgreSQL rehearsal applied 550 units across two bounded batches, preserved the prior Odoo quantity snapshot, replaced the projection exactly once, and passed replay and cross-location negatives. Production build, full suite, and final rendered walkthrough are recorded in the task evidence.
- Release evidence: Local working tree and local database only. No commit, push, deploy, production mutation, or external provider write was authorized.
- Remaining gaps: The 108 workbook exceptions require human resolution and physical verification; general cycle-count corrections, manufacturer serial capture, printer completion, and parts out/transfer workflows remain separate slices.

### INV-20260828-01 — Stock-only Inventory and invoice-intake history ownership

- Status: LOCAL VERIFIED
- Decision/requirement: Keep Inventory focused on stock and place invoice upload, review, receipt actions, and history in one progressive Invoice Intake surface.
- Before: Inventory owned a Stock/Invoice history toggle, loaded up to 100 history rows for client pagination, and duplicated invoice-history presentation outside intake.
- After: Inventory loads and renders stock only. Invoice Intake owns the existing receipt-enriched history read model beneath the new-invoice action, with server pagination, debounced abortable search, status filtering, and contextual Review, Add inventory, View, and Print QRs actions.
- Canonical owners: `frontend/src/features/inventory/InventoryWorkspace.jsx`; `frontend/src/features/office/InvoiceExtractionWorkspace.jsx`; `frontend/src/features/office/InvoiceHistoryPanel.jsx`; `src/server/modules/inventory/local-inventory.service.js`; `src/server/db/repositories/local-inventory.repo.js`.
- Data/API changes: No migration. `GET /api/office/inventory/invoices` remains backward-compatible and adds `page`, `total`, and `pageCount`; its SQL remains company/location scoped and now uses bounded `limit`/`offset` with a matching total even when the requested page is empty.
- User-experience changes: The Stock/Invoice history toggle is removed. Invoice Intake shows one upload action and Recent invoices, omits misleading actions for processing/failed rows, restores keyboard focus after viewing a saved invoice, and labels reversed receipts truthfully.
- Authorization/security changes: History, saved-run/source reads, review, and receipt confirmation continue deriving company/location scope from the authenticated actor. The UI does not submit tenant or location authority. Company-wide Office inventory/QR reads remain distinct from assigned-location invoice-document access.
- Performance changes: Inventory no longer contains history state/request/rendering. Embedded intake reuses parent locations instead of requesting the Office template twice; history requests are abortable, debounced, and limited to 20 server-paginated rows.
- Verification: Focused frontend/API/service/repository contracts passed 62/62; the full unit suite passed 1,259 with 7 opt-in tests skipped and 0 failures; focused real-PostgreSQL pagination/location isolation passed; build, structure, database health, and diff checks passed. Authenticated localhost verified stock-only Inventory, intake history/filter/actions, review-heading focus, exact-row focus return, no horizontal overflow in a narrow viewport, and an empty error console.
- Release evidence: Local working tree and localhost only. No commit, push, deployment, Odoo write, or production mutation was authorized.
- Remaining gaps: Search still uses bounded tenant-scoped wildcard matching over current JSON projections; dedicated searchable columns/indexes should be considered only when observed history volume warrants them.

### INV-20260829-01 — Editable part identity and structured reference numbers

- Status: LOCAL VERIFIED
- Decision/requirement: Let Office/Admin correct local part identity inside existing part detail without creating another page or allowing local UI to overwrite Odoo-owned product truth.
- Before: Part detail was read-only; alternate numbers were unavailable as structured data; learned `aliases` mixed only search phrases from approved requests; no catalog mutation version or durable manual-edit audit existed.
- After: Existing secondary part detail opens one minimal editor for part name, primary number, manufacturer, category, catalog barcode, and up to 20 reference numbers. Local parts expose all fields. Any Odoo mapping makes provider-owned name, primary number, category, barcode, and UOM read-only while manufacturer and local reference numbers remain editable enrichment. Saved values survive the stock refresh and reference numbers participate in bounded catalog and inventory search.
- Canonical owners: `src/server/db/repositories/parts-catalog-edit.repo.js`; `src/server/modules/inventory/inventory-part-details.service.js`; `PATCH /api/office/inventory/parts/:catalogPartId`; `frontend/src/features/inventory/PartIdentityEditor.jsx`; existing `InventoryWorkspace.jsx` detail panel.
- Data/API changes: Migration `084_part_catalog_editing.sql` adds `parts_catalog.version`, tenant-scoped indexed `part_reference_numbers`, and transactional `part_catalog_edit_events`. PATCH requires the current version and a strict complete identity payload. Primary renames preserve `catalog_part_id`, update current local `inventory_items` projections atomically, and leave receipt, movement, request, and label history unchanged.
- User-experience changes: One Edit part action, inline Save/Cancel, dynamic reference rows, client/server duplicate detection, busy/error states, and explicit stale-edit reload behavior. Duplicate-identity conflicts keep the fields editable and show the actionable server message; only stale versions offer Reload. Editing blocks silent drawer dismissal and location drilldown until Save or Cancel. Phone layout keeps 44px controls and sticky actions.
- Authorization/security changes: Existing `WORKORDER_OFFICE` route permission covers Office/Admin; service and repository repeat role/company enforcement. Cross-tenant IDs return 404. Every runtime primary-catalog writer shares the company identity lock, rejects primary/reference collisions, and advances the optimistic version when it changes current catalog state. Row locks, deterministic normalized uniqueness, provider ownership checks, and atomic audit prevent lost updates, ambiguous exact identities, and partial writes.
- Performance changes: Reference numbers use a child table with prefix/trigram indexes. Display and punctuation-normalized search use bounded `EXISTS` predicates and correlated aggregation, avoiding N+1 reads and stock/location row multiplication.
- Verification: The final independent gate passed 65 focused tests with one opt-in PostgreSQL test skipped, plus production build and diff check. A fresh temporary PostgreSQL database applied all 84 migrations and passed database health. Real PostgreSQL passed local identity cascade, tenant isolation, conflict rollback, concurrent stale-write rejection, Odoo ownership, transactional audit, normalized reference lookup, Odoo writer versioning/collision rejection, invoice pagination, stock sorting, and concurrent receipt regression. Authenticated localhost saved and reloaded three reference numbers, found the part by a reference, had no console errors or horizontal overflow at 390/768/1440, and exposed accessible names for every reference input. Two skeptical review rounds found one high and five medium issues across cross-writer identity, versioning, normalized search, error copy, stale refresh, and drawer dismissal; all were corrected before the fingerprint-stable PASS recheck.
- Release evidence: Local working tree only. No commit, push, deployment, production mutation, or Odoo write was authorized.
- Remaining gaps: Dedicated Parts permission remains separate future work. Provider-managed product identity must still be changed in Odoo. Bulk editing and reference types/labels are intentionally outside this minimal slice.

### INV-20260829-02 — Office-owned workorder Parts scanning

- Status: LOCAL VERIFIED
- Decision/requirement: Make exact-unit scan/add Office-owned by default, keep Mechanics unable to add by default, and allow a role or named-user exception from Modules without permanently rendering a full scanner panel.
- Before: The unshipped exact-unit component was Mechanic-only, used Mechanic-prefixed routes, depended on a legacy location toggle, and mounted only inside the Mechanic used-parts workflow. Office Parts had no scan action and Modules could not grant this exact capability independently from broader Parts edits.
- After: Office/Admin Parts exposes one 44px scanner icon with an accessible `Scan parts` name and hover/focus tooltip. Bounded usage history loads on Parts mount so issued evidence survives refresh, while activating the icon progressively mounts the camera/manual scanner; closing unmounts that surface and restores trigger focus. Mechanics are off by default. A company/location role or named-user `Part scanning` Edit grant exposes the same control without granting broader Parts edits; when broader Parts is hidden, the grant exposes a scanner-only Parts section. A resolved identity still requires exact-part confirmation before the issue transaction adds it to the current workorder.
- Canonical owners: shared `partsScanning` module policy; `frontend/src/components/workorders/part-requests/SerializedPartsScanner.jsx`; `InventoryCodeScanner.jsx`; inventory-unit workorder service/repository/canonical routes.
- Data/API changes: Catalog version 2 adds the detail-only `partsScanning` access module. Role-neutral `/api/workorders/:id/inventory-*` contracts replace the unshipped Mechanic-prefixed paths. No database migration or evidence rewrite is required because normalized module rules already store sparse text module keys.
- User-experience changes: One compact next action appears inside Parts. Camera/manual scan work remains deferred until activation; the bounded usage list loads on mount and merges stale pre-mutation history without allowing it to overwrite a newer issue/finalization. Issued units and Installed/Return unused dispositions remain visible after issue. Modules explains that Edit permits exact scan/issue and that Mechanics are off by default.
- Authorization/security changes: Resolve/issue/finalize require canonical `partsScanning` write access; list requires read. Every request re-derives exact workorder company/location, explicitly enforces the actor's location scope, and revalidates active assignment for Mechanic actors. Office/Admin need no mechanic assignment. The legacy `mechanicCanRecordParts` flag continues to govern manual Mechanic used-parts entry only and cannot authorize scanning.
- Failure/reconciliation behavior: Invalid/tampered or out-of-scope labels still resolve as not found; stale/unavailable/provider/stock mismatches still fail closed without an inventory mutation.
- Verification: The pre-review gate passed 70 focused tests, 1,372 full unit tests (1,363 pass, 9 opt-in skips, 0 fail), production check/build, and 2 real PostgreSQL integrations. Authenticated localhost proved Office defaults, the compact 44px scanner, exact resolve/issue, issued state after reload, Return unused, stock restoration, no phone-width overflow, focus restoration, and a clean fresh-page console. The temporary local workorder/asset and its usage/events/movements were removed after verification; the real serialized unit was confirmed `in_stock`. Independent review found and drove fixes for narrow-grant visibility and stale list-response ordering; final recheck evidence is recorded in the task state.
- Release evidence: Local working tree only. No commit, push, deployment, production mutation, or Odoo write was authorized. One temporary local QA issue/return was explicitly performed for this localhost verification and fully cleaned up.
- Remaining gaps: Automatic no-confirm issue, bulk scan, transfer receiving, damaged/core dispositions, and actual-device camera-permission proof remain outside this slice.

### INV-20260829-03 — Approval-gated serialized-part reservation lifecycle

- Status: LOCAL VERIFIED; RENDERED STAGING NOT VERIFIED
- Decision/requirement: Keep an exact installed part reserved, not deducted, until Office approves the workorder; support explicit removal with durable timeline evidence and correct availability restoration.
- Before: Exact-unit issue immediately decremented on-hand. Install was final before Office approval, and removal after install had no supported disposition or workorder timeline projection.
- After: New local usages reserve one exact unit while on-hand stays unchanged. Install records `installed_pending_approval`; Office close consumes it atomically and records `installed`. Explicit pre-approval removal records `returned`, releases reserved quantity, and restores availability without inflating on-hand. Explicit post-approval removal records `removed` and does not put a used item back into sellable inventory.
- Canonical owners: `inventory_serialized_units`; `inventory_unit_workorder_usage`; `inventory_unit_events`; `inventory_stock_movements`; `inventory_items`; inventory-unit workorder repository/service/routes; operational-workorder close transaction; shared workorder Parts scanner and Activity projection.
- Data/API changes: Migration `087_workorder_serialized_part_reservation_lifecycle.sql` adds the reservation/pending/removal states, an active-unit uniqueness guard, and idempotent disposition commands. Existing issue/finalize endpoints retain their shape; `removed` is an added final disposition. Legacy already-issued rows preserve their original accounting and are never consumed twice.
- User-experience changes: The operator sees Reserved, Installed — awaiting office approval, Installed, Returned, or Removed. Removing requires confirmation. Activity shows the part number and serialized identity for reserve/install/return/removal events; accounting transitions are not exposed as operator controls.
- Authorization/security changes: Existing authenticated company, location, module, and assignment checks remain authoritative. Only local-authority stock can enter this lifecycle; Odoo/provider stock fails closed without a provider command. Idempotency keys and row locks prevent replay and concurrent double reservation/consumption.
- Failure/reconciliation behavior: Work done blocks unresolved reservations. Office close and pending-install consumption share one transaction. A pre-approval return changes reserved/available only; a post-approval removal requires inspection/quarantine outside this slice and never silently increases on-hand. Aggregate request allocations are respected by the availability calculation but are not explicitly bound to a serialized unit.
- Verification: Focused model, route, service, repository, lifecycle, timeline, and projection tests passed. A fresh disposable PostgreSQL database applies all migrations and exercises the exact reservation lifecycle; final full-suite and independent-review evidence is recorded in the task state.
- Release evidence: Local verification is complete and Git delivery to `origin/staging` is authorized. No Railway deployment, database migration, production mutation, Odoo write, or staging data mutation is authorized.
- Remaining gaps: Bind aggregate allocations to exact reserved identities; add damaged/quarantine/inspection disposition and restock approval for removed used parts; perform an authenticated rendered staging walkthrough after deployment is separately authorized.

### INV-20260915-01 — Internal and selling prices with explicit tax history

- Status: IMPLEMENTED (local working tree; authenticated browser and targeted database verification passed).
- Decision/requirement: Research then implement internal price, selling price and tax as the next inventory foundation.
- Before: Separate price history existed, but tax treatment, reusable rates and authoritative breakdowns were absent.
- After: Explicit unknown/inclusive/exclusive/zero-rated/exempt/out-of-scope treatment, immutable company tax profile versions, and decimal quantity/discount previews preserve historic assumptions.
- Canonical owners: inventory-part-prices repository/service, inventory-tax-profiles repository/service, inventory-pricing calculation/routes, PartCommercialDetails and its model.
- Data/API changes: Additive migration 135; tax-profile create/revise/archive/list and part pricing-preview routes. Existing price writes retain compatible unconfigured legacy behavior with replay protection.
- User-experience changes: Edit each price with currency, treatment and reason; choose or create a matching reusable profile; inspect optional breakdown and history. Missing price/tax remains Unknown.
- Authorization/security changes: Financial read/write permissions and authenticated company scope; no mechanic/public financial exposure.
- Failure/reconciliation behavior: Stale edits and conflicting retries fail; saved prices retain exact historic profile versions. No inferred statutory rate or jurisdiction.
- Verification: Authenticated local browser passes profile creation/revision, preserved price drafts, both price save/reload flows, failed-save retry, inclusive/exclusive tax, discounts, historical rate retention, Unknown versus zero, and 1440/768/390 layouts with no page errors. Populated migration preserves existing price values and adds unknown historical tax; fresh full migration and no-op replay pass. Exact arithmetic, API error/role/company scope and PostgreSQL profile history checks pass. Full-suite and independent-review evidence is recorded in the external pricing task state.
- Release evidence: None. No commit, push, deployment, production mutation or Odoo write authorized.
- Remaining gaps: Workorder billing snapshots, customer/tier pricelists, invoice posting tax policies and Odoo export mapping are separate work.

### INV-20260915-02 — Compact part detail

- Status: IMPLEMENTED locally; validation recorded in the part-detail-ux task.
- Decision/requirement: Simplify part detail and configured prices; remove explanatory prose from routine screens.
- Canonical owners: InventoryWorkspace, PartCommercialDetails and their existing styles.
- User-experience changes: Compact available/on-hand/reserved totals; one Prices section; visible current amounts and tax status; full-width contextual editors; optional history, calculation and tax setup; populated identity fields only.
- Data/API and authorization changes: None. Existing permissions, price versions, tax profiles, retry handling and location actions are retained.
- Verification: Authenticated responsive browser flows, existing commercial and workspace contracts, shared dropdown contracts, build and independent review are required in the task record.
- Release evidence: Local development only; no commit, push or hosted deployment.

### INV-20260917-02 — Location commercial context and safe invoice-to-PO receiving

- Status: LOCAL VERIFIED.
- Decision/requirement: Make the stocked location the working context for price and receipt evidence, and let reviewed invoices use exact purchase-order evidence without allowing invoice and PO receiving to count the same stock twice.
- Before: Part detail emphasized company prices outside its locations. Invoice review could post a direct inventory receipt but had no bounded PO suggestion or shared allocation guard with purchase receiving. Opening an untouched Create Workorder could persist a blank draft after automatic location/template hydration.
- After: A part opens with Locations first. Choosing a location shows its effective internal and selling prices, company fallback, bounded receipt cost evidence and invoice lineage; Shelves & bins remains a secondary closed action. Company price defaults stay in a collapsed fallback section. Reviewed invoices show exact, scoped PO suggestions and require an explicit operator choice. The operator can instead choose No PO; an extracted PO requires a reason before that bypass. Purchase-linked posting validates a complete invoice-line allocation and writes the receipt, allocation evidence and PO received quantities in one transaction. Untouched Create hydration adopts the initial baseline and does not create a draft, while a user edit retains normal save and recovery.
- Canonical owners: `inventory_part_price_versions`; `inventory_receipt_lines`; `inventory_purchase_invoice_allocations`; `inventory_purchase_receipt_allocations`; `frontend/src/features/inventory/PartCommercialDetails.jsx`; `frontend/src/features/office/InvoiceExtractionWorkspace.jsx`; `src/server/modules/inventory/inventory-purchase-invoice-allocation.service.js`.
- Data/API changes: Migration `153_purchase_invoice_allocations.sql` adds explicit invoice receipt route/reason fields and immutable reviewed-invoice-line to purchase-line allocation evidence. `GET /api/office/invoice-extractions/:runId/purchase-order-suggestions` returns exact normalized PO/vendor candidates only. Physical confirmation accepts either `purchase_order` with a complete allocation plan or `no_purchase_order` with the applicable reason.
- Authorization/security changes: Suggestions and posting re-derive company and location scope from the actor. Posting revalidates PO number, vendor, catalog part/part number, UOM, tracking policy and outstanding quantity while holding deterministic PO-line locks. Cross-tenant or cross-location candidates are unavailable.
- Failure/reconciliation behavior: Missing and ambiguous matches remain non-writing review states. An invoice without extracted PO evidence can use No PO without inventing one. A bypass of extracted PO evidence requires an operator reason. Idempotent replay returns the existing receipt; changed replay, stale evidence, over-allocation and concurrent direct-versus-invoice receiving fail before duplicate stock can post.
- Verification: Focused frontend tests passed 88/88. Backend allocation/service tests passed 22/22, route tests passed 24 with one legacy opt-in skip, and direct-receipt regressions passed 9/9. Real PostgreSQL passed exact suggestion, authorization, replay, cross-tenant and concurrent invoice/direct receiving checks. Production build and diff check passed. Authenticated localhost verified the location-first drawer at desktop and 390px, collapsed shelving, no inventory API errors, no untouched draft write, edited draft persistence and reload.
- Release evidence: Local working tree and local test database only. No commit, push, deployment, production mutation, accounting post or Odoo write was authorized.
- Remaining gaps: Fuzzy or AI PO matching, partial-delivery invoice allocation, supplier credits, bill/payment accounting and hosted-device proof remain later slices.

### INV-20260917-03 — Tracking-aware partial receiving and receipt batches

- Status: LOCAL VERIFIED.
- Decision/requirement: Receive invoice and purchase-order lines across multiple physical deliveries while deriving identity and labels only from the saved catalog tracking mode.
- Before: The normal purchase flow used an order-level delivery confirmation before stock intake, reviewed invoices assumed one complete receipt, and whole-unit quantities could be treated as serialized without a saved serialized policy.
- After: Invoice Intake and Purchases share one line editor for available, held, rejected, short, wrong and over-delivery evidence. Each receipt episode posts only entered rows, accepted quantity alone becomes usable, and remaining quantities keep the PO open. Quantity and measured/bulk stock remain aggregate and label-free. Serialized available and held units retain exact identities; held identities use unavailable `held` custody status. Exact retries return the original receipt, while changed or concurrent over-receipts fail.
- Canonical owners: `inventory_receipt_lines`; `inventory_purchase_deliveries`; `inventory_purchase_delivery_lines`; local-inventory repository/service; inventory-purchasing service; `ReceiptLinesEditor`; `InvoiceExtractionWorkspace`; `InventoryPurchases`.
- Data/API changes: Migrations `154_inventory_partial_receiving_batches.sql` through `157_inventory_allocation_cleanup_boundary.sql`; repeated local receipts per reviewed invoice; tracking/cost/currency snapshots on canonical receipt-line batches; `POST /api/office/inventory/purchasing/:orderId/receipts`; stronger delivery source/location guards.
- User-experience changes: Operators enter only the current delivery, see invoice/PO remaining quantities, provide exception evidence in context, and post once. Retry identity is retained until the episode succeeds. A later episode remains available until every invoice quantity is received. Print actions appear only when the server returns serialized units and a label batch.
- Authorization/security changes: Company, location and actor come from authenticated scope. Saved catalog tracking, current PO/invoice quantities and source relationships are revalidated under transaction locks. Database guards require delivery, PO, invoice and receipt evidence to share company and location.
- Failure/reconciliation behavior: Rejected and held quantities never increase usable stock. Accepted overages remain blocked until the order/invoice is revised; an over-delivery can be recorded as held exception evidence. A fully missing shipment writes durable shortage evidence with no stock line or label. Cancelling the remainder of a partially received PO records `closed_with_discrepancy`; cancelling an untouched PO records `cancelled`.
- Verification: Focused frontend/backend/schema suites pass; strict generated browser payloads parse through both backend receipt schemas. Real PostgreSQL passes partial receipt, exact replay, changed replay, invoice-versus-direct concurrency, aggregate label exclusion, serialized available/held identity, label batch, cost evidence and cleanup checks. Production build passes. Isolated rendered mixed receipts pass at 1440px and 390px without overflow.
- Release evidence: Local working tree and local disposable test database only. No commit, push, deployment, hosted database mutation, accounting post or Odoo write was authorized.
- Remaining gaps: Discrepancy resolution after closure, supplier credits, receipt reversal, hosted authenticated walkthrough and real-device scanner/printer proof remain separate work.

### INV-20260917-04 — Guided Invoice Intake review and receiving workspace

- Status: LOCAL VERIFIED.
- Decision/requirement: Keep one source document visible while operators resolve invoice evidence and physical receipt facts with minimal steps, without merging invoice approval and inventory posting.
- Before: Invoice review exposed one long form; physical receiving competed for attention and compact screens lacked an explicit source/review mode.
- After: Desktop uses a bounded source canvas and independently scrolling review rail. Tablet and phone use an accessible Document/Review switch. Unresolved sections and lines lead; completed sections collapse to truthful summaries. Delivery owns exact-PO/no-PO selection, tracking-aware quantities, serialized identities, attestation, and progressive exception evidence. Partial posted receipts remain Pending until invoice outstanding quantity reaches zero.
- Canonical owners: `frontend/src/features/office/InvoiceExtractionWorkspace.jsx`; `PhysicalReceiptConfirmation.jsx`; `ReceiptLinesEditor.jsx`; adjacent models, styles and contracts; `src/server/db/repositories/inventory-purchase-invoice-allocation.repo.js`.
- Data/API changes: No new route or schema. Purchase-order suggestion responses now retain authoritative receipt-line tracking facts for no-PO, unmatched, ambiguous, fully received and matched outcomes.
- User-experience changes: One active line editor, receive-all shortcut that leaves serialized identity entry explicit, one state-relevant primary action, accessible disclosure semantics, and 44px compact controls.
- Authorization/security changes: None. Existing Office/Admin route, company and location scope remain unchanged.
- Failure/reconciliation behavior: Missing tracking facts fail closed. Nothing received is write-free. Stale receipt inputs reset only after a successful post; suggestion retries preserve current operator input. Reversal remains server-owned and truthful.
- Verification: Focused frontend model/contract suite passed 50/50; real PostgreSQL purchase-invoice allocation integration passed, including serialized unmatched and ambiguous responses; structure check and production build passed. Authenticated localhost covered unresolved no-PO serialized entry, completed PO, desktop/tablet/phone, keyboard view switching, and 200%-equivalent reflow without horizontal overflow.
- Release evidence: None; local working tree only.
- Remaining gaps: Native browser zoom control was unavailable, so 200% was verified by equivalent CSS-pixel reflow. No persisted partial-receipt browser fixture existed; partial Pending behavior is covered by focused model/contract and PostgreSQL tests. No hosted or physical-device proof.

### INV-20260918-01 — Unified Add inventory and exact receipt placement

- Status: LOCAL VERIFIED.
- Decision/requirement: Give daily operators one clear inventory entry point while keeping receiving, physical counts, and starting balances as distinct stock actions.
- Before: Manual intake started only from an already selected part and always posted usable stock to the system Receiving position. Finding a master part, choosing a shop, counting existing stock, and loading starting balances were separate or unclear workflows.
- After: Stock exposes one `Add inventory` action. The operator selects a shop and master-catalog part, then chooses Receive stock, Physical count, or Starting inventory. Receive stock follows the saved quantity, measured/bulk, or serialized tracking policy and can place accepted stock into an eligible exact storage position. Leaving the position blank uses system Receiving. Physical count opens the canonical location count workflow; Starting inventory opens the existing count-sheet import without posting a direct receipt.
- Canonical owners: `frontend/src/features/inventory/AddInventoryStockDialog.jsx`; `StoragePositionPicker.jsx`; `direct-receipt-model.js`; `InventoryWorkspace.jsx`; `src/server/modules/inventory/direct-inventory-receipt.service.js`; `src/server/db/repositories/local-inventory.repo.js`; `inventory-positions.repo.js`.
- Data/API changes: Direct receipt commands accept an optional `targetPositionId`, which is bound into confirmation and idempotency hashes. No migration is required. The receipt transaction locks and revalidates an explicit destination as same-company, same-shop, active, storage-use, storable, pickable, and non-system before writing placement movements. Omitted destinations retain the existing system Receiving behavior.
- User-experience changes: One-column, resumable modal with progressive disclosure and shared controls. Shop changes clear stale part and destination choices. The catalog search and exact-position picker show the facts needed for selection. Compact screens use a full-width sheet with 44px controls. Existing contextual Add stock remains available with the part prefilled.
- Authorization/security changes: Existing Office/Admin company and location authorization remains authoritative. The server owns catalog tracking and destination eligibility; client filtering is convenience only. Invalid, cross-scope, system, receiving-use, inactive, non-storable, or non-pickable explicit targets fail with the generic `INVENTORY_RECEIPT_POSITION_INVALID` response.
- Failure/reconciliation behavior: Invalid destinations roll back without creating a receipt or movement. Held stock cannot be placed into a sellable storage position. Exact replay returns the original receipt; changed payloads conflict. Count and starting-inventory handoffs never call the direct-receipt endpoint.
- Verification: Focused frontend and backend suites passed, the production build passed, and a disposable PostgreSQL run passed concurrency, default Receiving, exact measured placement, rejected-target rollback, serialized identity, isolation, and reconciliation. Independent review passed after the explicit-target eligibility fix. Authenticated localhost verified the entry action, catalog selection, serialized receive state, physical-count handoff, and 390px full-width layout without horizontal overflow.
- Release evidence: Local working tree only. No commit, push, deployment, hosted database mutation, accounting post, or Odoo write was authorized.
- Remaining gaps: Starting-inventory handoff does not yet preselect the chosen shop inside the import panel. No live-browser receipt was posted to the configured local database. Hosted and physical-device proof remain separate work.

### INV-20260918-02 — Exact destination safety for transfer receipt and damage release

- Status: LOCAL VERIFIED.
- Decision/requirement: A transfer receipt or approved damage release cannot complete with only a free-text shelf claim. It must restore stock to an eligible exact physical position.
- Before: Transfer receipt and damage release accepted a physical-location text field while the canonical placement helper defaulted aggregate balances and exact units into `SYS-UNASSIGNED`.
- After: Both commands require `targetPositionId`. The server locks and validates a same-company, same-shop, active, non-system, `storage`-use, storable, pickable position and places aggregate balances or exact units there in the same transaction. Free text is retained only as the receiving handoff, inspection, repair, or disposal reference.
- Canonical owners: `InventoryStockTasks`; shared `StoragePositionPicker`; stock-task schema/service/repository; canonical inventory-position receipt helpers.
- Data/API changes: No migration. `receive_transfer` and `release` stock-task commands now require an exact target UUID, which is included in replay hashing and position-operation evidence.
- Failure/reconciliation behavior: Missing, inactive, system, non-storage, non-storable, non-pickable, wrong-shop, wrong-company, or changed-replay targets fail before commit. Partial receipt stays in transit; exact identities and aggregate balances remain reconciled with their position movements.
- Verification: Focused model/service/route/contract tests passed 46/46 and direct-receipt regressions passed 17/17. Three fresh migrated PostgreSQL lifecycle tests passed aggregate and serialized receipt/release placement, every invalid target class, rollback, idempotent replay, replay drift, and partial receipt. Authenticated Playwright passed at 1440×1000, 820×1180, and 390×844 with keyboard order, eligible-only options, stale shop reset, no overflow, and no browser/API errors. Temporary accounts and fixture rows were removed. Production build, diff check, and independent fingerprint-stable review passed.
- Release evidence: Local working tree only. No commit, push, deployment, hosted mutation, accounting post, or Odoo write was authorized.
- Remaining gaps: The broader mixed Inventory PostgreSQL runner still includes legacy purchasing-request and approval tests that conflict with the retired standalone request flow; those are handled in the Purchasing slices.

### INV-20260918-03 — Unified Inbound read surface

- Status: LOCAL VERIFIED.
- Decision/requirement: Give operators one Inbound queue for expected deliveries, invoice-first work, goods-first work, condition exceptions, and completed receipt evidence without merging or duplicating the canonical financial and stock records.
- Before: Expected deliveries lived under Purchasing while invoice intake, direct receipt, PO receipt, and condition work were opened from separate surfaces. The operator had to infer the next action and owner.
- After: Inventory navigation is Stock, Inbound, Purchasing, Tasks, and Reports. Inbound derives My work, Expected, Needs attention, and Complete from existing purchase orders, invoice allocations, reviewed invoice evidence, local receipts, and delivery condition evidence. Each row shows PO or permanent `No PO used` truth, progress, next action, and owner. PO-backed invoices stay consolidated on their PO row.
- Canonical owners: `InventoryInboundWorkspace.jsx`; `inventory-inbound-model.js`; `inventory-inbound.routes.js`; `inventory-inbound.service.js`; `inventory-inbound.repo.js`. Existing PO, invoice, receipt, count, and stock-task mutations remain canonical.
- Data/API changes: No migration. Read-only company-scoped endpoints expose the bounded Inbound list and detail projection. Counts are derived before pagination and respect search. Detail reads fail closed outside company, shop, and role scope.
- User-experience changes: Add inventory and Upload invoice are contextual Inbound actions. Purchasing contains Needs ordering and Purchase orders. Desktop uses the shared collection layout and compact screens preserve one-column navigation and handoffs. Mixed UOM lines display separate unit types rather than a mathematically invalid total.
- Authorization/security changes: Existing Office/Admin company and authorized-shop scope is enforced server-side. Cross-company, unauthorized-shop, and missing-detail reads return no record. The read projection cannot write stock, PO, invoice, or receipt state.
- Failure/reconciliation behavior: Open POs derive Receive goods; held, rejected, and short receipts derive Review exception; unmatched reviewed invoices derive Resolve no PO in Needs attention; direct goods-first arrivals derive Review invoice; completed records expose no mutation action. A missing PO is never synthesized.
- Verification: Focused frontend/service/route tests passed 35/35. Expanded fresh PostgreSQL integration covered expected, partial, complete, condition exceptions, direct and posted no-PO paths, unmatched and allocated invoices, global counts, search, authorization, 404, and no stock mutation. Four fresh-database adjacent regressions and 62 focused adjacent tests passed. Authenticated Playwright passed at 1440×1000, 820×1180, and 390×844; production build and diff check passed. One HIGH unmatched-invoice classification finding was fixed and final fingerprint-stable independent review passed.
- Release evidence: Local working tree only. No commit, push, deployment, hosted mutation, accounting post, or Odoo write was authorized.
- Remaining gaps: This slice intentionally did not replace the existing PO, invoice, receipt, or exception mutation editors. Compact PO creation and unified Inbound entry are the next slices. Hosted and physical-device proof remain separate work.

### INV-20260919-01 — Compact demand-backed Purchase Orders

- Status: LOCAL VERIFIED.
- Decision/requirement: Turn automatic purchasing demand into a small PO workflow without weakening source lineage, approval controls, or the separate physical receipt boundary.
- Before: Needs ordering used Add to PO wording even though the server only created a new linked draft. The editor exposed supplier, currency, expected date, price, manual line entry, notes, new supplier, Save draft, and Save/Place together. Price and date blocked placement.
- After: Needs ordering uses Create order and always starts a new supplier-scoped PO. Selected demand lines are locked summaries. Routine users choose Supplier and Place order; optional price, configured currency, expected date, notes, and new supplier are under More details. Direct exceptional PO creation keeps the complete manual editor. Demand drafts survive tabs, asynchronous location loading, and reload, then are consumed after successful placement.
- Canonical owners: `InventoryNeedsOrdering.jsx`; `InventoryPurchases.jsx`; `purchasing-demand-model.js`; `inventory-purchasing.repo.js`; purchase approval policy and immutable `inventory_purchase_line_sources`.
- Data/API changes: No migration. Purchasing reads now include configured purchase defaults. PO placement permits an absent expected date and nullable line cost; any unpriced line is treated as an unbounded commitment and routes to `awaiting_approval`. Fully priced totals continue to use the configured threshold and currency.
- Authorization/security changes: Existing company/shop scope, current demand advisory locks, catalog re-read, version checks, actor-scoped idempotency, and approver membership remain server-enforced. A PO creation or approval never posts stock.
- Failure/reconciliation behavior: Changed demand returns `INVENTORY_PURCHASE_DEMAND_STALE`; replay returns the existing result; changed replay payload conflicts; currency mismatch fails against approval policy. Partial receipts and cancellation continue reconciling source received/cancelled quantities. Successful placement clears the recoverable client handoff so old demand cannot be ordered again from the editor.
- Verification: Focused frontend/backend contracts passed 39/39. The fresh migrated Inventory workflow suite passed 10/10. Chrome QA passed compact demand and direct exceptional flows at 1440×1000, 768×1024, and 390×844, including async locations, tab/reload recovery, keyboard placement, no overflow, and no page errors. Production build and diff check passed. Independent review findings for post-success mode, tab persistence, and async reload recovery were fixed; final stable-fingerprint re-review passed.
- Release evidence: Local working tree only. No commit, push, deployment, hosted mutation, accounting post, or Odoo write was authorized.
- Remaining gaps: Hosted and physical-device proof remain separate work. Unified invoice/goods entry and permanent no-PO mutation evidence are Slice 3.

### INV-20260919-02 — Unified Inbound entry and truthful no-PO evidence

- Status: LOCAL VERIFIED.
- Decision/requirement: Let operators start from invoice, purchase order, or exceptional physical arrival while preserving one canonical receipt path and never manufacturing a PO from an invoice.
- After: Reviewed invoices with no allocation remain `PO decision needed`. Direct receipts linked to a PO line advance that PO and retain delivery/allocation evidence. Standalone arrivals require the operator's no-PO reason and configured purchase approval authority. Exact replay is recovered before later approval-policy or catalog changes can invalidate the immutable result.
- Canonical owners: `InventoryInboundWorkspace`; `AddInventoryStockDialog`; direct-receipt model/service; `inventory-inbound.repo.js`; `local-inventory.repo.js`; existing invoice extraction, purchase order, delivery, allocation, receipt, movement, and position records.
- Failure/reconciliation behavior: Invoice upload/review and PO suggestions do not write inventory or create purchase orders. Invalid role, scope, catalog version, PO state, over-receipt, exact destination, held placement, duplicate identity, approval, or changed replay fails before partial mutation.
- Verification: Focused UI/service/route tests passed; the fresh Inventory PostgreSQL gate passed 11/11; 40 invoice intake contracts, production build, and diff check passed. Authenticated Inbound and direct-arrival recovery passed at 1440×1000, 820×1180, and 390×844. A local-only real invoice file upload passed through authenticated UI/API, encrypted source persistence, background queue, loopback OCR, reload/source recovery, and zero inventory mutation at all three widths. Anonymous upload/source returned 401; QA runs, jobs, and accounts were removed. Final independent review passed at fingerprint `3c1472b4…`.
- Release evidence: Local working tree and local disposable/test database only. No commit, push, deployment, hosted mutation, accounting post, or Odoo write was authorized.
- Remaining gaps: Hosted and physical-device proof remain separate work. Stock and physical-count completion continues in Slice 5.

### INV-20260919-03 — Shared physical receipt, exact put-away, and batch evidence

- Status: LOCAL VERIFIED.
- Decision/requirement: Use one receipt-line editor and one server transaction boundary for PO, reviewed-invoice, and direct-arrival receiving while keeping their financial and source records distinct.
- After: Accepted quantity, measured/bulk, and serialized stock may remain in system Receiving or use one eligible exact storage position per line. Held, rejected, and short outcomes remain outside pickable exact stock. PO and reviewed-invoice wrappers reload destinations after a stale target, remove the invalid choice, preserve the draft and idempotency key, and allow a safe retry. Direct arrival uses the same line editor with only the outcomes that apply to that route.
- Canonical owners: `ReceiptLinesEditor`; `PhysicalReceiptConfirmation`; `InvoiceExtractionWorkspace`; `AddInventoryStockDialog`; inventory purchasing and local-inventory services/repositories; purchase delivery, receipt line, position movement, serialized unit, and invoice allocation records.
- Data/API changes: No new migration in this slice. Existing receipt-line targets are validated inside the posting transaction for company, shop, active storage use, storable/pickable status, and non-system identity. No-PO routes remove purchase-line lineage at both service and repository boundaries. Duplicate serialized identities return one stable 409 domain error.
- Failure/reconciliation behavior: An invalid destination, duplicate serial, stale order, changed replay, over-receipt, or concurrent conflict rolls back receipt, delivery, allocation, stock, serialized unit, and position writes. Shortage-only receipt episodes remain valid evidence without falsely claiming missing goods were present.
- Verification: 121 focused checks completed with no failures and one intentional skip; the fresh Inventory PostgreSQL workflow gate passed 11/11; production build and diff check passed. PO, invoice, and direct-arrival browser flows passed at 1440×1000, 820×1180, and 390×844. Evidence covers keyboard-wedge and manual serial entry, stale-target recovery, exact command replay, PO and permanent no-PO lineage, responsive overflow, and fixture/account cleanup. Independent review passed against the 29-file manifest fingerprint `0a26d6b…`.
- Release evidence: Local working tree and local test database only. No commit, push, deployment, hosted mutation, accounting post, or Odoo write was authorized.
- Remaining gaps: Slice 5 owns exact serialized physical count, measured/import precision, exact opening-count placement, actor/reason projection, and full responsive count/import proof. Hosted and physical-device proof remain separate work.

### INV-20260919-04 — Exact-position stock count and safe opening inventory

- Status: LOCAL VERIFIED.
- Decision/requirement: Keep By part and By location as peer stock views, count one exact storage position at a time, and treat starting inventory as a reviewed import of existing master parts rather than an alternate catalog or receipt shortcut.
- After: Nested location stock supports direct and subtree totals. Position counts record expected, counted, difference, observer, timestamps, applier, and reason. Quantity, measured/bulk, serialized identities, and unchanged empty positions follow their own precision and identity rules. Post-start movements or custody changes commit Needs recount and allow a clean restart. Opening imports require an existing catalog match plus an eligible exact destination; source bin text remains evidence only. Inline part creation was removed.
- Canonical owners: `InventoryLocationStockWorkspace`; `PositionCountPanel`; inventory position count repository/service; `InventoryCountImportPanel`; inventory count-import repository/service; migrations 163 through 165; existing stock, position, serialized-unit, receipt, label, and movement records.
- Data/API changes: Migration 163 adds exact serialized count snapshots/observations. Applied migration 164 remains byte-for-byte immutable and adds import precision/destination storage. Additive migration 165 reopens pending legacy ready rows for destination review while preserving applied history on system Unassigned. Catalog search now projects canonical UOM decimal scale to shared selection UI.
- Failure/reconciliation behavior: Unknown, wrong-position, cross-tenant, duplicate, stale-custody, movement-after-watermark, invalid precision, inactive/cross-shop/system destinations, changed replay, and concurrent writers fail closed. Count/import reads do not mutate stock. Injected label failure rolls back receipt, movement, item, unit, position, label, and import changes; retry remains possible.
- Verification: Frozen 29-path manifest `938283b4…`; focused tests, fresh PostgreSQL migration/integration, production build, diff check, and authenticated count/import browser workflows passed at 1440×1000, 820×1180, and 390×844. Browser proof covers nested keyboard navigation, scanner/manual identities, direct/subtree totals, Needs recount/reload, legacy migration repair, unmatched measured catalog selection with scale 2, exact placement, stale destination recovery, no overflow, and zero QA residue. Independent review passed after three bounded fix classes.
- Release evidence: Local working tree and local disposable/test database only. No commit, push, deployment, hosted mutation, accounting post, or Odoo write was authorized.
- Remaining gaps: Slice 6 owns durable no-PO approval and actor-aware unified task ownership. Hosted and physical-device proof remain separate work.

### INV-20260919-05 — Durable no-PO approval and unified Inventory task ownership

- Status: LOCAL VERIFIED.
- Decision/requirement: Give each inventory exception one truthful owner and next action while keeping every mutation in its existing receipt, transfer, count, invoice, or custody owner.
- After: Direct arrivals that require approval create an immutable request and leave stock unchanged. Authorized approval posts the original physical receipt once; reject/cancel retains evidence. The unified task queue derives all supported task types, applies current actor/company/shop/module/capability rules, and stores only versioned assignment evidence.
- Canonical owners: `DirectReceiptApprovalDetail`; `InventoryTaskQueue`; `inventory-task-queue.service.js`; `inventory-task-queue.repo.js`; `inventory-stock-tasks.repo.js`; migrations 166 and 167; existing canonical receipt, damage, transfer, count, invoice, and reuse owners.
- Failure/reconciliation behavior: Anonymous, cross-company, unauthorized-shop, invalid membership, stale source/assignment, changed replay, concurrent claim/decision, catalog/position/serial drift, and unsupported custody action fail closed. Approval requests change no stock until approval. Held or damaged approved arrivals remain outside usable stock.
- Verification: Final 50-path manifest `4caf86fd…`; full unit gate 2,276 passed, 75 intentionally skipped, 0 failed; fresh disposable PostgreSQL receiving workflows 12/12; structure, production build, and diff checks passed. Authenticated 1440/820/390 task, no-PO approval, held/damaged truth, exact deep-link/reload, responsive, and cleanup journeys passed. Final independent review passed after replacing the remaining native stock-scope select with the shared Dropdown.
- Release evidence: Local working tree and local disposable/test database only. No commit, push, deployment, hosted mutation, accounting post, or Odoo write was authorized.
- Remaining gaps: Slice 7 owns blind transfer receiving, explicit source-bin allocation, discrepancy, return-to-source, and custody-drift reconciliation. Hosted and physical-device proof remain separate work.

### INV-20260919-06 — Transfer full cycle and canonical Inbound invoice history

- Status: LOCAL VERIFIED.
- Decision/requirement: Complete physical transfer custody without shortcutting source positions, destination put-away, discrepancies, or return evidence; make invoice intake part of the canonical Inbound queue rather than a parallel client-side list.
- After: Transfer dispatch requires exact source allocations for aggregate/measured stock or exact serialized identities, freezes tracking/UOM, and records in-transit holder/provenance. Destination receiving supports partial good put-away, damaged hold, shortage, unexpected goods, blind exact-unit scans, incremental recovery/loss, and physical return to an exact source position. Invoice processing, review, unmatched PO decision, added, and reversed history are projected and paginated server-side with one canonical row and truthful counts/status/actions. Invoice review fills the available Inventory workspace.
- Canonical owners: `inventory_stock_tasks` plus transfer discrepancy/event evidence; `InventoryStockTasks`; Inventory Tasks and Reports projections; `inventory-inbound.repo.js`; `InventoryInboundWorkspace`; existing invoice extraction, allocation, receipt, movement, exact-position, and serialized-custody records.
- Data/API changes: Migration 168 adds transfer state, frozen tracking, source allocations/provenance, blind-receiving, damage/loss/return totals, and discrepancy evidence. Inbound remains read-only and now includes extraction lifecycle rows directly; no invoice creates a purchase order.
- Failure/reconciliation behavior: Source-allocation mismatch, unsupported precision, reservation/custody drift, wrong-shop/system/ineligible positions, over-receipt, stale version, changed replay, concurrent commands, unauthorized scope, and invalid discrepancy transitions fail before partial stock/custody mutation. Shortage recovery distinguishes goods already present at the report from goods recovered later. Reversed receipts suppress duplicate unresolved-invoice rows.
- Verification: Frozen 23-file manifest `8d5ed63e…`; full unit gate 2,282 passed, 78 intentionally skipped, 0 failed; fresh disposable PostgreSQL receiving workflows 15/15; focused Inbound PostgreSQL and 64 affected contracts passed; structure, production build, and diff checks passed. Authenticated Inbound and transfer journeys passed at 1440×1000, 820×1180, and 390×844 with no overflow and zero fixture/account residue. Final independent review passed after four bounded correction classes.
- Release evidence: Local working tree and local disposable/test database only. No commit, push, deployment, hosted mutation, accounting post, or Odoo write was authorized.
- Remaining gaps: Slice 8 must separate removed-part physical receipt from inspection/release, require an exact reusable put-away position, define aggregate removal policy, and extend reuse/core reporting. Hosted and physical-device proof remain separate work.

### INV-20260919-07 — Exact installed-part removal and reuse custody

- Status: LOCAL VERIFIED.
- Decision/requirement: Keep Unit detail as the removal entry and the serialized reuse case as the custody owner; never make a removed part available before physical receipt, inspection, and exact put-away.
- After: Exact serialized removal retains unit, Workorder, installation, actor, reason, and invoice/batch lineage. Handoff, receipt, inspection, repair, hold, quarantine, core, scrap, and release are separate transitions. Release requires inspection evidence and an eligible exact position; core and scrap remain unavailable.
- Canonical owners: Unit inventory usage; inventory reuse case and events; exact-position balances/movements; Inventory Tasks and Reports projections.
- Failure/reconciliation behavior: Product module, company, shop, capability, version, identity, position, replay, and concurrent state are revalidated. Receipt cannot release stock, repair completion cannot bypass review, and exact release updates position, item, custody, movement, and audit evidence atomically.
- Verification: Focused contracts 47/47; serialized PostgreSQL lifecycle 17/17; authorization regression 7/7; build/diff pass; authenticated 1440/768/390 removal through exact release pass. An independent authorization finding was fixed and re-reviewed. Frozen fingerprint `465984a9…`.
- Release evidence: Local working tree and local test database only. No commit, push, deployment, hosted mutation, accounting post, or Odoo write was authorized.
- Remaining gaps: Hosted release and physical-device proof remain separate work.

### INV-20260919-08 — Reconciled Inventory reports and no-PO compliance evidence

- Status: LOCAL VERIFIED.
- Decision/requirement: Give Office/Admin one read-only report that reconciles operational inventory without creating a second accounting or stock owner.
- After: Reports compare shop stock with exact-position balances per part/UOM and expose bounded open PO, receipt/cost, task/exception, transfer, custody, bill, and cost-completeness evidence. Direct no-PO receipts plus unattached approval requests show shop, date, receiver, reason, decision/approver, vendor/amount when known, and a 12-month trend. Missing data remains Unknown.
- Canonical owners: Existing inventory items, position balances, purchase orders/deliveries, receipt lines, task assignments, transfer discrepancies, direct receipt approvals, reuse cases, supplier bills, and invoice extraction records. Reports are repeatable-read and read-only.
- Failure/reconciliation behavior: Company/shop and Office/Admin scope fail closed. Queries are bounded; UOM values are never combined; exports cover every loaded section and neutralize formula prefixes. Report links return to canonical Purchasing, Inbound, Tasks, custody, invoice, receipt, and Workorder owners.
- Verification: Focused report and adjacent contracts 34/34; real local PostgreSQL projection passed; full unit 2,295 pass/80 skip/0 fail; receiving PostgreSQL 15/15; reuse PostgreSQL 17/17; build/diff pass. Authenticated restarted-server browser checks passed at 1440×1000, 768×1024, and 390×844 with API success, refresh, keyboard, export, error, overflow, and cleanup coverage. Independent review findings were fixed and re-reviewed at frozen 11-file fingerprint `511cd72f…`.
- Release evidence: Local working tree and local test database only. No commit, push, deployment, hosted mutation, accounting post, or Odoo write was authorized.
- Remaining gaps: Hosted release, authenticated staging/production proof, and physical-device proof remain separate work.

### INV-20260919-09 — Unified Inventory local completion boundary

- Status: LOCAL VERIFIED; NOT RELEASED.
- Decision/requirement: Close the planned local Inventory slices only after full regression, PostgreSQL lifecycle, responsive browser, documentation, architecture, and data-integrity gates pass.
- After: Stock, Inbound, Purchasing, Tasks, Reports, physical counts, transfers, and exact serialized removal/custody/reuse share canonical records and tracking-appropriate lifecycle owners. Quantity and Measured/bulk use aggregate return/count correction owners; exact installed-part custody/removal/reuse remains Serialized-only.
- Verification: Full unit 2,295 pass/80 intentional skip/0 fail; disposable receiving PostgreSQL 15/15; final Reports browser 1440/768/390; build and diff checks; final independent architecture/data-integrity PASS with no remaining substantive findings.
- Release evidence: Localhost and local PostgreSQL only. No commit, push, deployment, hosted mutation, accounting post, or Odoo write was authorized.

### INV-20260921-01 — Realistic tracking-mode demo data

- Status: LOCAL VERIFIED; NOT RELEASED.
- Decision/requirement: Keep routine demo stock on quantity tracking, use exact identities only for serialized parts, and include a measured/bulk part with decimal stock.
- After: The existing-parts fixture contains 15 quantity placements, one `12.5 qt` measured/bulk placement, and one serialized fuel-pump placement with one physical identity. Fixture validation rejects missing tracking modes, serials on aggregate stock, missing serial identities, and catalog policy drift.
- Verification: 40 focused intake/tracking tests passed; idempotent PostgreSQL seed replay reconciled 17 stock placements, one serialized unit, five Workorders, five requests, and two usages; production build passed. Authenticated localhost UI showed `000628509` as `12.5 qt` and the Add inventory flow as `measured_bulk · qt`.
- Release evidence: Localhost and local PostgreSQL only. No commit, push, deployment, hosted mutation, accounting post, or Odoo write was authorized.

### INV-20260921-02 — Simplified daily price surface

- Status: LOCAL VERIFIED; NOT RELEASED.
- Decision/requirement: Keep current inventory pricing focused on purchase cost, internal price, and selling price; defer tax configuration until customer invoicing or jurisdiction-aware tax calculation is needed.
- After: Location pricing shows Latest purchase cost, Selling price, Internal price, Purchase history, and Price history. Price editing asks only for amount, currency, and reason. Tax status, calculators, tax-profile management, and the extra tax-profile API request are removed from the daily part panel. Existing tax tables and APIs remain dormant for future use.
- Verification: 14 focused pricing contracts passed; production build passed. A fresh authenticated localhost tab confirmed the Chino pricing panel contains the three routine price values, hides tax/calculation controls, and keeps only Amount, Currency, and Reason in the editor.
- Release evidence: Localhost only. No commit, push, deployment, hosted mutation, accounting post, or Odoo write was authorized.

### INV-20260921-03 — Compact part detail pages and location actions

- Status: LOCAL VERIFIED; NOT RELEASED.
- Decision/requirement: Keep the part drawer short enough for daily work and place stock-changing actions in the location that owns the stock.
- After: Part details are split into Stock, Prices, Activity, and Details pages, with only the selected page rendered. Stock keeps location drill-down and shelves/bins. Transfer, damage, and stock settings live in each location's three-dot menu; Add stock remains visible. Damage opens the existing task flow with the selected location already set.
- Verification: 31 focused frontend contracts passed; production build and diff checks passed. A fresh authenticated localhost tab confirmed all four pages, the compact selected-location view, and Chino Yard damage routing with Chino Yard preselected.
- Release evidence: Localhost only. No commit, push, deployment, hosted mutation, accounting post, or Odoo write was authorized.

### INV-20260921-04 — Daily-use part page hierarchy

- Status: LOCAL VERIFIED; NOT RELEASED.
- Decision/requirement: Make each part page answer one daily question without repeating provider data or forcing users through collapsed primary content.
- After: Stock leads with local on-hand, reserved, and available quantities, shows stocked locations first, and keeps empty locations under Other locations. Prices opens company or selected-location values immediately while purchase and price histories remain disclosures. Activity is a compact movement list with signed quantity, location, timestamp, retry, and collapsed receipt reference. Details shows tracking and unit while removing the redundant mapping explanation.
- Verification: Focused part-page contracts and production build passed. An authenticated localhost walkthrough confirmed all-location and Chino Yard Stock, Prices, Activity, and Details pages plus the Chino Yard location actions menu.
- Release evidence: Localhost only. No commit, push, deployment, hosted mutation, accounting post, or Odoo write was authorized.

### INV-20260921-05 — Inline selling and internal price editing

- Status: LOCAL VERIFIED; NOT RELEASED.
- Decision/requirement: Put the prices operators set most often before purchase evidence and remove the extra Change step.
- After: Selling price and Internal price are always-visible Amount and Currency forms at the top of company and location Prices pages. Save activates only after a valid change, posts through the existing versioned/idempotent endpoint, and creates a truthful routine audit reason without asking for an extra field. Latest purchase cost, Purchase history, and Price history remain below them.
- Verification: Focused price, model, and Inventory contracts passed; production build and diff checks passed. An authenticated localhost walkthrough confirmed company and Chino Yard inline fields, disabled unchanged state, changed-field enablement, selector behavior, and visual ordering without posting test data.
- Release evidence: Localhost only. No commit, push, deployment, hosted mutation, accounting post, or Odoo write was authorized.

### INV-20260921-06 — Direct-edit part details

- Status: LOCAL VERIFIED; NOT RELEASED.
- Decision/requirement: Make Details one compact editable form rather than a read-only summary followed by a separate edit mode.
- After: Part name, manufacturer, unit, and tracking are immediately editable. Local-only identity fields continue to appear when allowed. Optional reference numbers stay collapsed. The duplicate summary, Edit part step, provider explanation, tracking tutorial, unit hint, and reference instructions are removed. Reset and Save activate only after a change; dirty or saving forms cannot be dismissed or switched away accidentally.
- Verification: Focused identity, Inventory workspace, shared-control, route, and service checks passed; production build and diff checks passed. Authenticated localhost confirmed direct fields, unchanged disabled actions, dirty-state navigation/close protection, and Reset restoration without saving test data.
- Release evidence: Localhost only. No commit, push, deployment, hosted mutation, accounting post, or Odoo write was authorized.

### INV-20260921-07 — Compact part-header price

- Status: LOCAL VERIFIED; NOT RELEASED.
- Decision/requirement: Use the part header for the commercial value operators need and remove the redundant availability badge.
- After: The header shows the effective selling price and unit. All-locations view uses the company selling price; a selected location uses its override or company fallback. Unknown, loading, and failed reads stay compact. Stock availability remains in the Stock page metrics and location rows.
- Verification: Focused Inventory and commercial-model contracts, production build, diff checks, and authenticated localhost rendering passed. No pricing or stock data was changed during verification.
- Release evidence: Localhost only. No commit, push, deployment, hosted mutation, accounting post, or Odoo write was authorized.

### INV-20260921-08 — Chip-free stock availability

- Status: LOCAL VERIFIED; NOT RELEASED.
- Decision/requirement: Remove repetitive availability chips from part identity and let the availability column own stock state.
- After: Part rows keep only the part number and description in the identity cell. Available parts show quantity and stocked-location count. Fully reserved parts show zero available and the reserved quantity. Out-of-stock parts use explicit text with zero on hand. Low stock appears as restrained inline exception text. Filters, sorting, and accessible row labels retain the existing stock-state model.
- Verification: Focused Inventory workspace/model and compact-layout contracts, production build, diff checks, and authenticated localhost desktop rendering passed. Live data verified both available and out-of-stock rows; the current fixture has no fully reserved row.
- Release evidence: Localhost only. No commit, push, deployment, hosted mutation, accounting post, or Odoo write was authorized.

### INV-20260921-09 — Low-stock-first sorting

- Status: LOCAL VERIFIED; NOT RELEASED.
- Decision/requirement: Let operators bring replenishment exceptions to the top without changing the current availability filters.
- After: Stock Sort includes Low stock first. The server orders unresolved replenishment alerts before pagination, with the least available alert first; remaining parts retain most-available ordering and stable part-number tie breaking. Existing sorts, filters, scope, counts, and pagination remain unchanged.
- Verification: Focused UI, model, schema, service, route, and repository contracts, production build, diff checks, and authenticated localhost selection passed.
- Release evidence: Localhost only. No commit, push, deployment, hosted mutation, accounting post, or Odoo write was authorized.

### INV-20260921-10 — Chino shop-manager opening inventory

- Status: LOCAL VERIFIED WITH ODOO READ BLOCKED; NOT RELEASED.
- Decision/requirement: Replace the realistic test fixture with the Chino manager's cp1252 CSV while preserving non-demo local stock, matching exact catalog identities, and retaining position and movement evidence.
- After: Chino has a Shop → Aisle → Shelf → Bin hierarchy derived from 1,162 source rows. Source coordinates such as `A1-B2-S3` are normalized to `A1 / Shelf 3 / Bin 2`. The local hierarchy repair preserved all 1,148 balance rows and their 6,429-unit current total while retaining the existing stocked leaf IDs; no count or quantity correction was applied. The import reused 465 Odoo-mapped catalog parts, created 651 local identities, and stocked 1,115 positive-quantity parts across 1,148 placements. Seven source rows without part numbers received reported local identifiers. Three prior non-demo local items remain. The realistic fixture's 17 items, four receipts, five Workorders, two usages, and old positions were removed.
- Odoo evidence: Cached local projections contain 11,148 Odoo service orders and 13,059 part-history occurrences; 200 imported stocked parts have 2,560 linked occurrences. Direct current-price and purchase-history reads are blocked because the configured Odoo TLS chain is not trusted. No TLS bypass was used, no price was invented, and Odoo was not mutated.
- Verification: Import/parser tests 4/4 and combined focused tests 28/28 passed; structure and production build passed. The database reconciled item and position quantities at 6,434, rejected identical-file replay, and reported zero remaining fixture items/Workorders. Authenticated localhost showed 1,118 available parts including the three preserved local items and the imported Shop hierarchy.
- Recovery evidence: Pre-import PostgreSQL dump `/Users/karanpreetsingh/.codex/backups/workorder-generator/20260921-chino-manager-import-before.dump`, SHA-256 `65dc49d6dce823d5cea64c47388f93967c7e46afa524b1e706b9355488618cbc`.
- Release evidence: Localhost and local PostgreSQL only. No commit, push, deployment, hosted mutation, accounting post, or Odoo write was authorized.

### INV-20260921-11 — Odoo purchase-order price history and compact location browsing

- Status: LOCAL VERIFIED WITH LIVE ODOO READ BLOCKED; NOT RELEASED.
- Decision/requirement: Use confirmed Odoo purchase orders as read-only commercial evidence for mapped parts while local Inventory remains the stock and quantity authority.
- After: Catalog synchronization queues a company-scoped purchase-history snapshot. Confirmed Odoo purchase orders and their lines are retained idempotently, including unmapped product lines for later reconciliation. Mapped part Prices pages show order date, PO/vendor, ordered and received quantities, unit price, and currency; the latest Odoo PO price is a fallback only when no confirmed local receipt cost exists. By-location browsing uses natural numeric hierarchy order, compact cumulative placement codes, and independent viewport-height tree and stock-list scrolling.
- Authority and failure behavior: The integration filters by the authenticated Odoo user's active company, reads only `purchase` and `done` orders, never writes Odoo, and never changes local inventory balances. Missing product mappings remain visible in the snapshot without fabricating a local part. Provider connection failure leaves the last local snapshot unchanged and records the failed sync.
- Verification: Focused UI, Odoo service/adapter, repository contract, and real PostgreSQL reconciliation tests passed; structure, production build, diff checks, and authenticated localhost location browsing passed. A live read was attempted and the configured Odoo endpoint refused the connection, so no current Odoo PO rows were imported and no TLS bypass was used.
- Release evidence: Localhost and local PostgreSQL only. No commit, push, deployment, hosted mutation, accounting post, or Odoo write was authorized.

### INV-20260921-12 — Location-first stock entry and explicit physical counts

- Status: LOCAL VERIFIED; NOT RELEASED.
- Decision/requirement: Keep new arrivals, starting balances, and physical corrections visibly separate while allowing operators to act from the location they are already reviewing.
- Before: Stock exposed one Add inventory dialog that also offered physical-count and starting-inventory handoffs. The physical-count editor was always expanded below location stock, and a part physically found after count start could not be added without leaving the count.
- After: Stock exposes separate Add stock and Starting inventory actions. Each stock-holding location exposes Add stock here; that contextual flow fixes the selected shop and exact storage destination, removes the redundant shop selector, and shows the destination read-only. System Receiving keeps the server-owned implicit destination. The global Add stock action remains flexible. Physical count is a collapsed Start/Resume workspace with Back to stock. An existing quantity or measured/bulk catalog part missing from the count snapshot can be recorded as an expected-zero found line. Serialized finds route to exact-identity Add stock or Starting inventory instead of fabricating identities.
- Canonical owners: `InventoryWorkspace`; `InventoryLocationStockWorkspace`; `AddInventoryStockDialog`; `PositionCountPanel`; inventory-position schema/service/repository; migration 171.
- Data/API changes: `POST /api/office/inventory/position-counts/:id/found-parts` adds one versioned, idempotent found line under current company/shop/count scope. Migration 171 distinguishes snapshot and found lines and extends count command evidence with `add_found`.
- Authorization/security changes: Existing Office/Admin count-entry scope remains; only Admin can apply corrections. Catalog version, tracking mode, UOM precision, duplicate line, count version, position movement watermark, tenant, and shop scope are revalidated server-side.
- Failure/reconciliation behavior: Found stock applies as an `adjustment` movement plus item and exact-position balance update. It never creates a purchase order, invoice, or receipt. Stale or concurrent stock produces retry/recount behavior. Direct arrivals retain the canonical direct-receipt/no-PO approval path; opening inventory retains the reviewed count-sheet path.
- Verification: Focused UI, route, service, migration, and repository contracts passed 46/46; the full unit suite passed 2,314 tests with 82 skipped and zero failures; fresh migrated PostgreSQL position tests passed 10/10, including zero purchase/receipt rows for a found-part correction. Structure, syntax, production build, diff, and live/ready health checks passed. Authenticated localhost physical-count journeys passed at 1440×1000, 820×1180, and 390×844 with keyboard navigation, found-part controls, recount/reload, no overflow, and complete fixture/account cleanup. A live Admin walkthrough confirmed Stock actions, contextual Add stock here, the collapsed count launcher, and found-part entry.
- Release evidence: Localhost and local disposable/test PostgreSQL only. No commit, push, deployment, hosted mutation, accounting post, or Odoo write was authorized.
- Remaining gaps: Hosted and physical-device proof remain separate work. Exact serialized finds still require receipt or reviewed starting-inventory identity evidence by design.

### INV-20260922-01 — Quantity-part Workorder lineage in stock activity

- Status: LOCAL VERIFIED; NOT RELEASED.
- Decision/requirement: A quantity or measured/bulk reservation changes availability immediately, but it must not decrement on-hand or create a stock issue until Office approval. Once consumed, part Activity must show the Workorder and unit where the stock was used.
- After: The existing append-only issue movement remains the history owner and now projects its linked Workorder number, unit, and repair order into part Activity. The Workorder/unit label links back to the canonical Workorder. Receipt and non-Workorder movement rows remain unchanged.
- Canonical owners: `workorder_aggregate_part_usages` owns reserve-to-consume state; `inventory_items` and exact-position balances own on-hand/reserved quantities; `inventory_stock_movements` owns finalized stock history; part Activity is a read projection only.
- Verification: Live local data for part `180.10641.1` on G2021 proved one 2 ea reservation, one pending transition, one consumption, one -2 issue movement, and stock changing from 287 to 285 with zero remaining reserved. Focused PostgreSQL lifecycle tests proved reservation keeps on-hand stable while reducing availability and approval consumes exactly once. Authenticated localhost showed `-2 ea`, `G2021 · WO-000204`, Chino Yard, timestamp, and repair order in part Activity; the link reopened the correct Workorder.
- Release evidence: Localhost and local PostgreSQL only. No commit, push, deployment, hosted mutation, accounting post, or Odoo write was authorized.

### INV-20260922-02 — Tracking-aware shop history and scoped audit log

- Status: LOCAL VERIFIED; NOT RELEASED.
- Decision/requirement: Quantity and measured/bulk parts use a compact shop summary plus Workorder usage; serialized parts retain exact-unit inspection. The full movement history is named Audit log and must state its current shop/company scope.
- After: Opening a quantity or measured/bulk shop shows on-hand, reserved, available, storage/actions, and a server-filtered Used on Workorders list with quantity/UOM, unit/Workorder, repair order, and date. Serialized shops retain individual-unit controls and share the audit handoff. View full audit log preserves the selected shop; Show all locations restores company-wide scope.
- Canonical owners: `inventory_stock_movements` remains the single append-only history owner. The `workorder` query is a read projection filtered by `workorder_id`; it creates no new consumption or duplicate history.
- Tracking behavior: Quantity and measured/bulk share aggregate presentation, including decimal canonical UOM for bulk. Serialized remains identity-first. The default movement API remains the full audit projection for compatibility.
- Verification: Focused route/service/UI contracts passed 76/76 with one intentional legacy skip; real PostgreSQL aggregate lifecycle and Workorder-only movement projection passed 3/3; the full local unit suite passed 2,318 tests with 82 skipped and zero failures. Structure, syntax, production build, diff, live/ready health, and authenticated localhost checks passed. Rendered checks proved quantity usage for `180.10641.1` at Chino Yard (`-2 ea`, G2021, WO-000204, repair order and date), the shop-filtered and company-wide audit scopes, measured/bulk shop structure for `000628509` in `qt`, and serialized exact-unit structure plus audit handoff for `FUEL PUMP`.
- Release evidence: Local changes only. No commit, push, deployment, hosted mutation, accounting post, or Odoo write was authorized.

### INV-20260922-03 — Observation-only inline physical counts

- Status: LOCAL VERIFIED; NOT RELEASED.
- Decision/requirement: Make routine counts a fast exact-location observation workflow. Counters must sit with each part, require no operator reason, preserve a blind start-of-count snapshot, and never change inventory merely because the count was finished.
- Before: The physical-count editor repeated the stock list below the location view and combined observation with an Admin-only apply form and required reason. Count discrepancies were not projected as a separate review task.
- After: Starting or resuming a count replaces the location stock list with compact inline counters, progress, Next uncounted, autosave, found-part entry, and exact serialized identity confirmation. Blank remains uncounted rather than zero. Finish count records a submitted snapshot: an even count verifies without stock mutation; a difference becomes Submitted for review. Only the separate Admin Reconcile inventory action writes compensating stock evidence, using a server-generated reason. The selected shop header in Part details now sits directly beside Back while the location actions menu remains at the far right.
- Canonical owners: `inventory_position_count_sessions` and count lines own observation evidence; `inventory_position_balances`, `inventory_items`, and `inventory_stock_movements` remain the stock owners; `InventoryLocationStockWorkspace` and `PositionCountPanel` own the daily count surface; Inventory Tasks owns discrepancy review projection.
- Data/API changes: Migration 172 adds submitter evidence, one-active-count uniqueness per company and exact position, ready-count archive protection, and the `submit` command kind. `POST /api/office/inventory/position-counts/:id/submit` freezes and validates the observed session. Existing apply remains a distinct Admin-only command and accepts no user-authored reason.
- Authorization/security changes: Office and Admin can enter and submit counts within existing company/location scope. Only Admin can reconcile a submitted difference. Tenant, exact-position, optimistic version, idempotency, UOM precision, serialized identity, movement watermark, and custody checks remain server-owned.
- Failure/reconciliation behavior: Stock movement, a new uncounted balance, or serialized custody drift after count start changes the session to Needs recount without mutating stock. A discrepancy stays observation-only until Admin review. A matching count records verification evidence without fabricating a movement.
- Verification: Focused API/UI contracts passed 61/61; real PostgreSQL position tests passed 10/10; the full unit suite passed 2,406 tests with 82 skipped and zero failures. Syntax, structure, and production build passed. Authenticated fresh browser journeys passed at 1440×1000, 820×1180, and 390×844, proving blind inline counting, exact serialized entry, observation-only submission, recount behavior, Admin reconciliation, reload/resume, no horizontal overflow, and the inline Back/location/actions header geometry. Disposable fixtures and QA accounts were completely removed.
- Release evidence: Localhost and local PostgreSQL only. No commit, push, deployment, hosted mutation, accounting post, or Odoo write was authorized.
- Remaining gaps: Hosted and physical-device proof remain separate work. Submitted count review currently uses the shared Inventory task queue rather than a dedicated counts dashboard.

### INV-20260922-04 — Discoverable physical-count entry points

- Status: LOCAL VERIFIED; NOT RELEASED.
- Decision/requirement: Keep daily Stock actions focused while making physical counting visible and moving setup-only starting inventory to its proper task owner.
- After: Stock removes both setup-only Starting inventory and global Physical count from the daily header. The operator opens By location and drills through the canonical Aisle → Shelf → Bin tree; only the final active stock-holding child exposes Physical count. This prevents a broad parent count from being mistaken for an exact physical count. Tasks still exposes Physical counts and setup/migration import; its location handoff opens the same By location owner. The dedicated import workspace is titled Starting inventory.
- Canonical owners: `InventoryWorkspace` owns Inventory navigation and URL state; `InventoryStockTasks` owns the Physical counts landing page; `InventoryCountImportPanel` remains the existing XLSX import owner.
- Data/API changes: None.
- Verification: Focused Inventory/location/import/service contracts passed 60/60; real PostgreSQL position tests passed 10/10; production build passed. The local Chino repair converted 113 stocked leaves, removed 26 empty legacy grouping nodes, and preserved all 1,148 balance rows, their 6,429-unit total, and 10 serialized units. Authenticated browser journeys at 1440×1000, 820×1180, and 390×844 proved that parent locations omit Physical count, final bins expose it, Tasks retains the setup import handoff, and the complete observation/reconciliation workflow still works. The actual Chino UI was also reloaded and verified as Aisle → Shelf → Bin. Disposable fixtures and QA accounts were removed.
- Release evidence: Local changes only. No commit, push, deployment, hosted mutation, accounting post, or Odoo write was authorized.

### INV-20260924-01 — Selective inline physical counts

- Status: LOCAL VERIFIED; NOT RELEASED.
- Decision/requirement: A routine physical count may cover one, two, or any chosen subset of parts in an exact storage location. An untouched part is outside the count and must never be interpreted as zero.
- After: Physical count keeps the existing location stock-card geometry. Only the row the operator activates exposes a blank quantity field with explicit save and cancel controls. A saved row collapses to Counted, On hand, and Variance; reopening it and pressing the existing cancel control resets Counted to the count-start On hand snapshot and saves a zero variance. The header exposes Exit count and Review count; review lists only selected parts and states that untouched parts remain unchanged. Office submits differences for Admin review. Admin can explicitly apply the reviewed selected differences. Matching selected observations record verification evidence without creating stock movement.
- Canonical owners: A persisted non-null count-line observation is the durable selection boundary. `inventory_position_count_sessions` and count evidence remain observation owners; `inventory_position_balances`, `inventory_items`, and `inventory_stock_movements` remain quantity/history owners.
- Safety behavior: Submit and apply lock, validate, and mutate only selected aggregate lines and selected serialized identity groups. Null aggregate observations are excluded rather than coerced to zero. Movement or version drift for a selected part requires recount; activity on an untouched part does not invalidate or enter the selective count. Selected serialized parts still require every snapshotted identity to be confirmed.
- Cleanup: The replacement removes the full-list counter workspace, count-all progress, Next uncounted, Finish count, blur autosave, duplicated found-part surface, and their unused styles. Add stock and Starting inventory remain the canonical workflows for goods not already represented at the location.
- Verification: Focused UI/API contracts passed 49/49; real PostgreSQL position/count tests passed 10/10; the full local unit suite passed 2,336 tests with 84 skipped and zero failures; structure, syntax, production build, and diff checks passed. A fresh authenticated browser run at 1440×1000, 820×1180, and 390×844 proved single-row activation, Counted/On hand/Variance summaries, review of one selected part, untouched serialized stock, selected-part recount after movement, Admin apply, no horizontal overflow, and complete fixture/account cleanup.
- Release evidence: Local changes only. No commit, push, deployment, hosted mutation, accounting post, or Odoo write was authorized.

### INV-20260922-05 — Odoo commercial catalog and labor pricing snapshots

- Status: IMPLEMENTED LOCALLY; NOT RELEASED.
- Decision/requirement: Import the Odoo commercial facts needed to price every mapped inventory part and retain equivalent price evidence for copied labor products without allowing provider synchronization to overwrite application-owned pricing decisions.
- After: Catalog synchronization introspects and reads supported `standard_price`, `lst_price`/`list_price`, cost/selling currency and provider timestamps. Mapped parts expose labeled Odoo internal and selling references; selling price becomes a fallback only when no local company/location price version exists. Existing local versions, including explicit Unknown, continue to win. Previously copied and newly imported hourly labor products retain stable Odoo service-product linkage and refresh current provider prices; Office/Admin searches see the Odoo selling rate while mechanic responses redact commercial and external-provider facts.
- Canonical owners: `odoo_product_mappings` and `odoo_service_products` own current provider snapshots; `inventory_part_price_versions` owns local decisions; confirmed receipt lines and `odoo_purchase_history_lines` remain distinct purchase-cost evidence; `local_labor_products` owns local labor identity and pins.
- Data/API changes: Additive migration `173_odoo_commercial_catalog.sql`; part commercial reads add `odooPrices`; pricing preview may use a known Odoo fallback with tax explicitly not configured; labor list rows may add authorized `source` and `odooPricing` facts. Zero remains known; missing or invalid currency remains Unknown.
- Authorization/security changes: Existing Inventory cost permission protects part commercial reads. Labor commercial facts are returned only to Office/Admin; mechanic selection remains price-redacted. Every provider query and join remains company-scoped.
- Failure/reconciliation behavior: Unsupported Odoo fields are omitted through field introspection. Sync writes null/Unknown provider facts rather than inventing prices. Reconciliation is idempotent by company and external product ID and performs no Odoo or inventory-quantity write. Rollback uses the prior application version; additive snapshot columns remain inert.
- Verification: Focused PostgreSQL/integration tests passed, including populated-database migration rehearsal, current-price reconciliation, stable labor linkage after an Odoo rename, and role redaction. The full unit suite passed 2,329 with 83 intentional skips and zero failures; structure checks and the production build passed. Authenticated local browser proof confirmed Odoo internal/selling references, selling-price fallback, zero local price-history writes from viewing, and local-price precedence while retaining the provider reference. A skeptical single-agent review (required by the no-delegation constraint) found and fixed the renamed-labor refresh edge case. Live Odoo import remains pending because no provider mutation or hosted synchronization was authorized.
- Release evidence: None. No commit, push, hosted migration, deployment, Odoo mutation, or production data mutation was authorized.

### INV-20260922-06 — Invoice Intake current-page navigation and review scrolling

- Status: IMPLEMENTED LOCALLY; NOT RELEASED.
- Decision/requirement: Keep Invoice Intake inside the current Inventory surface, open the exact selected invoice from Inventory-owned route state, and let long desktop reviews scroll without clipping editor fields.
- Before: The bounded desktop review rail allowed CSS grid rows to shrink to the fixed rail height, producing no scroll range while expanded line editors were clipped. Saved-run loading reread `window.location` only when the review component mounted instead of receiving the current Inventory selection as state.
- After: The review rail uses natural-height grid rows inside its existing bounded vertical scroller. `InventoryWorkspace` owns `invoiceRunId`, passes it into Invoice Intake, and updates it whenever an Inventory handoff opens an invoice. Invoice history opens the selected run in the same mounted workspace and updates the same canonical Inventory URL. Existing extraction detail, source, review, re-extraction, and receipt endpoints remain unchanged; legacy invoice links still canonicalize to Inventory.
- Canonical owners: `InventoryWorkspace.jsx`; `InvoiceExtractionWorkspace.jsx`; `invoice-extraction.css`.
- Data/API changes: None.
- Verification: Focused Invoice Intake, Inventory, and legacy Admin navigation contracts passed 68/68; the production build passed. Authenticated fresh-build localhost proof opened two different saved invoices inside the current Inventory URL. A long desktop review rail measured 570 px visible height against 1,145 px scroll height, then scrolled to reveal previously clipped Unit, Unit price, Line total, Remove line, and later review sections. Diff and final review evidence are recorded in the external task report.
- Release evidence: Local changes only. No commit, push, deployment, hosted mutation, database schema change, or Odoo write was authorized.

### INV-20260923-01 — Invoice financial offsets and visible line removal

- Status: RELEASED TO GIT STAGING; HOSTED DEPLOYMENT NOT VERIFIED.
- Decision/requirement: A same-part invoice charge and credit that exactly offset in quantity and money are financial evidence, not a physical stock receipt. Keep both lines visible while preventing either line from creating, subtracting, or blocking inventory. Make removal of an incorrect extracted line discoverable before approval.
- Before: Reviewed receipt preparation rejected the whole invoice when any extracted line had a negative quantity. The positive half of a core charge/credit pair could still appear receivable, while Remove line was available only at the bottom of an expanded editor.
- After: An exact same-part, same-UOM pair with opposite non-zero quantity and line total is classified as a financial offset. Both lines remain in reviewed invoice evidence, show No stock in review and Financial offset in delivery, have zero outstanding stock, are excluded from Receive all and receipt payloads, and are rejected by the server if a crafted receipt targets either line. Other positive lines continue through normal tracking, PO allocation, and physical receipt. Editable rows expose a 44 px Remove action with confirmation; approved invoice history remains immutable.
- Canonical owners: `shared/invoice-inventory-lines.js`; invoice purchase-allocation repository; local invoice receipt service; `InvoiceExtractionWorkspace`; shared receipt-line model/editor.
- Data/API changes: Additive response metadata only: receipt suggestion lines may include `inventoryDisposition: financial_offset` and `offsetLineIndex`. No migration or provider write.
- Verification: Shared classification, client receipt, server receipt-defense, Invoice Intake, and Inventory tests passed; structure and production build passed. The actual local invoice `3047165133` retained the original three extracted lines while its approved reviewed draft contains only the physical `E74-1119:PEC` line, confirming the source evidence was not rewritten by prior review removal.
- Release evidence: Implementation and tests were committed and pushed to `origin/staging`. Git parity was verified after push. Hosted staging deployment and authenticated hosted behavior remain separate and were not claimed.
