# Full shop inventory workflow: repository review and revised delivery plan

Reviewed 2026-09-11 against local staging at `5e2e61f`, including existing uncommitted changes.

Status: review complete; implementation of the full target is not complete. This document records the requested review before implementation. It does not certify production behavior. The user's inventory request is separate from the inspection/universal-template plan.

## Workspace expansion - 2026-09-11

Implemented after the user's full-plan authorization: all five navigation views; local suppliers and versioned/approved POs; partial PO receipts; damaged-delivery holds; stock damage/repair/release/scrap with explicit reuse grants/policies; same-company transfers with partial destination receipt and preserved serials; individual aggregate and exact-unit cycle counts with recount-on-change; supplier bills, receipt-quantity matching, credit/payment evidence and outstanding totals; scoped stock/usage/commitment/money/transit reports and page exports.

These workflows use the existing receipt, identity, movement and balance owners. New stock-origin tasks do not fabricate vehicle removal cases. See `../INVENTORY_USER_GUIDE.md` for use and `../INVENTORY_ODOO_LIVING_RECORD.md` entry INV-20260911-03 for verification and limitations.

**Full-plan status remains incomplete.** The five views are not proof of completion. Still required: position balances/picking and put-away; opening import revision and explicit unlabelled identity registration; baseline/found-part intake; integrated upload-to-bill/price exception review; tire positions, fitment policies, rotation and retread; core deposit obligations/credit allocation; warranty/supplier return extensions; extended permission/approval policies; effective pricing and valuation; attachments; bulk/resumable count sessions; unsubmitted task/bill draft persistence; payment dates/reversals; full Odoo-disabled end-to-end cutover and real scanner/printer proof.

## Implementation progress — 2026-09-11

The first receiving delivery is implemented locally:

- Shared Add stock from part details, including quantity and measured material without an invoice.
- Explicit captured identities for serialized direct receipts; rejects duplicate identities and existing shop QR registration.
- Scope, catalog version/tracking/unit checks and transactional receipt/ledger/balance/label posting through existing owners.
- Unknown receipt costs preserved as null; aggregate canonical receipt quantities support decimals.
- Durable browser draft/command recovery after an uncertain response; scoped command-result lookup.
- Quantity/bulk location details and bounded stock movement history.
- Stock search includes captured serialized identities within scope.
- Migration applied locally, isolated PostgreSQL reconciliation/concurrency test, focused inventory tests, responsive browser recovery checks and production build.

This implements part of stages 1–2 below. It does not finish all ten stages. In particular, existing invoice receipt compatibility remains; opening/cycle count redesign, per-position accounting, receipt/bill matching, purchasing, transfers and the advanced lifecycle/commercial additions remain pending. See the living record entry `INV-20260911-01` for exact scope and validation.

## Product direction

Keep the proposed five working views: Stock, Purchases, Receiving, Tasks and Reports. Stock is the landing view. Preserve the existing Workorder Create/Detail form, parts table, responsive detail panels and shared entry controls. Prefer task completion with prefilled context over additional mandatory screens.

The proposed action counts are UX targets, not fixed limits or tested results. Identity capture, physical inspection and approvals remain real work.

## Changes required before building the target

### 1. Make physical receipts independent of invoices

The local full-delivery service currently accepts one reviewed invoice and one `all_received_undamaged` attestation. The local receipt schema requires an invoice and uniquely constrains company/invoice. That supports the current complete-delivery path, but cannot represent repeated partial deliveries, direct receipts or receipt-before-bill matching.

Extend the existing canonical receipt/line owners. Add receipt source and typed source links rather than constructing fake invoices. Keep old invoice receipt identifiers and legacy replay behavior valid. Introduce quantity allocations between PO lines, receipt lines and bill lines; one invoice can cover multiple receipts and one receipt can be billed across documents. A bill match never posts another physical movement.

Specify accepted, held/damaged and rejected quantities separately. Accepted and physically held goods have custody evidence; only eligible accepted company-owned goods become available. Rejected goods never become available. Receipt corrections reference their original evidence and create compensating events.

### 2. Separate opening balances, cycle counts and identity registration

The existing count-import implementation is an opening-stock importer: it rejects a part/location with existing local stock, requires positive integer quantities, and generates application identities for serialized quantities. It is not a reusable cycle-count engine.

Opening inventory must record observed baseline stock without inventing purchase or installation history. Support zero observations and fractional quantities according to the stocking unit. A blank amount is unknown, never zero. Existing costs remain nullable.

Cycle counts need scope, draft observations, line-level balance revision at observation time, recount state and approved variance postings. Movement after observation invalidates only affected lines. Apply valid lines independently with durable per-line outcomes. Keep physical position corrections distinct from total-quantity corrections.

Serialized imports require either scanned existing identities or explicit physical registration of each unlabelled unit. A generated application label is permitted for an actually observed unit; spreadsheet quantity alone is insufficient evidence to create eligible exact stock. Retain historical generated identities and mark their provenance; do not silently renumber or delete them.

### 3. Enforce reviewed tracking and stocking units across every writer

