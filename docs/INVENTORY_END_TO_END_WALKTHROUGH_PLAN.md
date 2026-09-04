# Inventory End-to-End Walkthrough Plan

**Status:** Draft for refinement
**Created:** 2026-08-26
**Scope:** Invoice intake, receiving, serialized inventory, QR labels, mechanic use, transfers, warranty, and audit history
**Implementation authority (2026-09-04):** User authorized implementation with user experience and simplicity first. This document does not mark proposed behavior as implemented. Production mutation/deployment and Git delivery require separate authority.

**Simplicity-first delivery contract:** Users see Units, Inventory, and existing Workorders—not a screen for every scenario. Units offers search, truck detail, tracked parts and history. Inventory starts with search, stock and Add invoice; batch filters and invoice evidence are nearby. Use/remove remains in the workorder flow. Transfer, Return, and Warranty open only from relevant records under More. Costs appear in authorized detail, with a simple price-history view. Prefill known facts, show one consequential confirmation, and disclose extra questions only when needed. Safety scenarios remain backend rules and tests, not required user setup or a dashboard of choices. Advanced saved views, a comprehensive follow-up dashboard, costing-method menus, offline mutation, formal valuation, and intercompany workflows are not requirements for the first usable release. Unsupported exceptional cases remain clearly held for review; do not fake a successful action. Deliver the core capabilities in verified increments without presenting a partial implementation as the whole plan.

**Controlling revision — 2026-09-04:** Section 17 defines the required Units module, opening installed-part records, shared lifecycle rules, independent document states, credit allocation, proposed permissions, and online-only mutation policy. It takes precedence over earlier walkthrough shorthand and linked addenda on these subjects. The UI addendum owns layout; the search addendum owns filter semantics; the cost addendum owns calculation/reporting rules, subject to Section 17 safeguards. Section 18 records the second stress test. No proposal grants access or authorizes implementation.

**Cost and price-history addendum (2026-09-03):** [Serialized Unit, Batch Cost, and Price History Plan](specs/SERIALIZED_UNIT_BATCH_COST_AND_PRICE_HISTORY_PLAN.md) defines invoice-linked exact-unit costs, multiselect allocation, batch totals, purchasing/usage reports, core-credit separation, and accessible price trends. It narrows the cost-reporting proposal below without claiming accounting valuation or implementation.

**Search and workflow addendum (2026-09-03):** [Inventory Search, Filters, and Workflow Shortcuts](specs/INVENTORY_SEARCH_FILTERS_AND_WORKFLOW_SHORTCUTS_PLAN.md) defines acquisition-batch filtering, truck/trailer-number lookup across installed and historical parts, shared invoice multiselect, and exception shortcuts. Searching inventory must not be limited to stock currently on hand.

**Shared-component UI blueprint (2026-09-03):** [Inventory UI and Shared Components Plan](specs/INVENTORY_UI_AND_SHARED_COMPONENTS_PLAN.md) maps the complete workflow to existing collection, form, upload, detail, scanner, and draft primitives. Use it as the UI entry point; the linked search and cost addenda retain their domain rules.

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
- **Units** — new truck/trailer directory, tracked installed parts, and history.
- **Invoices** — scan, review, receive, and view invoice history.
- **Inventory** — find parts, view stock, print labels, request transfers, and inspect history.

### Mechanic

Main page:

- **My Work** — open a workorder, scan a part, install/use it, return it, or report a problem.

### Admin

Main pages:

- **Operations**
- **Units** — new directory and detail module, not merely an Inventory search result.
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

After invoice review, offer **Confirm delivery** only for outstanding physical purchase lines. Credit-only documents and evidence attached to already-received goods have no delivery action. Section 17 separates document review from receiving and financial matching.

The user sees one question:

> Did these outstanding physical items arrive at this location?

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
3. System prefills known part, serial, vendor, invoice, cost, dates, asset, workorder, readings, and warranty terms. Missing values remain unknown; coverage is not inferred from absent evidence.
4. User enters failure date, current mileage/hours, complaint, diagnosis, and photos.
5. Backend flags eligibility for review using recorded terms and creates an Office claim task; only the vendor's recorded decision establishes claim approval.
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

