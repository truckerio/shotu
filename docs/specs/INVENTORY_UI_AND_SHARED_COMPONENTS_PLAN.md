# Inventory UI and Shared Components Plan

## Simplicity-first priority — 2026-09-04

User authorized implementation conditional on simplicity. This paragraph supersedes initial navigation density and rollout ordering, not stock/credit safety rules. Start with Units and Inventory alongside existing Workorders. Inventory defaults to stock/search and Add invoice; Batches is a filter/detail entry and Invoices a secondary view. Do not launch a permanent Follow-up dashboard or multiple specialist queues initially. Show a relevant inline Needs attention message linked to the affected record. Transfer, Return and Warranty are contextual More actions with prefilled forms. Users never choose ledger types, allocation algorithms, or backend state names. Normal receiving, installation and paperwork should not require an extra manager approval unless existing policy requires it; sensitive release/correction authority remains server-enforced. Advanced scenario-specific interfaces follow user feedback, while unsupported exceptions fail safely with plain explanations. Implementation status remains separate from this blueprint.

## 1. Decision, scope, and evidence

2026-09-03 — PLAN ONLY. No UI implementation, schema changes, stock mutations, commits, or deployment. This is the UI entry point for the [inventory walkthrough](../INVENTORY_END_TO_END_WALKTHROUGH_PLAN.md), [search/filter plan](INVENTORY_SEARCH_FILTERS_AND_WORKFLOW_SHORTCUTS_PLAN.md), and [cost/price-history plan](SERIALIZED_UNIT_BATCH_COST_AND_PRICE_HISTORY_PLAN.md).

Design one connected Inventory workspace using existing shared components. Users learn three patterns: **find a record**, **open its details**, and **review one clearly named action**. Workorders and the future Units module reuse inventory content and workflows, not copies of their business logic.

Source inspection confirms the components listed below exist. Proposed layouts, new feature components, backend capabilities, and operator performance are not implemented or rendered-validated. This is not a live UI audit. The operational UX skill shapes progressive disclosure, source/review comparison, explicit save boundaries, and responsive acceptance tests.

