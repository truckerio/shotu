# Serialized Unit, Batch Cost, and Price History Plan

## Status and authority

- Date: 2026-09-03. PLAN ONLY: no implementation, migration, stock mutation, accounting posting, commit, or deployment authorized.
- Extends [Inventory End-to-End Walkthrough Plan](../INVENTORY_END_TO_END_WALKTHROUGH_PLAN.md).
- Preserves previously discussed invoice multiselect, core inventory, warranty, transfer, and reusable-unit boundaries.
- Revision 2026-09-04: master Section 17 controls Units/baseline scope, physical guards, independent document states, credit allocations, capability defaults, and online confirmations. Earlier lifecycle companion files remain absent; compare them if recovered. This addendum owns cost calculations subject to those safeguards.
- Local application inventory remains authoritative. Research into other products informs design; it does not authorize Odoo writes or change the company's statutory valuation method.

## 1. Decision

Yes: show purchase cost for each serialized unit, totals for each physical acquisition batch, and historical purchase prices for each catalog part. Derive costs from verified invoice-line allocations instead of asking users to type a price on every serial.

Use plain **Cost**, **Batch cost**, **Price history**, and **Parts used cost** labels. This is purchase/operating-cost tracking, not customer selling price or markup.

Keep these distinct:

| Measure | Meaning | Basis |
| --- | --- | --- |
| Purchase cost | Net merchandise price assigned to an exact unit | Reviewed invoice line, less applicable discounts |
| Delivered cost | Purchase cost plus approved acquisition charges | Allocated freight/duty/nonrecoverable tax policy |
| Batch cost | Sum of covered unit/aggregate costs | Specific receipt or acquisition batch, not label-print batch |
| Invoiced purchases | Deduplicated verified merchandise amounts in period | Invoice date; separate from money actually paid |
| Net document amount | Signed invoices and confirmed credit memos | Document date, currency, and explicit charge categories |
| Parts used cost | Cost attributed to approved workorder usage | Approval/usage episode plus cost version |
| Tracked stock cost | Known cost of exact stock units currently held | Current custody; excludes installed units and refundable core deposits |
| Cash paid | Actual settled payments/refunds | Not available from invoices alone; outside V1 |

Never add purchase spending and workorder usage cost together: they describe the same goods at different stages. Always show date basis and missing-cost coverage.

## 2. Research findings and product implications

### Inventory cost attribution

