# Odoo Inventory And Workorder Parts — Living Record

**Status:** Canonical current-state record<br>
**Last verified:** 2026-08-26<br>
**Verified against:** local working tree at base commit `9172846dfb05de4a9901672b1db0001041f1f045`<br>
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
transfer execution, purchasing, general cycle counts, valuation, warranty/problem
reporting, cores, or a dedicated Parts role.

### Capability matrix

| Capability | State | Current owner/evidence | Meaning |
|---|---|---|---|
| Company part catalog | IMPLEMENTED | `parts_catalog`; `part_reference_numbers`; catalog/inventory repositories | Company-scoped part search and audited Office/Admin editing. Odoo-managed identity fields remain provider-owned. |
| Odoo location discovery/mapping | IMPLEMENTED | `src/server/db/migrations/042_odoo_inventory_sync.sql`; `odoo.admin.service.js` | Admin maps Odoo internal locations to app locations. |
| Odoo product mapping | IMPLEMENTED | migrations `043` and `059` | Stable `product.product` mapping; explicit workorder-line choice when duplicate Odoo products map to one catalog part. |
| Odoo inventory read sync | IMPLEMENTED, AGGREGATE ONLY | `syncOdooPartsAndInventory`; `importOdooInventory` | Reads active products and internal `stock.quant` balances, then projects aggregated availability locally. |
| Lot/serial/package projection | PARTIAL, LOCAL AND ODOO RECEIPTS VERIFIED | `inventory_serialized_units`; migrations `064` and `066`; local and Odoo receipt repositories | Whole count/package local receipts and Odoo serialized receipts preserve exact unit identities in one canonical table. Measured local quantities remain aggregate; general lot/package lifecycle is still absent. |
| Mechanic part request | IMPLEMENTED | mechanic parts route, `MechanicPartRequestForm.jsx` | Mechanic submits structured request inside a workorder. |
| Office review and supply recommendation | PARTIAL, LOCAL VERIFIED | `part-fulfillment.service.js`; `OfficeRequestCard.jsx`; `GetPartsFlow.jsx` | Office can ask the backend for a location-scoped local-stock recommendation and approve that recommendation. Approval is audit evidence only; it does not reserve or move stock. Legacy aggregate allocation remains separate. |
| Local issue/return quantity updates | IMPLEMENTED, TEMPORARY ARCHITECTURE | `part-requests.repo.js` | Reserved→issued decrements local balance; issued→returned increments it. No Odoo stock command is made. |
| Serialized-part workorder disposition | PARTIAL, EXACT-UNIT LOCAL VERIFIED | `SerializedPartsScanner.jsx`; `inventory-unit-workorder.service.js`; migration `087` | Exact local units move through reserved → installed pending approval → installed. Reservation affects reserved/available only; Office approval consumes on-hand. A pre-approval removal explicitly returns the unit and releases the reservation; a post-approval removal records used-part history without restoring stock. Mechanics remain denied by default and require an explicit Part scanning grant plus active assignment. Damaged/quarantine/core workflows remain absent. |
| Workorder completion guard | PARTIAL, EXACT-UNIT LOCAL VERIFIED | operational workorder repository lifecycle guards | Work done continues to block unresolved reserved units but accepts an explicitly installed-pending-approval unit. Office close consumes every pending installed unit in the same transaction and records approval evidence. Cancel, reassignment, and self-release fail closed while exact reservations remain active. Legacy aggregate requests retain their existing guards. |
| Odoo service-order export | IMPLEMENTED, SEPARATE DOMAIN | `odoo.outbound.*`; migrations `048`, `056`, `059` | Creates a draft Odoo Sales service order after readiness checks. It intentionally does not confirm orders, create invoices, post payments, or mutate stock. |
| Dedicated Parts role and permissions | PARTIAL | shared `partsScanning` module policy; Admin Modules | Roles remain mechanic, office, surveillance, and admin. Exact workorder scan/issue has a dedicated role/named-user module permission; a standalone Parts role and broader inventory permission family remain absent. |
| Parts inventory workspace | PARTIAL, LOCAL VERIFIED | `InventoryWorkspace.jsx`; Admin and Office navigation | Inventory is stock-only. Invoice upload, review, receipt actions, and receipt-enriched history are progressively grouped in Invoice Intake. Dedicated Parts role, movements UI, receiving tasks, and warehouse exception queues remain absent. |
| Invoice/receiving documents | LOCAL FULL-DELIVERY VERIFIED; ODOO COMPATIBILITY RETAINED | `PhysicalReceiptConfirmation.jsx`; local receipt service/repository; `POST /api/office/invoice-extractions/:runId/confirm-receipt` | Reviewed invoices require explicit complete-delivery confirmation before atomic local posting. Eligible discrete lines create exact identities and a durable label batch. Mismatch/damage is a no-write stop with truthful guidance; partial/damaged posting and PO matching remain absent. |
| Scanner and secure QR resolution | PARTIAL, LOCAL VERIFIED | `inventory-qr.js`; canonical workorder inventory-unit routes; `InventoryScanWorkspace.jsx`; `SerializedPartsScanner.jsx` | Authenticated-encrypted QR tokens resolve one exact unit under authenticated company/location scope. Office Parts progressively exposes one compact scan action, exact-unit confirmation, atomic issue, and installed/returned dispositions. Mechanics are off by default and can be granted narrowly in Modules. Bin/pick, bulk, transfer, and dedicated Parts-role scanning remain absent. |
| Label jobs/printing | PARTIAL, DURABLE BATCH VERIFIED | `inventory_label_batches`; label repository/routes; `GET /api/office/inventory/receipts/:receiptId/labels`; QR SVG route | Full delivery creates a durable immutable batch and a bounded on-screen preview with a complete print-batch link. Printer delivery status, configurable templates, and putaway completion remain absent. |
| Opening inventory import | IMPLEMENTED, LOCAL VERIFIED | migrations `071`–`073`; `inventory-count-imports.*`; `InventoryCountImportPanel.jsx` | A bounded XLSX upload creates a durable review draft, exact-matches company master parts, isolates duplicates/unmatched/invalid quantities, and requires physical-count attestation before replacing an unreserved provider projection or creating local serialized stock and printable label batches. General cycle-count correction remains absent. |
| Core obligations and disposition | NOT IMPLEMENTED | No core tables, routes, service, or UI. | Removed core cannot be linked durably to replacement part and vendor credit. |
| Provider command outbox/reconciliation | PARTIAL, RECEIPTS ONLY | `inventory_provider_commands`; `inventory-receiving.service.js` | Receipt commands persist pending/processing/succeeded/reconciliation-required state and reject key/hash conflicts. Transfers, issues, returns, and operator reconciliation UI remain absent. |

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
  -> reads product.product
  -> reads internal stock.quant
  -> importOdooInventory(companyId, { products, quants })
  -> upserts catalog/product mappings
  -> aggregates mapped balances into inventory_items
  -> separately imports service history
```

Current product fields: ID, SKU/default code, barcode, name, category, UOM, and provider update time.

Current quant fields: quant ID, product, internal location, quantity, reserved quantity, and provider update time.

Aggregation collapses provider stock into catalog part + mapped app location + UOM. Quant ID is fetched but is not preserved or used as physical-item identity. Lot/serial/package identity and exact Odoo bin remain unavailable.

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
