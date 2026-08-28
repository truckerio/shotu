# Inventory End-to-End Walkthrough Plan

**Status:** Draft for refinement
**Created:** 2026-08-26
**Scope:** Invoice intake, receiving, serialized inventory, QR labels, mechanic use, transfers, warranty, and audit history
**Implementation authority:** Plan only. This document does not mark any proposed behavior as implemented.

## 1. Purpose

Build one easy inventory workflow inside Workorder Generator. Office users receive parts from invoices, mechanics scan and use exact parts, locations transfer parts safely, and the system retains the complete history of every physical unit.

The frontend should show the user one clear next action. The backend should handle identity, permissions, matching, validation, ledger entries, idempotency, and audit history.

## 2. Product Decisions

1. Workorder Generator is the system of record for application-owned inventory.
2. Odoo is an optional import/integration source, not required for daily inventory work.
3. A master part is shared reference data. It has no quantity, location barcode, or serialized-unit QR.
4. Quantity belongs to a master part at a specific location.
5. Every countable physical unit receives a permanent internal serial number and secure QR code.
6. A unit keeps the same serial number and QR code when transferred.
7. An invoice is financial/source evidence. It does not prove that all physical parts arrived.
8. Receiving, transfers, issues, installations, returns, warranty claims, and corrections are recorded as durable events.
9. Original documents and historical events are not silently overwritten. Corrections use versioned records or compensating events.
10. Location and company scope come from the authenticated user. The browser may display the selection, but it may not grant itself access.
11. Invoice extraction is provider-neutral and local-first. External AI is an optional escalation path, not the default product dependency.
12. The user asks for a part and destination. The backend decides whether the simplest valid fulfillment is local stock, an internal transfer, or a purchase for that destination.

### Extraction policy correction

The initial draft named OpenAI because the current implementation uses local OCR as observation/context but, whenever an OpenAI key is configured, routes the final structured draft through OpenAI. That is current implementation behavior, not the desired product rule.

Target extraction order:

1. Detect a known vendor/layout and run deterministic local extraction.
2. Otherwise run local OCR plus the generic invoice parser.
3. Reconcile invoice number, dates, line math, subtotal, tax, shipping, and total.
4. Accept the local draft when quality gates pass.
5. Escalate only unfamiliar, ambiguous, or failed documents to a configured extraction adapter.
6. Keep external AI opt-in per company and replaceable by another provider.
7. Show the operator the same review experience regardless of which adapter produced the draft.
8. Never let an extraction result—local or external—change inventory without human review and physical receipt confirmation.

Every run retains provider, model/engine, version, latency, confidence, warnings, and reason for escalation. This lets the team measure when external AI is actually useful and remove it from vendor families that local learning handles reliably.

## 3. People and Main Pages

### Office user

Main pages:

- **Operations** — workorder and exception queues.
- **Invoices** — scan, review, receive, and view invoice history.
- **Inventory** — find parts, view stock, print labels, request transfers, and inspect history.

### Mechanic

Main page:

- **My Work** — open a workorder, scan a part, install/use it, return it, or report a problem.

### Admin

Main pages:

- **Operations**
- **Inventory**
- **Locations**
- **Settings**

Vendors, transfers, warranty, price history, and serialized-unit history should normally open as drawers, sections, or task flows from these pages—not as many new top-level pages.

## 4. Complete User Walkthrough

### Flow A — Sign in and determine location

1. User signs in.
2. Backend determines company, role, authorized locations, and default location.
3. If the user has one location, the system selects it automatically.
4. If the user has multiple locations, the last-used authorized location is selected and remains visible in the page header.
5. Admin users must explicitly see which company and location they are acting in.

Success result: every later action has trusted company, user, role, and location context.

### Flow B — Scan an invoice and extract data

1. Office user opens **Invoices**.
2. User selects **Scan invoice**.
3. User uploads a photo, image, PDF, or supported batch.
4. Backend immediately stores the original document, content hash, uploader, company, location, and upload time.
5. Backend checks for a duplicate document or duplicate vendor invoice number.
6. The local-first extraction pipeline creates a structured draft.
7. If the local result fails quality gates, the backend may escalate to the company's configured extraction adapter.
8. Backend matches the vendor and each invoice line to existing master parts.
9. Extraction never changes inventory by itself.

