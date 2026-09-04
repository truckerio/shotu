# Inventory Search, Filters, and Workflow Shortcuts

## Status and decision

2026-09-03 — PLAN ONLY. Extends the [inventory walkthrough](../INVENTORY_END_TO_END_WALKTHROUGH_PLAN.md) and [cost and price-history plan](SERIALIZED_UNIT_BATCH_COST_AND_PRICE_HISTORY_PLAN.md). No application changes, migrations, stock mutations, or delivery authorized.

Keep one Inventory workspace. Let users find parts by what they know: part, serial, truck/trailer number, receipt batch, or invoice. Reuse the same scoped search and item picker for invoice attachment. Do not add a separate dashboard for each question.

Revision 2026-09-04: master plan Section 17 controls Units, baseline/recovery, lifecycle, financial matching, and permissions. Earlier named companion files remain absent; reconcile them if recovered. The new Units directory is explicit delivery scope and uses the same asset-usage projection as Inventory search.

## 1. Evidence and limits

Source-inspected foundations:

- `frontend/src/features/inventory/InventoryWorkspace.jsx` owns the stock workspace, location, availability, sorting, search, and paginated stock requests. Its search label currently lists part number, description, manufacturer, or barcode. This is not a verified vehicle-usage search.
- `frontend/src/features/inventory/PartSerializationPanel.jsx` owns serial detail, source invoice access, and label-batch actions.
- `src/server/db/repositories/inventory-unit-workorder-usage.repo.js` joins exact serialized usage to workorder and asset, including `asset.unit_no`, and distinguishes pending/installed/removed usage states. Existing workorder-specific queries are a foundation, not a fleet-wide inventory projection.
- `src/server/db/repositories/inventory-aggregate-workorder-usage.repo.js` provides quantitative nonserialized usage through workorders. Include it separately rather than manufacturing serial identities.
- `src/server/db/repositories/assets.repo.js` supports unit-number lookup. Resolve asset IDs; do not associate usage through fuzzy text matches.
- Receipt lineage, manual serialization batches, and label-print batches are distinct existing concepts. A print/reprint is not a purchase or receipt.

Confidence: source-backed proposal; rendered behavior, response times, and operator learnability are unverified. Operational UX skill informs progressive disclosure, shared owners, and the acceptance gates below.

## 2. Simple search and filter model

One search field: **Part, serial, truck/trailer, invoice, or batch**. No required search syntax.

Suggestions group matching objects under Parts, Serial units, Trucks/trailers, Batches, and Invoices. Exact identifiers rank before partial names. Show enough identity to disambiguate, never silently choose between a truck, trailer, part, and serial sharing the same number. Selecting a suggestion creates a visible removable filter chip and the relevant result view.

Keep Location, Batch, and a view-appropriate Status filter visible on desktop. Put Vendor, Invoice, Received date, Used date, Condition, and data-quality filters under **More filters**. Only show applicable controls; never apply a received-date field to a usage date without saying so.

- Different filter groups combine with AND; multiple selections within one group combine with OR.
- Batch plus Truck/trailer means parts originating in that batch with a matching usage episode on that asset. Used date and usage status must match that same episode, not unrelated episodes on the same serial.
- In vehicle context, show **Usage: All recorded** by default, with **Currently installed** and **History** choices. Reserved/awaiting approval is separately labeled and is not confirmed usage.
- Availability belongs to stock context. When choosing a vehicle context, visibly replace it with Usage rather than carrying a hidden Available filter that conceals installed parts. Preserve the previous stock view for Back.
- Filter chips, date basis, result count, and **Clear filters** stay visible. Zero results explain the active scope; an error never masquerades as zero results.
- Search and filters are read-only. They never install, remove, transfer, change cost, or attach an invoice automatically.

## 3. Batch: “What arrived together, and where is it now?”

Use stable acquisition-source identity: receipt ID for invoice receipts, the actual manual acquisition batch for manual stock, and a source-group reference for stock-count imports where supported. Label source type explicitly; counted stock is not proof of a purchase date. Missing provenance appears as **Batch unknown**, not an invented grouping.

A searchable batch option shows readable reference, source type, received/recorded date, original location, vendor and invoice when available. One invoice may cover multiple receipts; one batch may have multiple supporting documents. Manufacturer lot and label-print batch remain distinct optional metadata.

Selecting a batch shows its recorded original contents, grouped by part, expandable to exact serials. Include installed, transferred, returned, and scrapped units with their current status—not just available units. Show received quantity, current disposition counts, invoice coverage, and authorized known-cost total/coverage. Aggregate quantities retain UOM; never total liters and pieces as one quantity.