IAS 2 distinguishes specific identification for non-interchangeable items from FIFO/weighted average for ordinarily interchangeable items. An internal serial number alone does not justify choosing specific identification for financial books. We will trace actual invoice-attributed cost operationally; accountant approval is required for statutory valuation, tax treatment, and capitalization policies. [IFRS IAS 2 overview](https://www.ifrs.org/issued-standards/list-of-standards/ias-2-inventories/).

Purchase costs can include directly attributable acquisition costs, while discounts/rebates reduce cost and recoverable taxes are excluded from inventory purchase cost. Store these components separately rather than treating total invoice value as parts cost. [IAS 2, paragraph 11, official published text](https://www.ifrs.org/content/dam/ifrs/publications/pdf-standards/english/2021/issued/part-a/ias-2-inventories.pdf).

### Batch and serial detail

Odoo documents lot/serial-level cost visibility and valuation layers. This supports the UX distinction between product summary, batch cost, and exact-unit cost; it is not a proposal to copy its accounting configuration. [Odoo serial/lot valuation](https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/inventory/inventory_valuation/valuation_by_lots.html).

Odoo also supports explicit allocation methods for landed charges, including quantity, cost, weight, and volume. Our proposal: deterministic invoice-line allocation with a visible preview, not a hidden division of the entire invoice by every selected serial. [Odoo landed costs](https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/inventory/inventory_valuation/landed_costs.html).

### Core charges

Chevrolet describes a core charge as a deposit tied to returning a reusable core. Track that deposit/credit independently from merchandise price; do not let refunds create artificial drops in the purchase-price graph. Actual vendor return terms remain document-specific. [Chevrolet core charges](https://www.chevrolet.com/support/shopping/parts-accessories/core-charge).

### Chart accessibility

W3C recommends text alternatives conveying the information in complex charts, including values and trends. Provide a plain-language trend summary and equivalent table; hover alone is insufficient. [W3C complex images](https://www.w3.org/WAI/tutorials/images/complex/).

Evidence level: sources and repository inspected. Proposed interactions have not been tested with operators or rendered in this turn.

## 3. Current repository foundation

- Migration `065_local_inventory_ledger.sql` already stores `local_inventory_receipt_lines.unit_cost numeric(14,4)` and `line_total numeric(14,2)`, both nullable and nonnegative.
- `local-inventory.service.js:prepareLocalLines` reads reviewed `unitPrice`/`lineTotal`; it rejects credit documents and nonpositive physical receipt quantities. Do not loosen physical receipt validation to support financial credits.
- `local-inventory.repo.js` writes paired local/generic receipt lines with the same ID for invoice receipts, then assigns each serialized unit its `receipt_line_id`.
- Invoice -> receipt -> receipt line -> serialized unit already gives a source-cost route for those receipts. Manually added units may have no invoice/cost; do not assume the paired local line exists for every source.
- `inventory-receipts.repo.js` and `PartSerializationPanel.jsx` provide exact-unit source/history, but inspected detail has no per-unit cost breakdown or price-history chart.
- Current nullable unit cost and line total are raw source facts, not proof of reconciled net cost. Preserve them; add a derived, approved cost record rather than rewriting source evidence.

## 4. Easiest operator flow

### Invoice first

1. Upload invoice and review extracted values in existing source/review workspace.
2. Confirm receipt separately; created units inherit invoice/line links automatically.
3. **Cost summary** shows each part, quantity, unit cost, and line total.
4. Resolve only exceptions: price mismatch, unknown currency, missing cost, ambiguous core charge, or UOM mismatch.
5. **Confirm costs** commits the reviewed allocations without changing physical quantity.

### Inventory first, invoice later

1. Open batch/part/exact unit -> **Add invoice**.
2. Upload once or select an existing reviewed invoice.
3. **Items on this invoice** proposes matches; **Add items** opens searchable Batch -> Part -> Serial checkboxes.
4. Select several parts/batches or only some serials. Parent selections cover children, and effective targets deduplicate server-side.
5. Preview per-part allocations and count/amount still unmatched.
6. **Save invoice links** links evidence only. **Confirm costs** is a separate, explicit value-changing command.

No serial-by-serial price entry for identical units. Use an optional **Different prices** exception only when source evidence supports it. Manual cost estimates require actor, reason, currency, and Estimated status; they do not enter confirmed price trends.

One invoice may cover several batches; one unit may carry multiple supporting documents but cannot receive the same primary acquisition cost twice. A packaging quantity must be resolved before allocating cost to serial units.

## 5. Cost calculation and allocation rules

For each merchandise line:

```text
net merchandise line amount = gross merchandise amount - merchandise discounts
purchase unit cost = net merchandise line amount / normalized covered quantity
delivered unit cost = purchase unit cost + approved allocated acquisition charges
```

- Preserve printed unit price, quantity, extension, discounts, currency, and reviewed version.
- If printed extension already includes discount, do not subtract that discount twice. Conflicting arithmetic needs review; never silently choose the cheaper value.
- Allocate each line only to its matching parts/serials. Selecting two starters and three filters does not divide the invoice total by five.
- Partial coverage: allocating two of four units assigns half the merchandise line amount when equal-price evidence applies. Unlinked amount/quantity stays visible; do not allocate the full four-unit charge to two serials.
- Repeated same-part invoice lines with different prices remain separate cost layers; user may need to identify which serials belong to which line.
- Split deliveries/invoices retain separate billing and receipt quantities. Track outstanding coverage without inventing receipts or collapsing invoice headers.
- Original approved batch cost is an immutable historical snapshot. Show Current reviewed batch cost separately as original plus versioned adjustments, with as-of date; late invoices can price previously unknown items without rewriting the original snapshot. Current remaining-stock cost is a separate measure.
- Shared freight proposal: distribute by net merchandise value over eligible lines, then over their covered quantity. Directly attributed charges take priority. Zero denominator, missing values, or mixed unsupported units require review. Company policy may later choose quantity/weight/volume; do not expose a costing-method menu for every normal invoice.
- Refundable core deposits, recoverable taxes, unrelated fees, and services are separate components by default, not hidden in merchandise price. Delivered-cost policy needs business/accountant confirmation before activation.
- Use PostgreSQL decimal and decimal-safe application arithmetic, not binary floating-point money. Store currency, high-precision calculated rate, and minor-unit allocated totals.
- Distribute rounding remainders deterministically by stable target order. Example: $100 across three units = $33.34, $33.33, $33.33; displayed rate may be rounded but allocated totals must reconcile exactly.
- Missing cost is Unknown, not $0. Explicit $0 requires source evidence (for example no-charge replacement). Do not backfill unknown costs from latest catalog price.
- Preserve original currency. V1 compares and totals within currency; no cross-currency sum. Future conversion needs stored rate, source, effective date, and conversion version.

### Worked example: four starters

```text
Merchandise: 4 x $200                    $800
Freight allocated to these starters       $40
Refundable core charges: 4 x $50         $200
Invoice total, tax omitted             $1,040

Each serial: purchase cost $200; delivered cost $210; core deposit $50 separate
Batch: merchandise $800; delivered $840; core deposits $200
Two approved installations: parts used cost $420, if delivered-cost policy approved
Two unused stock units: tracked stock cost $420
Later core credit: -$100; core-credit balance changes, purchase graph stays $200
```

The $1,040 is invoiced value, not proof of payment. Remaining deposits and actual bank refunds remain separately visible.

## 6. Lifecycle scenarios and cost treatment

| Scenario | Cost behavior |
| --- | --- |
| Same part, new batch at higher price | New layer/price point; old serial costs unchanged |
| Internal transfer | Cost follows serial; no new purchase or usage expense; in-transit counted once |
| Reservation/pending installation | Display planned cost separately; no approved usage-cost posting yet |
| Manager approval | Snapshot cost version against exact usage episode; unknown cost stays flagged |
| Return unused before approval | Release reservation; no usage cost; acquisition cost preserved |
| Return unused after legacy consumption | Compensating quantity and cost events with original usage linkage |
| Unused supplier return | Remove exact physical stock through return command; keep invoice; confirmed credit tracked separately |
| Supplier return awaiting credit | Show returned stock and credit pending; never reduce spending based on a promised credit |
| Installed part removed | Preserve original installation cost; no automatic new acquisition value |
| Recovered/reused part | Show original acquisition reference and incremental refurbishment cost separately; do not charge original purchase again on every reuse |
| Refurbished part installed elsewhere | New usage episode with reused-part tag and approved incremental cost; formal carrying-value allocation remains outside V1 |
| Core returned | Core custody -1 and signed credit remain independent; deposit refund never becomes merchandise discount |
| Core credit denied/partial | Show unrecovered deposit/credit variance separately; no silent change in purchase-price series |
| Warranty replacement at no charge | New serial, explicit zero billed merchandise cost, linked failed unit; show separately from ordinary paid purchases |
| Warranty credit | Link claim and financial adjustment; preserve gross failure/repair history and original cost snapshot |
| Supplier merchandise rebate/correction | New cost-adjustment event assigned to covered units; never overwrite original price observation |
| Invoice arrives after use | Publish priced cost version plus late-cost adjustment referencing original usage; preserve prior Unknown snapshot |
| Invoice error after approval | Append superseding allocation and adjustment, actor/reason; original report remains reproducible |
| Opening count/manual stock | Unknown or explicitly estimated until verified invoice allocation; show coverage gaps |
| Mixed new/used/refurbished purchases | Separate condition series; never imply cheaper used stock is same-price new stock |
| Several units from one invoice line | One purchase-price observation per invoice line, not one duplicate observation per serial |

Reuse reporting is operational, not depreciation/accounting valuation. Aggregate measured usage can inherit source-layer costs only with an approved allocation method; until then mark unallocated rather than guess exact invoice consumption.

## 7. Spending and usage reports

- **Invoiced parts purchases:** net reviewed merchandise lines by invoice date; count invoice line once regardless of number of links or serials.
- **Credits received:** confirmed vendor credit documents by credit date, classified merchandise/core/warranty. Not bank settlement.
- **Net merchandise purchases:** merchandise invoices less merchandise credits in chosen period. Core deposits/refunds excluded and shown separately.
- **Parts used cost:** approved serialized usage snapshots plus visible adjustments. Filter by workorder, asset, location, and period; pending usage not mixed with approved.
- **Tracked stock cost:** known-cost local units in stock/reserved once; in-transit separate; installed/scrapped/vendor-returned excluded. Expose quarantine separately. Recovered unknown carrying values not assigned original purchase value automatically.
- Every total displays known/unknown coverage, e.g. `$1,200 known · 3 units missing cost`. Never present incomplete coverage as complete valuation.
- Invoice costs already expensed operationally must not be counted again as new acquisition when reused. Warranty/core recovery amounts appear alongside gross usage rather than silently erasing it.
- Preserve `effective_at`, `recorded_at`, and report `as_of`. Default usage reports show original approval snapshot plus separate dated adjustments; an optional restated view must be explicitly labeled.
- Purchasing location is invoice/receipt context; usage location is workorder context; current stock location follows custody. Moving parts cannot rewrite historic spending geography.
- V1 reports are operational cost reports, not AP balance, cash flow, margin, tax, or statutory inventory valuation.

## 8. Price-history chart

Default **Purchase price history** in existing part detail, not a new dashboard.

- X-axis: invoice date. Y-axis: net merchandise unit price in explicit currency and canonical/equivalent UOM.
- One point per verified merchandise invoice line; point opens exact invoice, batch coverage, vendor, quantity, and cost breakdown.
- Same catalog identity and condition; do not merge substitute parts or packaging conversions without explicit mappings.
- Source graph shows original verified purchase observations. Corrections supersede with audit badges; later rebates/core refunds are not new negative-price purchases.
- Optional **Delivered cost** view uses confirmed allocation versions and clearly labels freight/tax basis; do not mix purchase and delivered figures within one unlabeled series.
- Basic controls: 3 months / 12 months / All; More filters contains vendor, location, condition, currency. Default 12 months.
- Summary: latest comparable purchase, prior comparable purchase, absolute and percentage change. Example: `$220 each · up $20 (+10%) from prior purchase`.
- Previous value zero -> percentage unavailable. One point -> no trend claim. No purchases in a month -> gap, not $0. No forecast or inferred daily prices.
- Larger datasets: monthly quantity-weighted price `sum(net merchandise amount) / sum(normalized quantity)`, not simple average of serial prices. Show observation count and date bucket; bounded server response, target at most 120 chart points with cursor-paged table.
- Exclude estimates, unknown prices, duplicate/reversed purchase observations, core charges/credits, and free warranty replacements from default paid-purchase series. Keep accessible exception/history views.
- New/used/refurbished and vendor mix can explain change; show filter context. Do not label mix-driven changes as supplier inflation.
- Retain a textual trend summary and **View price table** action with the same data, keyboard-accessible invoice links, and no hover-only values.

## 9. Minimal UI contract

- Exact unit detail: label the basis explicitly, e.g. **Purchase cost $200 · Confirmed**, optional **Delivered cost $210** and **Cost breakdown**. Unknown shows Add invoice if evidence is missing, or Review costs if an invoice is already linked; reviewed legacy-unavailable evidence does not create an impossible upload task. Estimated values show their status.
- Batch detail: `4 units · $840 total · $210 average`, with merchandise/core/freight breakdown available. For mixed parts show grouped subtotals; a mixed-batch average is not a catalog price.
- Part detail: latest comparable purchase price, history chart/table, and existing exact units; no unrelated finance dashboard.
- Invoice review: show compact part rows and one cost summary; all defaults derived, only exceptions expanded.
- Desktop preserves source/review split; phone uses existing compact Document/Review pattern and full-screen item picker. No stacked drawers or nested phone scrolling.
- 44px touch controls, visible save scope, no hidden required errors, focus restoration, and 200% zoom acceptance.
- Operational UX skill guided exception-first cost review and chart-plus-table rather than a new screen for each concept. Geometry and learnability remain unverified until rendered/user tests.

## 10. Data and service ownership proposal

Reuse source records; add typed cost ownership rather than an editable `price` field on catalog or each serial:

- Durable reviewed invoice-line snapshots: stable IDs, signed raw values, line type, currency, revision, evidence.
- `inventory_cost_allocations`: invoice line/version, receipt-line/source-batch targets, normalized quantity, net merchandise amount, method/version, state, actor, expected version, idempotency/request hash.
- `inventory_unit_cost_components`: exact unit + allocation/component; purchase, freight, nonrecoverable tax, discount/rebate, separately referenced core deposit; decimal amount/currency and reversal/supersession.
- `inventory_cost_events`: append-only confirmation/adjustment/reversal, effective/recorded dates and reason.
- `workorder_usage_cost_snapshots`: usage episode + cost version, approved amount, basis, unknown/estimated/confirmed state, adjustment links.
- Receipt lines represent aggregate parts; do not manufacture serialized targets for fluids.
- Current cost and chart views are projections. Enforce company-composite foreign keys, one current primary acquisition allocation per covered quantity/unit, and no overallocated invoice-line quantities/amounts.
- Confirm costs locks document version, affected targets, allocation coverage, and cost versions deterministically. Replays return same result; stale or cross-company targets fail atomically. Never alter quantity/custody during cost confirmation.
- Backfill only exact supported invoice/receipt-line relationships. Null, unmatched, historical text, and manual source stay Unknown. Never bulk reprice existing stock using latest catalog cost.

Canonical frontend owners: `InvoiceExtractionWorkspace.jsx`, `InventoryWorkspace.jsx`, `PartSerializationPanel.jsx`, shared `SecondaryDetailPanel`, existing source-link model. New bounded server cost service/repository composes receipts, document links, exact units, usage episodes, and cost events; neither React nor Odoo controls cost confirmation.

Representative contracts: preview/confirm invoice cost allocations; read exact-unit/batch cost; read catalog price history; read authorized workorder usage-cost summary. Reads return currency/UOM/date basis, coverage, status, as-of version, and source IDs. No raw unrestricted financial payload in shared scanner resolution.

## 11. Permissions

- Office/Admin need explicit company/location inventory-cost read/write rights; changing confirmed costs requires elevated permission and reason.
- Mechanics may use parts without receiving invoice cost, vendor credit, or supplier-document data unless separately granted.
- Apply read restrictions to chart points, totals, exports, tooltips, document links, caches, and source endpoints—not just visible controls.
- A serial transferred to another shop does not automatically authorize destination users to read source invoice containing other locations' costs. Provide permitted line-level summaries; full invoice requires separate document access.
- Proposed capability assignments and separation-of-duty rules are in master Section 17.6. No financial capability is implied by a role name or Units Full access; unconfigured assignments deny until approved.

## 12. Delivery sequence and acceptance

1. **Invoice linkage and stable line IDs:** retain automatic source links; support mixed batch/part/serial selection and explicit document-only save.
2. **Cost allocation foundation:** approved purchase costs, decimal reconciliation, unknown/zero distinction, audit, permissions, no stock mutation.
3. **Per-unit and batch cost UI:** derived values, invoice links, optional breakdown, manual estimate exception and late invoice.
4. **Price history:** comparable paid-purchase series, filters, weighted buckets, accessible table and invoice drilldown.
5. **Operational spending/usage reports:** deduplicated invoice amounts, approved usage snapshots, coverage and date basis; no cash-paid claim.
6. **Landed costs and lifecycle adjustments:** business-approved charge policy, credits, vendor returns, cores, warranty, reuse and late corrections.

Required regression cases before release:

- Four-unit $800 + $40 freight + $200 core example reconciles exactly; core refund leaves $200 purchase-price point unchanged.
- $100 / 3 allocation preserves all cents; repeated replay cannot duplicate cost.
- Two different part lines, partial serial coverage, repeated-price lines, multiple batches, and split receipts cannot allocate the same money twice.
- One invoice linked to 50 units counts once in spending and once per merchandise line in chart, not 50 times.
- Transfer preserves unit cost and invoice lineage; pending install does not post approved usage cost.
- Late invoice after approval creates visible adjustment with original snapshot intact.
- Return, warranty, free replacement, recovered/reused unit, and core deposit are distinct; original purchase is not charged twice.
- Price chart rejects incompatible UOM/currency/condition mixes; unknown month is not zero; prior zero cannot divide by zero.
- Cost-only commands leave quantities, reservations, custody, QR identity, and workorder status unchanged.
- Cross-company, denied costs, restricted source invoice, revoked grants, stale versions, concurrent allocations, and failed transactions pass negative/rollback tests.
- 390/768/1440px, 200% zoom, keyboard, screen reader, long invoices, 500 selected serials, source/table links, and interrupted draft recovery pass rendered checks.
- Five representative non-expert operators should each link an invoice, explain unit vs batch cost, and find the prior purchase with no more than one prompt and no unintended stock mutation. These are proposed gates, not measured results.

No migration number reserved. Rehearse additive migrations/backfill on representative PostgreSQL data before implementation release. Source, tests, migration, deployed health, authenticated UI, and device evidence remain separate gates.

## 13. Decisions still requiring business confirmation

- Delivered-cost inclusion policy for freight, tax, duty, and rebates; default purchase-price view can ship independently.
- Which roles may view/edit supplier costs.
- Whether currency conversion, customer selling prices, AP settlement, or formal valuation are desired later; none implied by this request.
- Aggregate cost-layer allocation and recovered-part carrying value before claiming complete stock valuation.

Normal-flow defaults do not require repeated user choices: invoice-attributed purchase cost, automatic equal allocation within a same-price line, core charges separate, currency-specific reports, unknown cost explicit, source data preserved.