The review screen always shows:

- document viewer on the left;
- compact editable form on the right;
- document-viewer toolkit for zoom, fit, rotate, open, and download;
- confidence beside each field without large cards;
- only low-confidence, invalid, or unmatched values emphasized;
- line reconciliation and total warnings near the affected values;
- optional PO number under additional details.

PO meaning: the PO number is the buyer company's purchase-order number given to the seller. If the company did not create a purchase order, leave it blank. Do not use a seller's invoice, estimate, web-order, or reference number as the buyer PO.

Success result: a reviewed invoice draft exists, but stock is unchanged.

### Flow C — Confirm physical receipt

After invoice review, the primary action is **Confirm delivery**.

The user sees one question:

> Did everything on this invoice arrive at this location?

Actions:

- **Yes, receive everything**
- **Missing or damaged items**

For exceptions, the user enters only affected line, received quantity, condition, and optional photo/note. The backend calculates the remaining discrepancy.

On confirmation, the backend atomically creates or updates:

- vendor and vendor reference;
- invoice and reviewed invoice lines;
- receipt and receipt lines;
- receipt batch/source-cost history;
- master-part match or a controlled unmatched-part task;
- location-part parent records;
- serialized physical units for countable quantities;
- aggregate quantity records for measured materials;
- append-only inventory events;
- invoice, receipt, and unit relationships.

The same invoice/receipt cannot be posted twice. A retry returns the existing result when the payload is identical and rejects a conflicting replay.

Success result: inventory changes only for physically confirmed quantities.

### Flow D — Generate, print, and attach QR labels

1. After receipt, the page shows **Print labels**.
2. Backend creates a durable label job from the received serialized units.
3. User selects or uses the saved printer/template.
4. Labels contain human-readable part number, short description, internal serial, location, and QR.
5. User prints and attaches one label to each physical unit.
6. For high-value or controlled parts, the user scans a sample or every label to verify attachment.
7. Failed or partial print jobs can be retried without creating new serials.

Success result: every serialized physical unit has one permanent identity and a verified printable label.

### Flow E — Use the Inventory page and part detail window

The user opens **Inventory**. The page contains:

- global search for part number, description, serial, vendor, or invoice;
- location filter;
- primary actions: **Scan invoice**, **Scan part**, and **Get parts**;
- master/location part list as the primary page;
- a reusable secondary detail window that opens from the right when a part is selected.

The secondary detail window is not another main page. The Inventory list remains visible behind it so the user keeps context. The window uses the app's own typography, colors, buttons, spacing, and status language while borrowing only the reference image's clear header, grouped sections, quiet summary treatment, and sticky action area.

Shared window behavior:

- desktop: right-side overlay, wide enough for dense information but never wider than the primary page;
- phone: full-width sheet with safe-area spacing;
- header: part number, description, status, and close action;
- body: independently scrollable grouped sections;
- footer: only the actions valid for the current part and user;
- close by button, Escape, or backdrop when no unsaved work exists;
- focus moves into the window on open and returns to the selected row on close;
- URL deep link is a future enhancement for sharing a selected part;
- opening a nested vendor, invoice, unit, transfer, or warranty record reuses the same secondary-window pattern instead of stacking unrelated pages.

Selected-part detail sections:

1. **Stock by location** — on hand, reserved, in transit, available, and exception counts.
2. **Purchase and price history** — vendor, invoice, receipt date, batch quantity, unit cost, and cost trend.
3. **Serialized units** — serial, QR status, location, lifecycle status, receipt batch, and reservation.
4. **Activity** — receipts, transfers, issues, installations, returns, adjustments, and user/time evidence.
5. **Warranty and documents** — warranty terms, invoices, photos, claims, and replacement relationships.

Vendor details open in a drawer from the purchase history. Transfer and warranty tasks open from the selected part or serialized unit.

Success result: users can answer what the part is, where units are, what each cost, and what happened to each unit without changing pages repeatedly.

### Flow F — Mechanic scans and installs a part

