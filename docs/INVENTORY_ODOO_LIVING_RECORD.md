# Odoo Inventory And Workorder Parts — Living Record

**Status:** Canonical current-state record<br>
**Last verified:** 2026-08-25<br>
**Verified against:** local task patch based on `main` at `2443dcaac1418dbf80d3dafc80256f7f8a2c3dfb` (release evidence pending)<br>
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

The repository now has one narrow, end-to-end receiving identity slice on top of the existing Odoo/catalog/workorder-parts foundation.

A reviewed invoice can create an idempotent Odoo incoming receipt for products already configured as serial-tracked, persist one exact local unit per confirmed Odoo lot/serial, produce authenticated-encrypted QR labels, and resolve a scan under authenticated company/location scope. This does not yet implement physical count/condition confirmation, putaway, issuing/installing, cores, or a dedicated Parts role.

### Capability matrix

| Capability | State | Current owner/evidence | Meaning |
|---|---|---|---|
| Company part catalog | IMPLEMENTED | `parts_catalog`; `src/server/db/repositories/parts-catalog.repo.js` | Company-scoped part search with Odoo identity/barcode candidates and optional location availability. |
| Odoo location discovery/mapping | IMPLEMENTED | `src/server/db/migrations/042_odoo_inventory_sync.sql`; `odoo.admin.service.js` | Admin maps Odoo internal locations to app locations. |
| Odoo product mapping | IMPLEMENTED | migrations `043` and `059` | Stable `product.product` mapping; explicit workorder-line choice when duplicate Odoo products map to one catalog part. |
| Odoo inventory read sync | IMPLEMENTED, AGGREGATE ONLY | `syncOdooPartsAndInventory`; `importOdooInventory` | Reads active products and internal `stock.quant` balances, then projects aggregated availability locally. |
| Lot/serial/package projection | PARTIAL, RECEIPTS ONLY | `inventory_serialized_units`; `inventory-receipts.repo.js`; `odoo.receipts.js` | Exact serial identity is preserved for units created by the reviewed-invoice receipt slice. General Odoo lot/package sync remains unimplemented. |
| Mechanic part request | IMPLEMENTED | mechanic parts route, `MechanicPartRequestForm.jsx` | Mechanic submits structured request inside a workorder. |
| Office review and supply allocation | IMPLEMENTED | Office parts routes and `OfficeRequestCard.jsx` | Office can approve, ask, reject, choose supply source, reserve aggregate local inventory, and update allocation status. |
| Local issue/return quantity updates | IMPLEMENTED, TEMPORARY ARCHITECTURE | `part-requests.repo.js` | Reserved→issued decrements local balance; issued→returned increments it. No Odoo stock command is made. |
| Mechanic usage disposition | IMPLEMENTED, MANUAL | `MechanicRequestCard.jsx`; `updatePartUsage` | Approved request can be marked not issued, issued, partially installed, installed, not used, returned, or damaged. Not tied to an exact scanned identity. |
| Workorder completion guard | PARTIAL | `closeOperationalWorkorder` | Blocks Office approval for submitted/needs-info requests. Does not block every issued item lacking final disposition. |
| Odoo service-order export | IMPLEMENTED, SEPARATE DOMAIN | `odoo.outbound.*`; migrations `048`, `056`, `059` | Creates a draft Odoo Sales service order after readiness checks. It intentionally does not confirm orders, create invoices, post payments, or mutate stock. |
| Dedicated Parts role and permissions | NOT IMPLEMENTED | `src/server/auth/roles.js`; `permissions.js` | Roles remain mechanic, office, surveillance, and admin. No inventory permission family exists. |
| Parts inventory workspace | NOT IMPLEMENTED | Current UI is workorder-scoped shared Parts section plus Admin integration settings. | No Today, Scan, Stock, or History workspace exists for Parts users. |
| Invoice/receiving documents | PARTIAL, LOCAL VERIFIED | `inventory_receipts`; `inventory_receipt_lines`; `inventory_provider_commands`; `POST /api/office/invoice-extractions/:runId/receive` | Reviewed invoices can create one idempotent Odoo receipt and become confirmed only after the provider picking is `done`. Physical count/condition and PO matching are still absent. |
| Scanner and secure QR resolution | PARTIAL, LOCAL VERIFIED | `inventory-qr.js`; `POST /api/inventory/resolve`; `InventoryScanWorkspace.jsx` | Authenticated-encrypted QR tokens resolve one exact unit under authenticated company/location scope, with camera and manual-entry surfaces. Bin/pick/issue scanning remains absent. |
| Label jobs/printing | PARTIAL, LOCAL VERIFIED | `GET /api/office/inventory/receipts/:receiptId/labels`; `GET /api/office/inventory/units/:unitId/qr.svg`; invoice review label grid | Confirmed receipt units render printable QR labels. Durable printer jobs, templates, and putaway completion remain absent. |
| Core obligations and disposition | NOT IMPLEMENTED | No core tables, routes, service, or UI. | Removed core cannot be linked durably to replacement part and vendor credit. |
| Provider command outbox/reconciliation | PARTIAL, RECEIPTS ONLY | `inventory_provider_commands`; `inventory-receiving.service.js` | Receipt commands persist pending/processing/succeeded/reconciliation-required state and reject key/hash conflicts. Transfers, issues, returns, and operator reconciliation UI remain absent. |