Catalog creation/editing already supports tracking and locks changes after activity. Full invoice receiving still falls back to automatic serialization for unclassified count/packaging units. Replace that fallback with an explicit review exception across invoice, opening-count and direct-receipt entry points.

Validate serialized quantities as whole numbers and match them to the captured identities. Quantity and measured material stay aggregate. Store canonical stocking quantities; version and snapshot configured purchase-pack/conversion factors on transactions. Never infer pack size or cross-dimension conversions from names. Equivalent display aliases must not change historical quantities.

Services and labor products remain outside physical receipts, position balances, serialized stock and inventory movements.

### 4. Introduce position accounting before automatic picking

Current stock includes a bin text field and exact-unit custody positions. That is not a general balance ledger supporting several positions for one part at one shop.

Define company/location-scoped positions with an explicit unassigned position. Track quantity by position, condition/availability and ownership where applicable. Store actual receipt destination; preferred bins are suggestions. Preserve an audit link for bin moves and corrections. Position totals must reconcile to location totals without duplicating exact-unit balances.

Define available quantity once: eligible company stock minus active allocations. Held, installed, customer-owned, unknown-ownership and in-transit stock must not contribute. Do not implement this as a UI-only filter. Automatic picking chooses eligible positions through the same guarded allocation contract used by Workorders.

### 5. Move transfer foundations earlier

Move internal transfer dispatch/receipt into the receiving-and-storage delivery, before cross-shop Workorder shortcuts and replenishment depend on it. Existing fulfillment recommendations and `ready_for_transfer` states do not prove physical dispatch or receipt.

Dispatch atomically removes source availability and records transit custody. Receipt records actual destination custody and exceptions. Short receipt leaves an unresolved transit remainder, rather than losing it or duplicating stock. Preserve serial identity across both actions. Cross-company transactions require commercial ownership transfer and remain outside ordinary internal moves.

### 6. Define purchasing and money independently of physical stock

Add local supplier identities/references, PO headers/lines/revisions, approval decisions and communication outcomes. Supplier references are scoped to suppliers; ambiguous matches become exceptions. Sending an order is an explicit external action with a durable result, separate from saving or approving a draft.

Track ordered, received, billed, credited and paid quantities/amounts independently. Remaining PO quantity excludes received and cancelled remainder. Replenishment includes open incoming commitments and purchasing packs without double-counting demand already reserved.

Define transaction currency, decimal precision, tax treatment and rounding before bill/credit totals. Keep nullable purchase cost, landed-cost adjustments, selling price and core deposits separate. Select and document valuation policy before publishing valuation totals. Reports must show unknown-cost coverage rather than silently valuing unknown stock at zero.

Payment recording is evidence entry only. Allocation cannot exceed the outstanding amount without an explicit unapplied-payment/credit model. Historical transaction snapshots survive later price edits.

### 7. Add an explicit authorization and command contract

Existing authorization is mostly Office/Admin plus company/location scope; it is not the full proposed purchasing, cost visibility and approval policy matrix.

Define capabilities for receiving, purchasing, purchase approval, count approval, price/cost visibility, payments, transfer dispatch/receipt, inspection release, scrap and policy administration. Enforce them in server queries and commands, including exports. Approval rules must specify thresholds, material revision rules and whether self-approval is permitted.

Every physical/financial command needs an actor, company/location scope, stable idempotency key, canonical payload hash, expected revision where appropriate, and a durable result lookup. Reusing a key with different data is a conflict. Lock affected stock consistently and commit evidence, movements, allocations and projections together. Refresh command outcome before retrying an uncertain submission.

### 8. Make advanced lifecycle extensions depend on proven shared stock rules

Existing serialized Workorder and custody/reuse flows are foundations to extend and test, not workflows to replace. Establish installation, removal, handoff, inspection and release event ownership before tire/core/warranty extensions.

Tires keep one casing identity through rotation, repair and retread. Fitment and inspection limits require explicit approved configuration; text similarity is not a fitment check. A core obligation, physical dispatch and monetary credit are three separate linked facts. Warranty eligibility is provisional until supplier acceptance. Rejected returns restore custody of the same identity into review, never create duplicate stock.

### 9. Treat disconnected operation as a gate throughout delivery

Local invoice posting and local catalog creation already have implementations. Provider-managed edits, provider projections and legacy authority reconciliation still require a deliberate audit. The existence of local posting alone does not prove every workflow can operate without Odoo.

Run each new local journey with provider access disabled. Preserve external identifiers as references and protect local balances against provider imports. Final cutover reconciles opening balances, active reservations, exact identities and unresolved provider commands per company/location. Keep migration checkpoints and reconciliation evidence; do not silently overwrite stock or withdraw source ownership locks.

## Existing implementation map