1. Mechanic opens **My Work**.
2. Mechanic opens the assigned workorder.
3. Mechanic opens **Parts** and taps **Scan part**.
4. Phone camera scans the QR. Manual entry and supported hardware scanners remain available.
5. Backend resolves the secure token and validates:
   - company and location access;
   - unit lifecycle status;
   - current location;
   - reservation or approval policy;
   - workorder and asset relationship;
   - duplicate-use protection.
6. The page shows the part and one action: **Use on this workorder**.
7. If approval is required, the backend creates a lightweight approval task instead of making the mechanic re-enter part details.
8. Mechanic confirms installation and supplies only missing evidence: position, odometer/hours, or photo when required.
9. Backend records issued and installed events, exact unit, mechanic, workorder, asset, timestamp, and evidence.
10. A workorder cannot close while an issued serialized unit has no final disposition.

Possible final dispositions:

- installed;
- returned unused;
- damaged;
- warranty return;
- transferred to another approved task;
- missing, with exception investigation.

Success result: the exact physical part is tied to the exact asset and workorder.

### Flow G — Get parts: use, transfer, or buy

1. User opens **Inventory** and selects **Get parts**.
2. User enters part, quantity, destination location, and optional needed date.
3. Backend ranks fulfillment options:
   - available at current location;
   - transfer from another company location;
   - buy from a known vendor for the destination;
   - create a manual sourcing task when no valid option is known.
4. The user sees one recommended route with availability, expected arrival, and known cost. Alternatives stay under **Other options**.
5. The user confirms the recommendation instead of choosing backend transaction types.

#### Scenario G1 — Stock already exists at the destination

- Reserve the requested units at that location.
- Send a pick/issue task to the appropriate user.
- Do not create a transfer or purchase.

#### Scenario G2 — Transfer stock from another yard

- Reserve exact source units and create a transfer with a serialized manifest.
- Source user scans units and taps **Send**.
- Units become **in transit**.
- Destination user scans and receives them.
- Location changes only for confirmed received units.

#### Scenario G3 — A user at Yard A buys a part for Yard B and the seller delivers directly to Yard B

- Create a purchase-for-location record with Yard B as the receiving location and the Yard A user as requester/buyer.
- Do not create a Yard A inventory receipt or an internal transfer because the part never enters Yard A custody.
- Yard B confirms physical receipt, prints/attaches labels, and creates Yard B inventory.
- Preserve buyer, payment/receipt evidence, vendor, agreed cost, delivery location, and final invoice.

#### Scenario G4 — A user at Yard A buys or picks up a part for Yard B, then carries it through Yard A

- Create the purchase for Yard B but record first physical custody at Yard A staging.
- Yard A receives/labels the unit into a controlled staging status.
- Backend creates the transfer manifest to Yard B automatically.
- Yard A scans **Send**; Yard B scans **Receive**.
- Cost remains tied to the purchase; custody events show the path through Yard A.

#### Scenario G5 — Emergency counter purchase or employee card purchase

- User selects **Bought it now** from the request.
- Capture seller, amount, photo/receipt, purchasing user, destination, and whether the part is in hand.
- Backend creates a provisional purchase record and the correct receive-at-destination or stage-and-transfer task.
- Missing invoice, approval, or cost allocation becomes an Office exception without blocking a safety-critical part from being traceable.

#### Scenario G6 — Vendor ships part directly to a mechanic, roadside job, or asset

- Use a controlled field-receipt location/custody state instead of pretending it arrived at a yard.
- Mechanic scans receipt and installation against the assigned workorder/asset.
- Office resolves missing invoice or cost evidence afterward.

#### Scenario G7 — Partial shipment, backorder, substitution, damage, or cancellation

- Receive valid quantities immediately; keep remaining quantity open.
- A substitution must be explicitly matched to an approved master part/fitment before use.
- Damaged units enter quarantine and do not count as available.
- Backorders retain promised date and vendor status.
- Cancellation closes only the unfulfilled quantity; it never deletes accepted receipts or custody history.

#### Scenario G8 — Same company versus another legal company

- Between yards owned by the same company: use an internal transfer, never a fake sale or purchase between those yards.
- Between different legal companies: use linked intercompany sell/buy records and keep separate ownership, cost, and receiving events.