## Current Architecture

### 1. Durable data

#### Aggregate catalog and availability

- `parts_catalog` stores one canonical company part per normalized part number.
- `odoo_product_mappings` preserves stable Odoo `product.product` identities independently of mutable SKU text.
- `odoo_inventory_locations` preserves Odoo stock-location identity and explicit app-location mapping status.
- `inventory_items` stores one aggregate balance per company, app location, normalized part, and unit of measure.
- `v_inventory_availability` calculates available quantity as on-hand minus reserved.
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

### P0 architecture gap — two-ledger risk

Odoo is the intended inventory authority, but current issue/return transitions mutate `inventory_items` directly. Before production Odoo write integration, replace quantity-changing local success with idempotent Odoo commands and confirmed/reconciled provider results. Keep `inventory_items` read-only projection/compatibility data.

### P0 traceability gap — no exact physical identity

Current projection cannot answer which serial, lot, package, or physical unit was received, picked, issued, installed, returned, or scrapped. A QR scanner built on current aggregate rows would imply traceability that does not exist.

### P0 workflow gap — no receiving truth

No inventory receiving document/session exists. An invoice or vendor bill must never be treated as proof of physical receipt. Future flow must separately preserve document evidence, human review, physical count/condition, and Odoo receipt validation.

### P1 reliability gap — no inventory command/reconciliation lifecycle

No durable outbox exists for inventory operations. Timeout, uncertain response, retry, replay, and reconciliation behavior are therefore undefined for receipts, reservations, transfers, issues, returns, and scrap.

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
| Catalog search | `src/server/db/repositories/parts-catalog.repo.js` | Read-only identity/availability projection search. |
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

- Status: VERIFIED
- Decision/requirement: Prove the smallest complete receiving/identity loop without making the app a competing stock ledger or changing untracked Odoo products.
- Before: Invoice approval stopped before inventory; no receipt command, exact serial identity, QR label, or authenticated scan resolver existed.
- After: A reviewed invoice with whole-quantity lines mapped to exactly one serial-tracked Odoo product stages a durable receipt/outbox command, creates or safely replays one incoming Odoo picking, validates it, confirms local state only after Odoo reports `done`, stores one unit per provider lot/serial, renders authenticated-encrypted QR labels, and resolves one exact unit on a phone-oriented scan surface.
- Canonical owners: `src/server/modules/inventory/*`; `src/server/integrations/odoo/odoo.receipts.js`; `src/server/db/repositories/inventory-receipts.repo.js`; `frontend/src/features/inventory/*`; `frontend/src/features/office/InvoiceExtractionWorkspace.jsx`.
- Data/API changes: Migration `064_inventory_receipt_serialization.sql`; exact receipt/label/QR/resolve routes named in the capability matrix; AES-256-GCM unit tokens with random nonces; provider marker `WG-REC-<receipt-id>` plus immutable idempotency-key/request-hash and frozen Odoo picking-type/source/destination replay validation; receipt-wide limit of 500 serialized units and bounded provider batches.
- User-experience changes: Office/Admin invoice review exposes one next action after approval, then a minimal printable label grid. An encrypted QR opens part, serial, status, location, Odoo receipt, and event history; signed-out scans resume after login, and `Scan another` supports camera and manual fallback.
- Authorization/security changes: Existing workorder-office policy protects receiving/labels; scan resolution requires authentication plus company and mapped-location scope. QR payload contains no vendor, price, invoice, tenant, or predictable serial data and is integrity protected by a dedicated signing key.
- Failure/reconciliation behavior: Fractional or excessive quantities, duplicate part lines, missing/ambiguous product mapping, non-serial Odoo tracking, missing incoming route, provider rejection, incomplete picking, replay conflict, and token tampering fail closed. Claimed commands enter reconciliation-required on uncertain provider failure; local units do not become in-stock before provider confirmation.
- Verification: Focused inventory/Odoo/UI tests passed; a fresh temporary PostgreSQL database applied all migrations including `064`; production build and structure checks passed; rendered local invoice upload/OCR/review passed; signed QR resolved the expected local fixture at 390×844. Repository-wide unit run retained four pre-existing failures in untouched workspace-header/supporting-text tests.
- Release evidence: Pending commit, deployment, and Odoo-staging walkthrough. No production/app-provider records were created at this point.
- Remaining gaps: Dedicated Parts role, physical arrival/count/condition and putaway confirmation, general lot/package sync, issuing/installing/return/core flows, durable printer jobs, receipt reversal/void workflow, and actual-device camera permission testing.