Revision 2026-09-04: [master plan Section 17](../INVENTORY_END_TO_END_WALKTHROUGH_PLAN.md#17-controlling-safety-and-completeness-revision--2026-09-04) controls Units scope, baseline records, lifecycle/credit guards, capabilities, and connectivity. The earlier named companion files remain absent, but Units is now explicit delivery scope rather than an unresolved external prerequisite. Missing warranty/invoice/cost facts remain unknown. Compare any recovered companion versions against the controlling revision before implementation.

## 2. Workspace structure

Add **Units** to the authorized application navigation: paginated directory -> selected truck/trailer -> Overview / Tracked installed parts / History. Use shared collection and detail components. The installed-parts view includes **Record existing installed part**; a workorder also offers **Record untracked removed part**. These create reviewed baseline/recovery evidence, not purchases or stock receipts. Removal opens an eligible workorder selector/create flow before confirmation. Users without that authority see Request office help. On phone the same detail content becomes full-width; neither an Inventory filter nor autocomplete replaces the Units directory.

Keep existing application navigation and role shells. Within Inventory use one compact view selector: **Stock**, **Batches**, **Invoices**, **Follow-up**. These are proposed peer collection views, not four new top-level application modules. Batch search can jump directly into Batches; truck/trailer search opens a contextual **Parts for Truck 402** view with Back to the prior collection. Price history lives under the part, not another permanent navigation destination.

Reuse the shared `Dropdown` for the compact view selector. Use `OperationalCollectionTabs` only for short contextual filters such as All recorded / Currently installed / History; its current implementation is a pressed-button group, not ARIA tab panels. Do not display duplicate view controls.

```text
Inventory [Stock v]                         [Add invoice] [More v]
Search part, serial, truck/trailer, invoice, or batch...
[Location v] [Batch v] [Status v] [More filters]
Truck: 402 ×   Usage: All recorded ×                    Clear filters
Parts for Truck 402 · 18 records · Recorded history only
Part / serial     Usage status     Workorder     Date       Details
...
Pagination                                       3 selected · Review
```

The sketch illustrates relationships, not a fixed pixel layout. Stock defaults to existing stock columns; truck context replaces them with usage columns. Selecting a vehicle visibly removes stock-only availability from that context. Do not cram both layouts into one wide table.

Primary collection actions are contextual: Stock/Batches → Add invoice; Invoices → Upload invoice; Follow-up → open the next selected task. More contains permitted secondary actions such as Add physical stock or Import count. Preserve existing `InventoryCountImportPanel` and `InventoryAuthorityExceptionsPanel` flows; do not hide reconciliation behind unrelated warranty tasks. No duplicate application-level Create button.

## 3. Verified shared-component reuse map

Paths below are relative to `frontend/src/`. Existing means source-confirmed, not that every proposed capability is already supported.

| UI responsibility | Existing owner / primitive | Reuse boundary |
| --- | --- | --- |
| Inventory composition | `features/inventory/InventoryWorkspace.jsx` | Own selected view, query, contextual route, and refresh coordination; extract feature sections rather than grow one giant component |
| Page header, toolbar, list rows | `components/operations/OperationalCollectionPage.jsx` family | Reuse page/header/result/table/row/cell styling and semantics across collections; domain-specific columns remain with the feature |
| Paging and return context | `components/ui/Pagination.jsx`, `ContextBreadcrumbs.jsx` | Preserve validated filters and return destination; do not replace server pagination with filtering a capped client list |
| Detail container | `components/ui/SecondaryDetailPanel.jsx`, `SecondaryDetailSection` | One active detail/action panel, shared title/status/close/footer; its current mobile CSS becomes full-width below 700px |
| Single-choice controls | `components/forms/Dropdown.jsx`, `AnchoredSelect.jsx` | Location, status, reason, view; current Dropdown is single-select and is not the hierarchical picker |
| Forms and errors | `components/forms/OperationalForm.jsx`, `FormField`, `FormSection`, `FormErrorSummary`, `OptionalSection`, `ActionFooter` | One-column decisions, inline validation, linked summary, optional facts; avoid a FormCard around every field |
| Physical quantities | `components/forms/QuantityUnitInput.jsx` | Positive quantities, existing UOM constraints; serial quantity derives from selection. This control currently enforces positive input: do not use it for signed invoice credit lines |
| Buttons | `components/ui/Button.jsx` | Same variants, sizing, busy states; no Inventory-only button system |
| Upload | `components/ui/UploadDialog.jsx`, `UploadDropzone` | Same file-selection, error, and progress presentation; feature owner retains validation and upload/API behavior |
| Invoice source/review/receipt | `features/office/InvoiceExtractionWorkspace.jsx`, `InvoiceDocumentViewer.jsx`, `InvoiceHistoryPanel.jsx`, `PhysicalReceiptConfirmation.jsx` | One canonical invoice workflow; compose a shared item-link section and cost review, keep physical receipt confirmation separate |
| Serial detail and identity | `features/inventory/PartSerializationPanel.jsx`, `PartIdentityEditor.jsx` | Extend existing content, reuse original invoice/source access and label actions; do not introduce a second identity editor |
| Scan and workorder usage | `features/inventory/InventoryCodeScanner.jsx`, `components/workorders/part-requests/WorkorderSerializedPartDialog.jsx`, `MeasuredPartUsageDialog.jsx` | Reuse scan/manual-entry paths and current issuance owner. Share selection presentation without routing invoice linking through issuance commands |
| Draft behavior | `components/drafts/useDraftForm.js`, `DraftSaveStatus.jsx`, `DraftLeaveDialog.jsx`, `useUnsavedBrowserGuard.js` | Use only with a real versioned draft persistence adapter; these primitives do not provide inventory draft endpoints automatically |
| History presentation | `components/workorders/WorkorderTimeline.jsx` / `WorkorderTimelineList`; `features/workorder-modules/unit/UnitServiceHistory.jsx` | Reuse the timeline renderer through a typed inventory-event adapter where compatible. Do not feed inventory events to workorder-specific mutation logic or infer exact parts from legacy text |

Shared components own presentation, interaction, and accessibility; feature controllers own permissions, API commands, versions, idempotency, and lifecycle policy. Avoid a generic action component with dozens of transfer/credit/warranty flags.

## 4. Small new feature-level shared pieces

Proposed names, not existing files. Place initially under `features/inventory/components/`; promote to general components only when unrelated features genuinely need the same contract.

| Proposed piece | Inputs / outputs | Used by |
| --- | --- | --- |
| `InventorySearchFilters` | Typed scope/query/filter value; controlled change; permission-scoped suggestions | Collections, invoice picker, vehicle parts view |
| `InventoryItemPicker` | Purpose, allowed scope, initial targets, eligibility; returns stable deduplicated target IDs plus versions, never posts stock | Invoice attachment, transfer/return selection; workorder selection presentation where compatible |
| `InventorySelectionSummary` | Selected targets, hidden-by-filter count, exclusions; review/remove/clear actions | Picker and bulk review; no implicit all-pages selection |
| `InventorySourceLinks` | Typed document/source references, coverage, permitted actions | Part, serial, batch, vehicle usage, claim |
| `InventoryCostSummary` | Approved costs, currency, cost basis, coverage, visibility | Serial, batch, workorder/vehicle usage; rendering does not calculate financial truth |
| `InventoryHistorySection` | Typed paginated events with physical/financial categories | Serial, transfer, return/core, claim detail |
| `InventoryStatusBadge` | Domain and state mapped to text + tone | Lists/detail; custody, usage, claim, and credit statuses are separate domains |
| `InventoryPriceHistory` | Normalized price series, basis/filter state, equivalent table | Part detail expanded view; no new chart dependency selected in this plan |

Feature controllers such as invoice-link review, transfer review, return review, and warranty review compose existing form primitives and these pieces. The picker may share checkbox rows with the existing workorder dialog, but each action retains separate eligibility and execution contracts. Do not force a flat mechanic-name multiselect to serve as a batch/part/serial tree.

## 5. Screen-by-screen contracts

### A. Stock and universal search

Default stock rows: Part, Location, Available, Reserved, Total tracked, Status. Use existing definitions until domain review approves changes; installed quantities are not available stock. Cost appears in authorized detail first, not as another required column for mechanics. A row opens part detail; a serial suggestion opens exact serial detail.

Typed suggestions separate Part serial from Truck/trailer number. Location, Batch, and Status are the visible filters; others are progressively disclosed. Chips show every active constraint. Results, counts, and suggestions respect the same authorization scope. An empty state says what filters exclude; loading and failed requests never say “No parts.”

### B. Part, batch, and serial details

Use one `SecondaryDetailPanel` with internal navigation and a breadcrumb/back stack; never stack part → serial → invoice modals. For long invoice review, transition to the invoice workspace with a safe return context. On phone the panel is full-width; Back and Close remain distinct.

| Object | First visible information | Secondary sections / actions |
| --- | --- | --- |
| Catalog part | Name/part number, tracking type, stock by authorized location | Serial units, Batches, Price history, identity editing if allowed |
| Acquisition batch | Reference, source type, received/recorded date, original location, contents summary | Parts grouped to serials, current disposition, invoice coverage, known cost, Add invoice, label actions |
| Exact serial | Part + serial, current custody/status, truck/workorder if installed | Source/batch/invoice, purchase cost, warranty summary, lifecycle history; only permitted actions |

Current state is always expanded. Other sections use ordinary headings or optional disclosure, not a tab bar for every object. Large serial/batch lists stay server-paginated. A print batch remains labeled **Label print batch**, never confused with acquisition Batch.

### C. Invoice intake, linking, and receiving

Two entry paths converge on the existing invoice owner:

1. **Invoice first:** Upload → review extracted facts and automatic item matches → approve document → separately confirm physical delivery. Receiving creates source lineage automatically.
2. **Inventory first:** select existing batch/parts/serials → Add invoice or choose an existing document → review **Items on this invoice** → Save invoice links. No new physical receipt.

Desktop invoice review uses `InvoiceDocumentViewer` beside a bounded review rail. Start layout testing near 55/45 source/review; keep actual source readable, not just a thumbnail. Review order: Needs attention; Invoice details; Items on this invoice; Totals and checks; explicit action footer. Completed summaries stay readable and editable; collapsing is not saving.

The item picker groups Batch → Part → Serial units, supports mixed-part selections and partial parent state, and keeps selected totals visible. Automatically matched items are already listed. Users only resolve exceptions. Checkboxes, not Ctrl-click. Show hidden selected items before submit; parents clearly state whether they select all children or filtered children. No future acquisitions or duplicate parent/child links.

Choose **Save invoice links**, **Confirm costs**, or **Confirm delivery** according to the current task; never a single ambiguous Save that does all three. Cost review may follow link review as a distinct step. Unknown prices remain **Cost missing**, not zero. Confirm delivery shows destination and actual received items, supporting partial/damaged receipts through existing receiving policy.

Credits retain the source's signed line values. A negative line prompts **What is this credit for?** only when unresolved: core return, part return, price adjustment, or other reviewed credit. Mixed invoices may contain merchandise and core/credit lines; classify per line. A credit before the physical return remains a financial fact with an unmatched/pending physical relationship. It never makes negative stock or silently sends a part.

### D. Per-serial cost, batch total, and price graph

Serial detail: **Purchase cost $…**, source invoice, reviewed/estimated/missing label, then optional Delivered cost breakdown and refundable core deposit separately. An allocated cost is not a freely editable field on every serial. Corrections open the reviewed allocation workflow with reason and history.

Batch detail: **Known cost $… · 8 of 10 units priced**; expand line allocations. Mixed currencies show separate totals. A core credit does not lower the merchandise-price graph.

Part detail: **Price history** section with Latest / Previous / Change and date/basis. Expand for date, vendor, currency, UOM, and condition filters; graph plus equivalent table and concise trend summary. Chart points open their invoice evidence. Unknowns are gaps; free warranty replacement is distinguishable from ordinary purchasing. No stock/usage/spending combined grand total.

### E. Vehicle parts and use/removal

Search a truck/trailer or enter from its Unit/workorder context. Reuse the same inventory parts projection with **All recorded**, **Currently installed**, and **History** choices. Rows show part, exact serial or quantity/UOM, usage state, workorder/date; invoice, batch, and authorized costs expand in detail. Pending, reversed, aggregate-consumed, and legacy-unverified records remain distinct.

**Use part** retains `WorkorderSerializedPartDialog` and measured usage flows, with scan/manual input and exact selected identity. If shared picker presentation is extracted, preserve the existing issuance retry and partial-failure behavior. Do not implement another “use” endpoint from Inventory.

**Remove part** first selects/creates an eligible removal workorder for the same asset under master Section 17; the original installation workorder may be closed and is not reused as the editable removal owner. Open a focused form with serial and vehicle prefilled. Ask removal date, reason, actual holder, and intended next step: inspect for reuse, core return, vendor/warranty return, or scrap review. Record removal first; keep **Awaiting handoff** until custody is confirmed. **Confirm handoff** identifies receiver/location. Inspection/disposition approval is separate from removal. Never label a removed item Available merely because it left the vehicle. For an untracked part, open the recovery evidence flow instead of forcing a fake receipt.

For vehicle-to-vehicle reuse, guide through removal → handoff/inspection if required → authorized new installation. Preserve serial, acquisition invoice, cost lineage, and all usage episodes. The UI cannot offer a one-click move that bypasses lifecycle rules.

### F. Transfer and getting parts

Start from selected eligible stock or **Available at other shops**. Transfer review: exact items, source, destination, optional note; show availability errors before confirmation. Quantity is selection-derived for serials and uses `QuantityUnitInput` for aggregate goods.

Actions are explicit: **Request transfer**, **Confirm send**, **Confirm receipt**. Draft/request changes no custody; send moves items to transit; receive confirms actual destination custody. Receiver scans or manually enters received items, with short/damaged/wrong-item exceptions. Blind-receiving rules must not reveal expected serials in picker or manifest views.

Partial fulfillment retains remaining lines and per-item outcomes. Cancel only the unsent remainder; dispatched items require return/recovery handling. A failed multi-item operation keeps successes read-only and retries only failures with the same operation identity. Costs and serials stay attached through movement.

For purchasing, ask **Where will it arrive?** and **Is it already in hand?** in the existing Get parts context. Direct-to-destination purchases do not show a fictional source-yard transfer. Emergency/field receipts capture actual custody and missing-invoice follow-up. Cross-company movement routes to a separate ownership/accounting workflow, not ordinary internal transfer. Optional PO details stay secondary.

### G. Returns and dealership cores

**Return to vendor** preloads exact items and invoice, then asks vendor, reason, and return authorization only if needed. Review distinguishes expected refund from credit actually recorded. Confirm send changes custody; match a credit in a separate document action. Restocking fees and partial credits remain visible, not hidden in quantity.

Core detail has two independent summaries:

```text
Physical core: At shop → Sent to dealership → Receipt confirmed
Deposit/credit: Deposit charged → Credit pending → Credit matched
```

An old core is a non-sellable physical item. Confirmed shop receipt adds it to core custody; confirmed send removes it from shop core custody. Invoice `-1` links the financial credit and does not repeat that physical decrement. If no core record can be found, show **Match core / Needs review**; do not fabricate or delete available stock.

Unknown/untracked cores, rejected cores, partial credits, credit-before-return, and lost-in-transit cases keep distinct exception states. Do not offer a generic negative-quantity stock editor.

### H. Warranty

Serial detail shows coverage source and start basis (purchase, installation, or vendor-specific), expiry/mileage/hours if known, and **Terms missing** when unknown. A batch default may apply to confirmed selected serials; exclusions and replacements retain their own terms/version. A user should not retype an invoice already linked.

**Report problem** opens the common form shell with part/serial/vehicle/invoice prefilled. Ask failure date, symptoms, and photos; usage reading/diagnosis is requested only where needed. Office claim detail shows evidence, vendor reference, submitted/pending/approved/denied state, and a clear next action. Coverage indicators are not promises of vendor approval.

Claim approval does not send the failed part, receive a replacement, or mark a refund paid. Offer separately reviewed actions **Send for warranty**, **Receive replacement**, **Match credit**, and **Close claim** as appropriate. Replacement gets its own physical identity linked to the original; a free replacement does not erase original purchase history or automatically restart coverage.

### I. Follow-up

One collection with a compact category filter: Missing paperwork, Costs to review, Transfers, Removed parts, Returns & cores, Warranty. Use rows with object, reason, age/due date when known, location, owner if supported, and **Open**. Do not place every category in large permanent dashboard cards.

Show only categories supported by real backend data. A missing deadline says Unknown, not overdue. Existing authority exceptions remain linked to their canonical resolution panel. Tasks resolve from completed underlying workflows, not a dismiss button that hides unresolved custody or money.

## 6. Interaction, state, and role rules

- One active panel and one footer per task. A child picker replaces panel content and returns to the draft; upload and source review must not accumulate overlays. Small discard confirmation can use the shared leave-dialog pattern with tested focus return.
- Footer always names effect and scope: e.g. **Save invoice links — 6 serials; quantities unchanged** or **Confirm send — 3 serials from Yard A to Yard B**. Bulk actions show exclusions and partial failures.
- Async state belongs to the action controller: editing → reviewing → submitting → success / partial / failed. Disable duplicate submit, retain input, preserve idempotency keys, and revalidate versions/permissions at commit. Stale selection is a review issue, not silent replacement.
- Long forms show Dirty / Saving / Saved / Save failed only when true. Use draft primitives with server persistence; otherwise say **Unsaved changes** and offer Stay / Discard, not a fake Save draft action. Flush before navigation and remain if save fails.
- Manual entry is always available when camera permission, scanning, or label readability fails. Duplicate scans identify an already-selected serial; they do not increment quantity.
- Mechanics see assigned/authorized usage and reporting actions; inventory staff see receiving/custody; financial visibility is independent. Do not fetch hidden cost or documents then merely conceal them with CSS. Visible-but-unavailable actions explain prerequisites; unauthorized capabilities are omitted without leaking counts.
- Reuse existing locale/number/date conventions. Plain labels distinguish Truck/trailer, Part serial, Acquisition batch, and Label print batch. UI translates states; domain identifiers remain stable.
- Back restores originating filters, page, scroll, and focus where possible. Shared links validate access on load. Refresh does not overwrite active drafts, alter selection, or move focus.

## 7. Responsive and accessibility contract

Desktop near 1440px: compact collection toolbar and table; shared right detail panel for inspection; full workspace split for long source review. Use existing spacing/type/control tokens and CSS owners; no Inventory-only palette or arbitrary new radius/shadow ladder.

Tablet near 768px: toolbar wraps into logical rows; secondary columns move into labeled detail; invoice split collapses when either pane becomes illegible. Test actual content width rather than assuming every tablet fits a split.

Phone near 390px: full-width search, Filters with active count, stacked record layout, full-width detail. Selection summary is compact and opens its full list; no nested scroll inside an already scrolling modal. Document / Review switch preserves invoice issue count, draft, and scroll position. Sticky action areas respect keyboard and safe-area insets and do not obscure focused fields.

Use 44px touch targets where applicable, visible labels, keyboard-operable suggestions and indeterminate checkboxes, textual statuses alongside color, and reduced-motion support. Chart values are available without hover. Changes to shared primitives must be regression-tested in existing non-inventory consumers; do not claim accessibility solely from using React Aria.

## 8. Validation gates and delivery order

### Ordered UI slices

1. Apply master Section 17 and approve its proposed capability assignments; audit current rendered Inventory, invoice review, workorder picker, and shared panels before changing them.
2. Units directory/detail and baseline/recovery entry points, shared presentation adapters, search/filter state, contextual collection columns, and read-only batch/serial/vehicle detail. State-changing actions depend on Section 17 guard/online contracts.
3. Shared item picker, source links, late-invoice review, and draft handling; preserve original intake/receiving behavior.
4. Cost summaries, allocation review, and accessible price history using approved cost contracts.
5. Transfers and partial receiving; removal/handoff/reuse; return/core-credit review; warranty flows, each gated by its backend lifecycle support.
6. Data-backed Follow-up views, cross-role regression tests, and realistic operator usability tests.

### Required evidence before calling the UI ready

- Render each major flow in normal, empty, loading, permission-restricted, failed, partial-success, and long-content states. Test 1440/768/390px, keyboard-only, 200% zoom, reduced motion, and phone keyboard overlap.
- Find a batch after transfer/installation/return; find Truck 402 history with zero shelf stock; disambiguate duplicate vehicle numbers; never list removed parts as currently installed.
- Select mixed batches/parts/serials, deselect children, change filters, open/return from evidence, retry after failure, and confirm no hidden or duplicate selection.
- Link one invoice to existing stock without changing quantity, custody, existing costs, or original provenance. Confirm costs and delivery only through their separately named reviews.
- Enter a dealership `-1` credit without changing available stock; confirm an actual core send once; test credit-before-return and partial-credit paths.
- Transfer partially, receive damaged goods, remove an installed part, reject reuse, receive a free warranty replacement, and verify all current state/history/cost summaries agree.
- Network or version conflict retains draft and explains next action. Cross-role tests cover costs, documents, source locations, autocomplete/counts, and blind receiving.
- Three representative operators perform batch lookup, vehicle history, one mixed-item invoice attachment, and one core return after a short introduction. Target no assistance or incorrect mutation; measure completion time and revise confusing labels before rollout.
- Changes to shared panels/forms/tables/uploads retain existing Workorders, Inspections, and creation flows. Source tests and builds are required later but do not replace deployed authenticated UI evidence.

Remaining UX decisions are testable defaults, not blockers to this plan: compact view selector versus an existing approved navigation pattern; when large serial lists need a dedicated full workspace; and whether repeat users benefit from named saved views. Do not implement all advanced controls before testing the basic three-pattern workflow.