#### Purchase-order handling

The frontend does not require the user to know or create a PO number. The system always creates an internal request/purchase reference. A formal seller-facing purchase order is optional and generated only when company policy or the vendor requires it. Seller invoice, estimate, web-order, and confirmation numbers remain separate references.

Success result: the user requests a part once; the backend preserves the correct purchase, inventory, transfer, and custody records for the route the physical part actually takes.

### Flow H — Report a warranty problem

1. User scans or opens an installed serialized unit.
2. User taps **Report problem**.
3. System already knows master part, unit serial, vendor, invoice, cost, receipt date, installation date, asset, workorder, mileage/hours, and warranty terms.
4. User enters failure date, current mileage/hours, complaint, diagnosis, and photos.
5. Backend evaluates warranty eligibility and creates an Office claim task.
6. Claim history stores vendor communication, disposition, credit/replacement, replacement-unit chain, and final resolution.

Success result: warranty evidence is assembled from existing records instead of being recreated manually.

## 5. Core Data Model

### Reference data

- **Master part** — company, normalized part number, description, manufacturer, category, UOM, default cost, aliases, vendor references.
- **Vendor** — identity, contacts, terms, account/reference numbers, and active status.
- **Location** — company-owned operating location and optional bins.
- **Asset** — vehicle/equipment receiving installed parts.

### Inventory ownership and identity

- **Location-part parent** — one company + location + master part + UOM relationship. Owns the location-specific parent barcode and derived balances.
- **Serialized unit** — one physical countable unit with permanent internal serial and secure QR identity.
- **Quantity balance** — projection derived from accepted inventory events, not independently edited history.
- **Receipt batch** — invoice/receipt/source/vendor/date/cost grouping for units received together.

### Transactions

- invoice and invoice line;
- receipt and receipt line;
- part request and fulfillment recommendation;
- purchase-for-location record and purchase line;
- optional seller-facing purchase order;
- transfer order and transfer line;
- serialized transfer manifest;
- part reservation;
- issue and installation;
- return and disposition;
- warranty entitlement and claim;
- label job and print attempt;
- stock adjustment with reason and approval.

### Evidence and history

- immutable original documents and hashes;
- append-only inventory/unit events;
- actor, company, location, device/session, and timestamp;
- photos, notes, signatures, and supporting documents;
- versioned vendor, cost, and warranty terms;
- correction/supersession links rather than destructive edits.

## 6. Important Lifecycle States

### Invoice

`uploaded -> extracting -> review_required -> reviewed -> delivery_pending -> partially_received | received -> closed`

Exception states include duplicate suspected, extraction failed, reconciliation failed, and voided with reason.

### Serialized unit

`received -> available -> reserved -> picked -> in_transit | issued -> installed`

Additional outcomes include returned, quarantine, damaged, warranty_pending, replaced, lost, and scrapped. State transitions must be enforced on the server.

### Transfer order

`draft -> requested -> approved -> picking -> in_transit -> partially_received | received -> closed`

Cancellation after movement requires a reversal/return flow, not record deletion.

### Part fulfillment

`requested -> evaluating -> recommended -> confirmed -> sourcing -> ready | partially_ready -> fulfilled`

Fulfillment method is `local_stock`, `internal_transfer`, `vendor_purchase`, `emergency_purchase`, `field_delivery`, or `manual_sourcing`. The user-facing request stays one record even when the backend splits quantity across methods.

### Purchase for location

`requested -> approved | approval_not_required -> ordered -> partially_received | received -> reconciled -> closed`

Exception states include awaiting invoice, backordered, substituted, damaged, cancelled remainder, and disputed cost.

## 7. Backend Responsibilities

The backend must:

- infer trusted company, role, and allowed locations from the session;
- normalize and match vendors and parts;
- prevent duplicate invoices, receipts, units, scans, and transitions;
- make all quantity-changing commands transactional and idempotent;
- lock or version contested balances and units;
- generate permanent serial identities and authenticated QR tokens;
- derive location balances from accepted events;
- keep unit, invoice, receipt, cost, warranty, workorder, and asset lineage;
- create focused exception tasks instead of exposing backend complexity;
- recommend a fulfillment route using availability, travel/time, vendor lead time, cost, urgency, and company policy;
- preserve requested-for location, purchased-by user, physical custody location, and final receiving location as different facts;
- retain an auditable actor and reason for every correction;
- support optional Odoo import without allowing it to overwrite local-authority records.