| Area | Evidence in this working tree | Target gap |
| --- | --- | --- |
| Stock and details | `frontend/src/features/inventory/InventoryWorkspace.jsx`; `src/server/db/repositories/local-inventory.repo.js` | Expand task navigation and tracking-specific surfaces; verify location-scoped zero-stock and serial search behavior |
| Catalog creation/editing | `inventory-part-details.service.js`; `parts-catalog-edit.repo.js` | Supplier-scoped matching, conversion policy, consistent reviewed tracking across writers |
| Complete invoice receipt | `local-inventory.service.js`; `local-inventory.repo.js`; migrations 065/066/068 | Independent receipts, partial/damaged delivery, captured exact identities and receipt/bill allocations |
| Opening import | `inventory-count-imports.repo.js`; `inventory.schemas.js`; migration 071 | Zero/fractional observations, exact-identity evidence and a separate cycle-count model |
| Labels/scanning | `InventoryScanWorkspace.jsx`; `inventory-labels.service.js` | Device validation, position/shelf labels and registration evidence |
| Serialized Workorders | `inventory-unit-workorder.service.js`; `inventory-unit-workorder-usage.repo.js` | End-to-end custody, allocation and return reconciliation under new receiving rules |
| Aggregate Workorders | `inventory-aggregate-workorder.service.js`; `inventory-aggregate-workorder-usage.repo.js` | Position allocation, concurrency proof and configured conversions |
| Custody/reuse | `InventoryCustodyWorkspace.jsx`; `inventory-reuse.service.js`; `inventory-reuse.repo.js` | Extend existing lifecycle for repair/return/advanced policies; validate complete journeys |
| Replenishment/fulfillment | `inventory-stocking-policy.service.js`; `part-fulfillment.repo.js`; migration 067 | Local POs, actual shipments, incoming commitments and supplier communication |
| Commercial, tires, cores, warranty | No complete implementation established by this review | Dedicated scoped records and workflows on shared inventory foundations |

Source filenames without a directory in this table refer to their existing inventory module or repository owner. This is a source review, not proof that every existing screen or database migration is healthy.

## Revised delivery sequence

1. **Baseline and contracts:** capture current reconciliation; define permissions, availability, source types, tracking, unit rules, command outcomes and migration compatibility. Audit provider coupling. Preserve existing local edits.
2. **Stock and direct receiving:** full-catalog finding; tracking-specific details; one shared Add stock task; source-independent receipt posting; actual destination and exact identity capture. Distinguish new receipt from Count stock.
3. **Opening inventory and positions:** observation-based import, unassigned positions, put-away, quantity/serial reconciliation, labels and registration. Finish these prerequisites before promising automatic bin allocation.
4. **Purchasing and documents:** local suppliers, PO revisions/approval, typed quote/invoice intake, receipt/bill allocations and existing-receipt matching.
5. **Delivery and transfers:** partial, held/damaged, rejected and over-delivery cases; direct-to-job custody; dispatch/transit/receipt; enforce no duplicate identities or stock posting.
6. **Workorder integration:** retain current forms; use shared availability and allocation; prove quantity, bulk and exact-unit issue/install/unused-return semantics and repair-history suggestions.
7. **Counts and lifecycle:** resumable cycle counts, movement-aware recount, approved variances, custody handoff, inspection, reuse, repair and scrap through existing owners.
8. **Tires, cores and warranty:** shared identity/custody extensions after lifecycle reconciliation passes.
9. **Commercial completion and reports:** bills, credits, payment evidence, configured valuation, replenishment and source-linked reports. Currency/rounding and commercial schema contracts are defined in stage 1/4, not deferred until this stage.
10. **Final disconnected cutover:** reconciled migration rehearsal, restoration proof, remaining provider exceptions and complete operator journeys. Disconnected tests run at every earlier stage too.

Each stage must deliver usable behavior and migrations before its navigation/actions are exposed. Do not add empty tabs to imply completed functionality.

## Acceptance scenarios to implement

- Receive a quantity part twice concurrently with the same command: one receipt/movement; changed payload with the same key: conflict.
- Receive goods, then attach their invoice: quantity unchanged by document matching.
- Receive part of a PO and later the remainder; reject/hold damaged goods; reconcile accepted plus outstanding quantities.
- Reject an existing serial on a new receipt; preserve the identity through transfers and supplier return.
- Attempt an unauthorized company/location mutation, cost read and approval: deny before writes or sensitive projection.
- Record zero count and fractional bulk count; leave blank observations unresolved; require recount only where stock moved.
- Register serialized opening stock only from actual captured/registered identities; no invented purchase/installation dates.
- Issue, install, remove and return stock: reconcile eligible stock, reservations, custody and Workorder history after every event.
- Move between bins without changing location total; transfer between shops with no availability at either while in transit.
- Reject incompatible unit conversion; preserve transaction conversion and price snapshots.
- Allocate a partial core credit and partial payment; show the true remaining obligation and independent physical status.
- Fail a save or lose its response; preserve draft and look up the original command result before retry.
- Complete realistic desktop, tablet and phone journeys with keyboard/scanner controls and no required Odoo operation.

## Review validation

Ran four existing suites: `local-inventory.service.test.js`, `inventory-part-details.service.test.js`, `inventory-count-imports.service.test.js`, and `inventory-workspace-model.test.js`: **35 tests passed**. These cover selected service contracts and pure models; they do not establish live database concurrency, migration compatibility, complete browser journeys or physical device behavior.

No application behavior, stock records, purchase records or authorization policies were changed by this review.