Default location scope stays explicit. A filtered location may show only part of the batch; label **Showing items in selected locations**. Offer **All authorized locations**, never broaden access automatically or expose counts for hidden locations. Distinguish original receiving location from current custody, including in-transit/vendor custody.

Batch splits, transfers, reuse, and reprinting preserve original lineage. Corrections are audited; original received quantities and corrected totals are distinguishable. An invoice attachment does not create a new acquisition batch.

Example: Batch B-104 originally has 10 alternators: 4 available, 3 installed, 2 in transit, 1 returned to vendor. Searching the batch still finds all 10 where authorized; invoice costs are not multiplied by the number of links or movements.

## 4. Truck/trailer number: “What parts did we use on this unit?”

Typing `402` offers typed matches such as **Truck 402** and **Trailer 402**, with authorized identifying context. Selecting one resolves a company-scoped asset ID. Keep serial numbers labeled **Part serial** and vehicles labeled **Truck/trailer** to avoid two meanings of “unit.”

Show **Parts for Truck 402 — All recorded** with current installed records, completed usage history, and clearly separated pending records. Each row includes part, serial or quantity/UOM, workorder, usage/install date, removal date when known, status, source batch, invoice link/coverage, and role-authorized cost. Secondary facts can expand on demand.

- Currently installed means an active confirmed installation with no completed removal, derived from the canonical lifecycle owner. Pending approval never becomes confirmed through display logic.
- History includes removed/replaced/returned serialized episodes and approved consumed aggregate quantities. Released reservations and reversed usage are retained as explicitly canceled/reversed history, excluded from net-used totals.
- A reused serial has multiple episodes but one physical identity. “3 usage events involving 2 serials” is different from “3 parts owned.” Group repeated episodes under the serial when useful.
- Aggregate usage such as oil belongs in recorded usage, not an assertion that a specific physical object is still installed. Keep quantity adjustment/reversal history.
- Vehicle-to-vehicle movement appears as removal from the old vehicle followed by the confirmed new installation; search must not show two active installations for one serial.
- Legacy free-text workorder entries appear separately as **Historical entry — tracking unverified** where safely linkable. Never infer exact serial or batch from a description.
- Display **Recorded history only** when baseline/legacy data is incomplete. An empty result does not prove the vehicle has never used parts.
- Asset renaming preserves ID-linked history. If workorder asset reassignment is supported, use audited attribution/correction; do not silently move posted usage history because a join now resolves another vehicle.

Show recorded parts-used cost with known-cost coverage and the cost addendum's reuse rules. Invoice totals, purchase spending, and usage cost are separate measures. Clicking **View invoice** retains the vehicle filter when returning.

## 5. Shortcuts that remove common work

Prioritize these contextual actions and saved filter presets, not another wall of cards:

| Operator question | Shortcut | Guardrail |
| --- | --- | --- |
| What else came with this part? | Show this batch | Immutable acquisition source, not print batch |
| Where is this exact part now? | Current location and history | Distinguish shop, vehicle, transit, and vendor custody |
| What have we used on this truck? | Parts used on this truck/trailer | All recorded usage with confirmed/pending distinction |
| Which parts lack paperwork? | Missing invoice | Missing acquisition invoice, not merely missing any attachment |
| Which costs need fixing? | Missing cost / Cost needs review | Unknown is not zero; restrict to cost-authorized roles |
| Can another shop supply this? | Available at other shops | Authorized availability; request transfer, do not reserve automatically |
| What did we remove but not put away? | Awaiting handoff / Inspection | Not available until physical handoff and disposition approval |
| Which returns still need follow-up? | Return sent, credit pending | Physical return and financial credit are independent |
| Which cores are still owed? | Cores due / Credit pending | Deposit, due date, core custody, and refund match remain distinct |
| What warranties need attention? | Claims pending / Coverage ending | Only confirmed terms; unknown terms flagged, no automatic eligibility claim |
| Did the price change? | Price history from part or batch | Same currency/UOM/condition, core deposits excluded |

V1: search, batch/vehicle context, Missing invoice, and source/history shortcuts. Add exception presets only after their underlying workflow data exists. Recent filters may be local user state; named saved views can follow if users repeat complex combinations. No scheduled notifications implied.

## 6. Invoice multiselect without repeated uploads

Reuse **Add invoice → Items on this invoice**, grouped **Batch → Part → Serial units**. Users can search/filter by batch or vehicle, then choose exact items across different parts/batches and upload once. Invoice-created matches remain automatic; manual selection handles exceptions.

Checkboxes show selected counts and partial groups. Deduplicate overlapping parent/child selections by exact target ID. Keep selections across query/filter changes without interrupting typing; show a persistent selected-items tray including how many are outside the current filter, with Review selected and Clear selection. Final review always shows the complete submission scope. Changing company/action scope requires explicit discard or permitted target revalidation; never silently carry targets into another tenant. Parent selection states whether it covers the whole group or only matching children.