## 8. Security and Privacy Requirements

- Enforce company and location authorization on every inventory read and write.
- Never trust company, role, location, price, or lifecycle state supplied only by the browser.
- QR payloads must be opaque/authenticated and must not expose predictable database identifiers.
- Resolve QR scans server-side and return only data the actor may view.
- Apply least-privilege permissions for receiving, transfer approval, adjustment, warranty, and administration.
- Require reason and elevated permission for stock adjustments, write-offs, and sensitive cost changes.
- Encrypt sensitive documents and secrets; do not put provider credentials or private invoice URLs in client code.
- Record security-relevant events without logging full QR secrets or sensitive payment information.
- Camera scanning must use HTTPS and explicit device permission. Manual entry/scanner fallback is required.

## 9. Performance and Reliability Targets

Targets to validate during refinement:

- Invoice extraction: usable draft in **1–10 seconds** for a normal one-page invoice; local/template extraction should satisfy the common path without an external provider.
- Scan resolution: **p95 under 500 ms** after QR decode on a normal connection.
- Inventory search: **p95 under 500 ms** for common company/location queries.
- Receipt posting: one atomic result with safe retry; never duplicate stock.
- Transfer send/receive: safe retry; one accepted event per unit transition.
- Large histories: server pagination and indexed search; do not load all units or events into the browser.
- Extraction work: bounded queue, timeouts, retry policy, observable provider latency, and clear retry/manual-review action.
- Printing: durable job state with retry and no regenerated unit identities.

## 10. Delivery Plan

### Phase 0 — Refine and approve this plan

- Confirm terms, roles, page ownership, state transitions, and system-of-record rules.
- Resolve open questions below.
- Convert the approved plan into schema/API/UI acceptance slices.

### Phase 1 — Complete invoice receiving

- Keep document-left/form-right review.
- Separate reviewed invoice from physical receipt.
- Add full/partial/damaged receipt confirmation.
- Add duplicate protection and exception recovery.
- Make label jobs durable and printable.

Acceptance:

- A reviewed invoice does not change stock.
- A confirmed receipt changes stock exactly once.
- Partial receipt creates only received units and keeps the remaining discrepancy visible.
- Each received countable unit has one permanent serial and printable QR.

### Phase 2 — Unified Inventory page

- Keep stock/search as the primary page and open a shared secondary right-side part window on selection.
- Combine stock, invoice history, price history, serialized units, activity, warranty, and documents inside that window.
- Reuse the window for vendor, invoice, unit, transfer, and warranty details without adding top-level navigation.
- Keep data paginated and location-scoped.

Acceptance:

- Office/Admin can trace any unit to its receipt and any invoice to its resulting units.
- User can compare purchase cost by vendor, batch, date, and location.

### Phase 3 — Mechanic scan-to-use

- Add scan action inside the workorder Parts flow.
- Add server validation, approval policy, issue, install, return, and unresolved-unit completion guard.

Acceptance:

- One scan identifies one allowed physical unit.
- Installation records exact unit, workorder, asset, mechanic, and time.
- Unauthorized, wrong-location, already-used, or duplicate scans cannot change inventory.

### Phase 4 — Get parts, purchasing, and location transfers

- Add one Get parts request and backend recommendation flow.
- Add direct-to-destination purchase, stage-then-transfer purchase, emergency purchase, field delivery, partial/backorder/substitution, and cancellation handling.
- Add transfer order, reservation, pick, in-transit custody, destination receive, and exceptions.

Acceptance:

- Location changes only after destination receipt.
- Every transferred unit has source scan, sender, receiver, and timestamps.
- Partial or damaged handoffs remain reconcilable.
- A purchase delivered directly to another yard never creates false source-yard stock or a false transfer.
- A purchase physically handled by the buying yard records staging custody and the following transfer.