Document review: `uploaded -> extracting -> review_required -> reviewed`, with versioned supersession/void. Receiving and credit matching are independent per-line projections defined in Section 17; neither is a required stage of every invoice.

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
- Deliver the Units directory/detail and baseline-recording design from Section 17 as explicit scope. Approve capability assignments before enabling mutations. Online-only confirmation and uncertain-response recovery are prerequisites for the first mutation slice, not Phase 6 polish.

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
- Include Units -> Tracked installed parts -> workorder-bound removal, baseline/untracked recovery, handoff, inspection, and controlled reuse under Section 17. This phase cannot claim the full removal workflow without the Units entry point.

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

- Extend cycle counts, reconciliation, dashboards, alerts, archival/retention policy, and load testing. Authorization, adjustment approval, safe retries, and backup/restore rehearsal are release gates for their first affected slice. Offline mutation is out of V1; a future offline design needs separate approval and conflict-resolution review.

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

1. Approve or revise the deny-by-default capability assignments and self-approval restrictions in Section 17 before rollout.
2. Which locations use bins, shelves, or cages, and must they be scanned?
3. Which UOMs are serialized individually, batched/lotted, or stored only as measured quantity?
4. Which parts require label verification, approval before issue, or installation evidence?
5. Should office staff receive an invoice before vendor payment, after payment, or both?
6. Section 17 controls return/core/reuse safeguards; vendor-specific deadlines and reusable-part inspection criteria require company configuration before those actions are enabled.
7. What printer models and label sizes must be supported first?
8. Manual code entry is available; V1 state-changing commands require connectivity. Section 17 defines uncertain-response recovery and no automatic offline replay.
9. Operational cost proposal: invoice-attributed unit cost and batch totals, with quantity-weighted historical purchase summaries. See the cost addendum. Formal accounting valuation, aggregate cost-layer allocation, and recovered-part carrying value still require separate confirmation.
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

- [Cost and price-history research and implementation plan](specs/SERIALIZED_UNIT_BATCH_COST_AND_PRICE_HISTORY_PLAN.md) — official IFRS, Odoo, Chevrolet, and W3C sources; researched 2026-09-03.