V1 selects visible rows or explicit groups only; no ambiguous “select all” across unseen pages. If all-matching selection is later supported, freeze and preview the server-resolved scope and revalidate permissions/version before saving. Whole-catalog selection never links future acquisitions.

**Save invoice links** says **Inventory quantities will not change**. Cost allocation and **Confirm delivery** remain separate reviewed actions. Selecting every part ever used on a truck does not mean one invoice paid for them all: review invoice-line coverage, mismatches, and existing primary acquisition links. Support partial invoice coverage and supplementary evidence without replacing original source.

## 7. Ownership, query contracts, and permissions

- Extend `InventoryWorkspace` and its shared table/detail patterns. Reuse `PartSerializationPanel` for exact serial source/history; do not fork a second serial detail.
- Add a server-owned search resolver and paginated batch/asset-usage projections using canonical receipt, serial, asset, and usage repositories. Proposed read routes/contracts require implementation design; do not assume they already exist.
- Results expose explicit row kind, physical ID, usage episode ID where relevant, typed acquisition source, current custody, source completeness, and permissions. Keep stock counts, serial counts, and usage counts separately labeled.
- Query on company, authorized locations/assets, batch source, usage asset/status/date, with stable pagination and unique tie-breaker. Index actual query plans; no client-side filtering of a capped serial list or N+1 per-row invoice requests.
- Avoid invoice/event joins multiplying rows, cost, or totals. Deduplicate physical IDs for batch results and usage IDs for history; aggregate before joining evidence.
- Tenant, role, location, asset, document, and cost access apply independently to rows, autocomplete, counts, exports, and bulk validation. Access to a transferred serial does not grant unrestricted original invoice access. Do not expose hidden counts or expected serials from blind-receiving manifests.
- Preserve filters/sort/page through detail and Back using validated URL state; never put signed document URLs or secrets there. Cancel/ignore stale query responses. Refresh must not silently change selections or an open draft; revalidate selected records before action.
- No money edit or state transition in search results. Route actions to the canonical invoice/transfer/return/warranty owner with explicit review and refreshed permissions.

## 8. Layout and learnability gates

Desktop: one search/filter toolbar, compact removable chips, result table, existing detail panel. Tablet: filters wrap without overlap. Phone: full-width search, Filters button with active count, stacked records and full-page detail; no nested scrolling or compressed desktop table. Keep identity, status, and next action visible before secondary metadata.

Acceptance targets, to validate after implementation:

1. At 1440, 768, and 390 CSS pixels and 200% zoom, no clipped essential actions; keyboard focus remains visible, including under sticky selection controls. Prefer 44px touch controls.
2. Keyboard supports suggestion navigation, selection, chip removal, checkbox partial states, and return from detail. Results/count changes are announced without stealing focus.
3. A first-time operator can find a named batch's contents, truck history, and missing-invoice items without specialist terminology. Test with at least three representative operators; record errors and completion time, revise before claiming learnability.
4. Selecting Truck 402 shows recorded use even with zero available stock; duplicate unit numbers require disambiguation. Removed parts never appear as currently installed.
5. A split/transferred/returned batch retains provenance; label reprinting cannot change membership. Partial authorized views say so without leaking hidden totals.
6. Multiple reuse episodes, aggregate adjustments, late invoices, duplicate evidence links, and mixed currencies cannot inflate stock, usage, or cost totals.
7. Unit+batch+date filters match the same relevant episode. Empty/loading/error states and Back preserve understandable scope.
8. Bulk invoice retry is idempotent, overlapping selections deduplicate, changed eligibility is surfaced, and no stock change occurs on link-only save.
9. Cross-company/location, cost-redacted, and document-restricted cases pass endpoint and rendered tests, including autocomplete/counts/export if offered.
10. Target first result page within one second at p95 after input settles against an agreed representative dataset; measure API and rendering separately, with indexed pagination at expected maximum volume. This is a target, not an observed result.

## 9. Delivery sequence and remaining decisions

1. Apply master Section 17 Units/baseline scope, acquisition identity, usage/custody guards, and proposed permissions; reconcile older companions if recovered.
2. Add read contracts and tests for batch contents and asset usage, including aggregate and incomplete historical data.
3. Add typed search, contextual filters, source/history links, and responsive result views.
4. Reuse picker for late-invoice multiselect; integrate approved cost data without duplicate counting.
5. Add data-backed exception presets, then operator tests and performance/accessibility checks.

Assumptions for review: vehicle search defaults to all recorded rather than current installation only; original receipt is the everyday meaning of Batch; receipt date is the default batch date; users see only authorized history. These defaults can change after operator testing without weakening identity or custody rules.