### Phase 5 — Warranty lifecycle

- Add warranty-term snapshots, eligibility calculation, problem reporting, claim queue, vendor resolution, and replacement chain.

Acceptance:

- A claim can assemble purchase and installation proof without re-entering known data.
- Replacement never destroys the failed unit's history.

### Phase 6 — Operational hardening

- Add cycle counts, adjustment approvals, reconciliation, offline-aware scan recovery, dashboards, alerts, archival/retention policy, backup/restore checks, and load/security testing.

## 11. Success Measures

- Percentage of received countable units with a valid serial and label.
- Percentage of invoice lines automatically matched to a master part.
- Median and p95 extraction time.
- Receipt retry/duplicate rate.
- Percentage of issued units with final disposition.
- Percentage of installations tied to exact asset and workorder.
- Transfer discrepancy rate and time to resolution.
- Inventory variance found during cycle counts.
- Warranty recovery value and claim completion time.
- Median user actions from invoice upload to printable labels.

## 12. Out of Scope Until Explicitly Approved

- Creating or accepting purchase orders in Odoo.
- Making Odoo required for normal inventory operation.
- Automatically committing vendor purchases or sending external orders without an authorized user confirmation.
- Payment processing or accounting journal posting.
- Destructive history cleanup.
- Production deployment, data migration, or importing production people/workorders.

## 13. Open Questions for Refinement

1. Which roles may approve transfers, stock adjustments, and warranty claims?
2. Which locations use bins, shelves, or cages, and must they be scanned?
3. Which UOMs are serialized individually, batched/lotted, or stored only as measured quantity?
4. Which parts require label verification, approval before issue, or installation evidence?
5. Should office staff receive an invoice before vendor payment, after payment, or both?
6. How are returns, reusable cores, refurbished parts, and vendor credits handled?
7. What printer models and label sizes must be supported first?
8. What should happen when a mechanic has no camera permission or poor connectivity?
9. Which cost method is needed for reporting: exact unit cost, batch cost, weighted average, FIFO, or more than one view?
10. How long must invoices, photos, scan evidence, and event history be retained?
11. When optional Odoo import conflicts with local master data, which fields may be updated automatically and which require review?
12. Should a single invoice be allowed to contain parts physically delivered to multiple locations?
13. Which purchases need approval, and what cost/urgency thresholds allow an emergency purchase?
14. Which vendors require a formal seller-facing PO versus only the system's internal purchase reference?
15. Should field delivery be allowed for every mechanic or only selected workorders and roles?

## 14. Refinement Log

Use this section to preserve accepted decisions instead of silently rewriting them.

### 2026-08-26 — Initial draft

- Captured the full invoice-to-receipt-to-QR-to-mechanic workflow.
- Added inventory, transfers, warranty, data ownership, security, reliability, phased delivery, and open questions.
- No implementation status was changed by creating this document.

### 2026-08-26 — Provider-neutral extraction, fulfillment scenarios, and secondary detail window

- Replaced the assumption that OpenAI is the default with a local-first, provider-neutral policy and measurable optional escalation.
- Expanded Get parts into local stock, internal transfer, direct-to-destination purchase, stage-then-transfer purchase, emergency purchase, field delivery, exceptions, and intercompany handling.
- Defined the selected part experience as a reusable secondary right-side detail window, not another main page.
- Kept external purchasing commitment and backend purchase/transfer execution as planned work, not implemented behavior.

## 15. Research References

- [Odoo barcode operation types](https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/barcode/setup/operation_types.html)
- [Odoo barcode internal transfers](https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/barcode/operations/transfers_scratch.html)
- [Odoo three-way matching and bill control](https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/purchase/manage_deals/control_bills.html)
- [MDN Barcode Detection API](https://developer.mozilla.org/en-US/docs/Web/API/BarcodeDetector)
- [MDN camera access with getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)

## 16. Relationship to Existing Documentation

This file is the proposed product walkthrough and delivery plan. Current implementation truth remains in `docs/INVENTORY_ODOO_LIVING_RECORD.md` and source code. When an approved phase is implemented, update the living record with exact files, tests, release evidence, and remaining gaps.