- [Odoo barcode operation types](https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/barcode/setup/operation_types.html)
- [Odoo barcode internal transfers](https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/barcode/operations/transfers_scratch.html)
- [Odoo three-way matching and bill control](https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/purchase/manage_deals/control_bills.html)
- [MDN Barcode Detection API](https://developer.mozilla.org/en-US/docs/Web/API/BarcodeDetector)
- [MDN camera access with getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)

## 16. Relationship to Existing Documentation

This file is the proposed product walkthrough and delivery plan. Current implementation truth remains in `docs/INVENTORY_ODOO_LIVING_RECORD.md` and source code. When an approved phase is implemented, update the living record with exact files, tests, release evidence, and remaining gaps.

## 17. Controlling safety and completeness revision — 2026-09-04

### 17.1 Units is a required delivery, not a missing dependency

Build a first-class **Units** destination using existing asset identities, shared collection/page primitives, and shared detail patterns. Proposed `units` module access is Off / Read / Full; Full never overrides action-level permissions below. Do not create duplicate assets merely to populate the directory.

- Directory: cursor-paginated truck/trailer list, number/VIN search, type/location/status filters, and clear identity disambiguation. No-query browsing must work; a capped autocomplete is not the directory API.
- Detail: Overview, **Tracked installed parts**, and History. Show pending installations separately and label incomplete historical coverage. Use the same usage projection from Units, Inventory search, and workorders.
- Removal route: Units -> Truck 402 -> Tracked installed parts -> exact part -> Remove. Select an eligible open workorder for that same company/asset/location context or explicitly create one through the shared creation workflow. A closed original installation workorder is history, not the removal command's editable owner. Users unable to create a workorder can request office help; no silent workorder creation or authorization bypass.
- Record both original installation episode and new removal workorder. Default event date is now; backdated evidence is reviewed against the full timeline. It cannot silently create overlapping installations or rewrite approved reports.
- Vehicle rename preserves asset ID; archive retains history and does not release its parts. Conflicting duplicate-asset merges require a reviewed reconciliation and cannot join two active placements of one serial.
- Reuse `OperationalCollectionPage`, `Pagination`, `ContextBreadcrumbs`, `SecondaryDetailPanel`, existing workorder creation and serial detail. New Units controllers own routing/asset queries, not a second inventory ledger.

The earlier named companion files remain absent. This revision explicitly supplies the minimum Units/lifecycle contract for this plan; if those files reappear, compare and reconcile differences before implementation rather than silently importing them as authority.

### 17.2 Starting with already-installed or untracked parts

Two evidence workflows are mandatory:

1. **Record existing installed part:** choose exact vehicle, identify part/position, scan any existing label or enter manufacturer serial if present, and record observed date, observer, and supporting evidence. Search for an existing internal identity first. Create a baseline observation, not an invoice receipt or a new purchase. Unknown original install date, invoice, and cost remain unknown. Reviewer acceptance establishes a tracked baseline placement with explicitly unknown start time; it does not post acquisition or historical usage cost.
2. **Record untracked removed part:** record removal workorder/vehicle, observed part, actual current holder/location, reason and evidence. Create a recovery case in a non-available hold. Do not fabricate a former installation date or decrement shop stock that was never recorded. Approval resolves identity and records custody/condition; normal handoff and release controls still apply.

An existing serial found by scan must be reused, never cloned. For unlabeled items, manufacturer number is evidence, not guaranteed global uniqueness. Same-vehicle/position/part observations are flagged as possible duplicates; empty position is not proof of uniqueness. Concurrent baseline acceptance is serialized by asset/position where known and checks identity conflicts. Unresolved ambiguity stays on hold and cannot be issued or credited as a confirmed core fulfillment.

If later evidence proves two records are the same physical object, an elevated reviewer records an alias/supersession with all history retained, resolves active placements/reservations atomically, and recalculates projections. No destructive merge or copying purchase cost twice. Baseline/recovery records carry **Invoice unavailable — legacy** when reviewed as genuinely unavailable, so they do not generate an impossible perpetual upload task; adding later evidence remains possible.

### 17.3 One physical authority across every workflow

Model physical custody, condition, reservation, installation episode, and financial status separately. A warranty claim or credit does not itself move custody. Each serial has at most one current physical placement and one active exclusive stock reservation across workorders, transfers, and outbound returns.

| Command | Required starting facts | Atomic physical result / forbidden shortcut |
| --- | --- | --- |
| Reserve for workorder / approve transfer or return allocation | Accepted available stock, no competing reservation | Exclusive reservation owned by named workflow; drafts alone reserve nothing |
| Confirm installation | Correct active workorder/asset, owned reservation, recorded issue/handoff | Placement on vehicle; pending approval stays visibly pending and unavailable; approval cannot be inferred from a scan |
| Return unused | Reserved/issued but no physical installation | Release only after actual custody confirmed; damage routes to hold. If physically fitted, use removal even before manager approval |
| Remove installed part | Active placement or accepted baseline, eligible removal workorder | End physical placement; holder is named mechanic/field custody, awaiting handoff; never Available |
| Receive removed part | Matching removal/recovery and actual recipient/location | Received pending review; non-available |
| Release for reuse | Received, catalog reuse policy permits it, inspection complete, release authority | Available with original identity; refurbishment must finish first; unknown reuse policy means hold |
| Confirm transfer send | Exact source placement and transfer-owned reservation | Transit custody with source/destination retained, unavailable at both shops |
| Confirm transfer receipt | Matching sent serial, destination authority and observed receipt | Destination custody; accepted items available or reserved for original destination job, damage on hold |
| Confirm vendor/core send | Exact held item, accepted outbound allocation, no competing use | Vendor-bound transit, then vendor custody on evidence; usable stock/core shop count changes once |
| Confirm scrap/loss | Eligible held state, approved disposition and evidence | Terminal non-available outcome; any recovery requires reviewed compensating events |

All commands use the same server transition service or shared guarded repository contract. Lock physical identity/reservation and relevant workflow rows in deterministic order; validate company, current grants, versions, eligibility, and policy inside the transaction. Persist event, projections, operation result, and required follow-up intent together. A queued notification cannot be the sole record of an unresolved task.

Cross-command tests are mandatory: install vs transfer, transfer vs vendor return, scrap vs release, duplicate handoff, and two destinations receiving one serial. One conflicting transition wins; the loser gets **This part changed — review its current status**, with no partial ledger residue. Aggregate reservations use the same principle against available quantity and preserve UOM.

Approval of allocation establishes reservation; requests do not imply reservation. No automatic expiration of reservations after physical issue or send. Cancel/release checks physical state; expired unsent reservations may release only through a guarded event. A transfer request losing stock before approval shows a shortage, not guaranteed supply.

Transaction scope: document link/cost/credit confirmations are atomic for their reviewed target set. Bulk physical work uses an explicit operation with independently atomic per-item commands so valid receipts can be accepted separately; UI shows per-item successes and failures. Never imply a whole manifest succeeded if one item failed. Preserve operation and item idempotency keys across retries; successful items are not re-executed.

Corrections are not deletion: if later dependent movements exist, block a simple undo and open a reviewed correction case. Preserve effective and recorded dates; rebuild affected projections and cost adjustments without changing physical reality based solely on edited paperwork.

### 17.4 Independent document, receiving, and financial states

- Document: uploaded / extracting / needs review / reviewed / superseded / voided-with-reason.
- Physical purchase-line coverage: not applicable / not received / partially received / received / remainder canceled. Only confirmed physical merchandise quantities participate; charges, services, and credits never create stock.
- Evidence links: unmatched / partially linked / linked; linking already-received items creates no receiving obligation.
- Costs: unknown / estimated / needs review / confirmed / adjusted, independent of physical receipt.
- Credits: unmatched / partially allocated / allocated / disputed; cash settlement remains out of V1.

Mixed documents retain signed raw quantity, price and extension. Review line type and sign convention; `-1` alone is not enough to choose core vs part return, and a negative quantity plus negative price must not be blindly negated again. Credit-only documents have no Confirm delivery button. Matching a late invoice to an existing receipt marks only the covered goods as already received; truly new outstanding lines still support receipt confirmation.

Same invoice across multiple receipts/locations is supported only within the same company and authorized scope. Quantity coverage is shared across those receipts so concurrent receiving cannot exceed the reviewed physical line allowance. An overdelivery requires explicit reviewed allowance/amendment; never silently extend invoice quantities. Dedupe receipt operations independently from invoice evidence, so late invoice upload cannot recreate manually received units.

Document corrections do not undo stock. Superseding a line with active cost/credit allocations either atomically reverses/replaces dependent financial allocations or leaves the revision in review. Previously issued statements remain reproducible; no dangling allocation to a deleted line. Closed is a display summary of applicable resolved tasks, not a required physical state for a financial document.

### 17.5 Core obligations and credit allocations

Keep three explicit entities: deposit/return obligation from a reviewed line, physical core identity with return episodes, and signed vendor-credit line. A core may differ from the newly purchased serial; link it as fulfillment of the obligation, not as the replacement part itself. Core balances are a view of the physical ledger, not an extra copy of the removed serial.

- Allocate by same company, vendor account, currency, approved compatible core class, and referenced obligation. Uncertain matches stay suggested, never auto-confirmed from description/amount alone.
- Quantity and money are independent: one accepted core may get two partial credits, but it cannot fulfill two obligations at once. Several core obligations may share one consolidated credit line. Service goodwill/fees are separately typed adjustments, not invented core quantities.
- Under locks, active allocations may not exceed credit-line amount/quantity where meaningful, accepted obligation quantity, or remaining deposit recovery amount. Example: $100 credit split $60 + $40 is allowed; a further $10 is rejected. A legitimate excess recovery needs a separate reviewed adjustment category, not an override of the core cap.
- Credit received before return may allocate money to an obligation while physical fulfillment remains pending. Do not claim core receipt from the credit. An untracked core must complete identity review before physical fulfillment is accepted.
- Each physical return episode can fulfill only one active obligation quantity; reversal releases that allocation explicitly. A rejected core physically returned by the vendor follows a received-on-hold event, then a new outbound episode if resent. Resending alone creates no new deposit or refund entitlement.
- Reversals/supersession preserve history and reopen the relevant remaining balance. A vendor reversing a credit changes money state, never returns the physical core automatically. Claim and core records referencing the same credit share the same allocation owner rather than each counting it.
- Matching commits atomically with document version and all affected balances. Competing sessions cannot allocate the last credit amount twice. Authorization applies to preview, commit, and operation-result reads.

### 17.6 Proposed capability defaults and separation of duties

These are a concrete proposed policy for approval before rollout, not new permissions granted by this document. Unconfigured capabilities deny by default. Read/Full module access does not imply financial access. Staff and approver capabilities may be assigned to existing Office/Admin users; a new login role is not required.

| Action | Proposed authorized capability holder | Additional restriction |
| --- | --- | --- |
| Read Units/parts | Units Read plus authorized asset/location | Mechanics scoped to assigned/permitted work; no supplier money by default |
| Use/remove/report problem; submit baseline/recovery | Assigned mechanic or scoped workorder operator | Eligible workorder; no self-authorized baseline/reuse release |
| Receive stock/handoff, send/receive approved transfers/returns | Inventory operator | Actual location/custody authority; transfer receiver differs from sender |
| Approve baseline, reuse, transfer allocation, scrap/loss/quantity correction | Inventory approver | Different actor from submitting operator; reason/evidence required |
| Upload/link financial documents, review costs, allocate credits, manage claims | Financial operator | Explicit document/cost/claim capabilities independently scoped |
| Approve changes to confirmed costs, credit reversals, write-offs | Financial approver | Different from submitting operator; original evidence retained |
| Configure capability assignments | Company administrator | Configuration alone performs no stock/financial action; audit grants |

No self-approval fallback merely because the only user is Admin. With insufficient authorized staff, keep the task pending and explain who is needed; company policy must be explicitly revised before any exception is supported. Normal receive/issue actions do not require an extra approval unless configured; the table does not turn every scan into a two-person task.

Recheck grants at execution and retry. A revoked user's operation lookup returns no restricted result details; newly authorized staff may reconcile the operation. Caches and autocomplete are keyed by actor/company/scope and invalidated on changes. Source invoice access remains separate from destination serial access; a full PDF cannot be safely redacted by merely hiding its link.

### 17.7 Connectivity, recovery, and release sequence

V1 requires an online server acknowledgement for physical or financial confirmation. Losing camera permission allows manual entry, not offline authorization. When offline, show **Not recorded — reconnect before confirming**. No background replay of state-changing commands. Do not claim local notes survive reload unless a tested persistence mechanism exists; avoid caching supplier documents/QR secrets on shared devices.

If a submitted request times out, show **Confirmation unknown — checking**. Query the stored operation result by original idempotency key; retry the identical request only with that key. Do not issue a new key because the spinner timed out. Changed payload requires reconciliation of the original outcome first. Reconnect checks current permissions and state before offering further work. Physical work done outside the app is entered as dated evidence for review; never pretend the server approved it offline.

Dependency order: (1) Units directory/detail, identity/baseline design, capability approval; (2) common transition/operation-result contracts and opening-record reconciliation; (3) receiving/linking and serial/asset read projections; (4) workorder use/removal/handoff/reuse; (5) transfers/returns/cores/warranty; (6) approved cost/credit calculations, price history and follow-up views as their foundations become available. Read-only and cost slices can run separately, but mutation slices cannot bypass their guards. Existing working features must retain their current safeguards during additive migration.

Required pre-release evidence per slice: state/permission fixtures, concurrent PostgreSQL tests, lost-response retries, additive migration/backfill rehearsal, rollback/backup validation, and authenticated responsive UI tests. No release claim based solely on this paper review.

### 17.8 Second-pass refinements: ownership and receipt identity

Physical custody is not legal ownership. Baseline/recovery records capture owner as company / customer / unknown with evidence; asset ownership does not automatically establish ownership of every part. Customer-owned or ownership-unknown parts stay segregated and cannot enter company-available stock, fulfill a company core obligation, or be scrapped by the ordinary company workflow. Resolve documented authority/title first through a reviewed case. This plan does not authorize customer-property disposal or intercompany accounting. Reuse requires ownership/authority validation in addition to condition inspection.

Receiving an existing serial must resolve its actual event: vendor-return recovery, transfer receipt, removed-part handoff, or newly acquired item. A scanned existing identity cannot create another acquisition receipt. Wrong/unexpected transfer items go into a discrepancy intake hold with actual observed custody and no duplicate identity; the expected transfer line remains outstanding. A later authorized reconciliation attaches the right shipment/return source. Recovered lost/scrapped items also enter hold, never automatic Available.

Repeated document uploads use a canonical reviewed document identity within company/vendor/document type; byte hash alone cannot catch a photograph and PDF of the same invoice. Suspicious same-number revisions are reviewed and either linked to the existing document or explicitly accepted as a distinct document with reason. Revisions cannot replenish already-allocated credit or receiving allowance. Every cost/credit allocation references the canonical line version, not an upload-run ID treated as a new entitlement.

## 18. Second stress-test record — 2026-09-04

Scope: this master plan plus the UI, search/filter, and cost addenda. Method: sequential adversarial review of operational failures, newcomer interpretation, and security boundaries; no delegated agents, live mutations, load tests, or runtime verification. **Covered** below means the revised written contract states a deterministic safe outcome, not that code passed a test.

### Scenario trace

| ID | Stress scenario | Required outcome | Written coverage |
| --- | --- | --- | --- |
| S01 | No Units destination exists | Explicit directory/detail delivery before full removal claim | 17.1; UI Section 2 |
| S02 | Old starter has no serial/invoice | Baseline or recovery evidence, unknown cost, no fake purchase | 17.2 |
| S03 | Two users identify the same unlabeled removed item | Review duplicate evidence; uncertain identities cannot be released | 17.2 |
| S04 | Install and transfer submit for one serial | One exclusive reservation/transition wins; loser gets conflict | 17.3 |
| S05 | Mechanic physically fits part before approval, then removes it | Removal/handoff, not unused-stock release | 17.3 |
| S06 | Three-item transfer receives two, one damaged/missing | Per-item results, damage hold, remaining quantity unresolved | 17.3 and UI transfer flow |
| S07 | Server commits send but response is lost | Same-key operation lookup/retry, never second send | 17.7 |
| S08 | Credit-only or mixed invoice uploaded | No physical receipt for credit/charge lines | 17.4 |
| S09 | Invoice arrives after manual receipt and installation | Link existing goods; no new quantity; late cost adjustment | 17.4 and cost Sections 6–7 |
| S10 | Two users allocate last $100 credit | Shared locked remaining balance; no duplicate allocation | 17.5 |
| S11 | $100 credit split $60/$40, then another $10 attempted | Reject over-allocation; explicit separate adjustment for genuine excess | 17.5 |
| S12 | Core rejected, returned, and resent | One physical identity, new return episode, no new refund entitlement | 17.5 |
| S13 | Vendor revises an already-allocated credit | Versioned reversal/replacement or review hold, no replenished allowance | 17.4–17.5; 17.8 |
| S14 | User loses permissions during preview or timeout | Recheck grants on command/result; no restricted result leak | 17.6–17.7 |
| S15 | Mechanic tries to approve own reuse/scrap | Deny; task remains pending for another capability holder | 17.6 |
| S16 | User changes search after selecting another batch | Preserve visible selection tray; review complete scope | Search Section 6 |
| S17 | Unknown batch cost gets a late invoice | Original snapshot preserved; current reviewed value changes explicitly | Cost Sections 5–7 |
| S18 | Customer-owned core is removed at company shop | Segregated hold until ownership/authority resolved | 17.8 |
| S19 | Wrong serial arrives / old serial returns from vendor | Discrepancy or recovery intake, not duplicate new acquisition | 17.8 |
| S20 | Same invoice uploaded as photo and PDF | Canonical document/revision review; no duplicate entitlement | 17.8 |
| S21 | Correction attempts to undo a receipt after installation | Dependent-history correction case; no simple destructive undo | 17.3–17.4 |
| S22 | Reused part's original purchase appears on two workorders | Preserve provenance; no repeated original acquisition expense | Cost Sections 6–7 |
| S23 | Technician has no internet at roadside | No confirmed app mutation; reconnect or record dated evidence later | 17.7 |

### Adversarial findings and disposition

- **Operational failure perspective:** customer/unknown ownership could have been treated as company stock after inspection. Closed in the plan by 17.8; inspection alone cannot authorize reuse/core disposal. Existing-serial receipt classification is also now explicit.
- **New-contributor perspective:** immutable batch total conflicted with late invoice corrections; missing cost always suggested another upload even with an invoice present. Closed by explicit Original versus Current reviewed batch cost and Add invoice versus Review costs in the cost addendum.
- **Security perspective:** separate uploads of the same credit could bypass per-line allocation limits if each upload became a fresh financial identity. Closed in the plan by canonical document/revision ownership in 17.8. The implementation still must prove it.

### Verdict and remaining gates

**CONCERNS — suitable for approval and bounded implementation design, not a production-readiness pass.** The prior six blockers and three follow-up recommendations now have explicit written outcomes; this review found no remaining contradiction that requires inventing a normal-flow stock or credit rule. This is a same-agent adversarial review, not independent verification.

Remaining warnings:

1. Proposed capabilities/separation of duties may delay small one-person shops. Business approval is required before enabling them; do not weaken controls silently to make a demo work.
2. Unlabeled legacy parts cannot be uniquely identified from descriptions alone. Human evidence/review is a deliberate hold condition, not automated certainty; validate baseline setup with real fleet records.
3. Delivered-cost policy, aggregate cost-layer allocation, and recovered carrying values remain gated. Purchase-cost reporting may proceed with explicit coverage; complete valuation cannot be claimed.
4. No concurrency, migration, access-control, offline recovery, or rendered usability tests ran. Implement S01–S23 as applicable executable/API/UI fixtures before release; performance budgets need a representative dataset and measurements.

No application code, database, access grants, external vendor actions, or deployment changed in this revision. Existing unrelated frontend work remains outside scope.
