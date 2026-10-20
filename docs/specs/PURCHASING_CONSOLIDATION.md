# Purchasing consolidation

Date: 2026-10-19. Scope: merge existing purchasing surfaces into one Purchasing destination. No new purchasing, allocation, forecast, accounting, or stock rules.

## Audit

Initial consolidation used source inspection and isolated rendered fixtures. The subsequent split-pane pass also has an authenticated local Admin session available for read-only verification. Neither fixture nor local runtime observations establish hosted delivery or a physical receiving lifecycle.

| Existing surface | Owner | Responsibility | Consolidation |
| --- | --- | --- | --- |
| Needs ordering | InventoryNeedsOrdering | Approved Workorder/stocking demand, source breakdown, selected demand to PO | Expandable section on Purchasing; reuse parent demand response and shop |
| Purchase orders | InventoryPurchases | PO search/filter/checkpoint queue | Left pane on Purchasing |
| New/Edit PO | InventoryPurchases | Supplier, catalog/manual parts, prices, expected date, draft/placement | Existing in-place modal |
| New supplier | InventoryPurchases | Supplier command | Existing contextual editor |
| PO detail | InventoryPurchases | Items, quantities, approval, cancellation, supplier reference | Inline left-pane detail |
| Receive PO | InventoryPurchases + ReceiptLinesEditor | Physical quantities, conditions, identities, exact storage destination | Existing modal via eligible PO action |
| Bill documents | PurchaseOrderBills | Encrypted PO attachments, download, retry-safe upload | Existing PO detail section |
| Inbound My work/Expected/Attention/Complete | InventoryInboundWorkspace | Canonical cross-document arrival/invoice work queue | Right pane on Purchasing; compact view selector |
| Exact receipt/delivery detail | InventoryInboundWorkspace | Selected delivery evidence, exceptions, missing invoice | Preserve exact-source lookup and task/report links |
| No-PO arrival | AddInventoryStockDialog | Existing physical receiving with source evidence | Contextual Record arrival action on Purchasing |
| Invoice intake/review/history | InvoiceExtractionWorkspace | Extraction, review, explicit PO/no-PO routing, receipt posting | Existing embedded workflow; return to Purchasing |
| Direct receipt approval | DirectReceiptApprovalDetail | Scoped financial approval before canonical receiving | Preserve deep-link owner within delivery section |
| Purchase approval settings | PurchaseOrderApprovalSettings | Admin configuration | Remain in Settings; operational page uses existing policy |

### Verified friction

- Needs ordering and PO pages maintain separate location state and repeat the same purchasing read, although that response already includes demand.
- Separate Inbound navigation adds another location selector and four peer views before reaching a receipt or invoice action.
- Seven PO columns spread identity, price and actions across the table.
- Baseline rendered PO list exposes Receive items for draft/awaiting-approval records. Cancelled quantities can appear as All quantities received.
- Command recovery, demand lineage, exact source detail and partial receipt posting are existing capabilities worth preserving.

## Interaction contract

One Purchasing navigation destination, shared shop and refresh, New purchase order, Upload invoice and contextual Record arrival. Needs ordering starts collapsed. Purchase orders and Deliveries & invoices occupy adjacent panes, starting at equal widths. The center divider supports dragging and keyboard resizing; its width preference is saved per actor. Narrow screens stack the panes. No internal purchasing page tabs.

PO table shows order identity/supplier, expected date and state. Selecting an order replaces the left list with its inline detail and loads its exact linked inbound record on the right. Selecting a linked delivery/invoice resolves its exact PO on the left, including orders outside the loaded page or filters. Unlinked documents explicitly show that no PO is linked; extracted text is never used to guess a match. Shop changes and newer selections invalidate stale responses. All orders / All deliveries returns to the lists. Prices, quantities and eligible actions remain in inline PO detail. Receiving is available only for placed orders with outstanding quantities. Draft, approval, received and cancelled records open their appropriate detail actions.

Demand selection carries canonical demand sources into the existing editor. Saved drafts and uncertain commands retain their existing recovery keys. No second stock ledger, invoice processor or receiving command is introduced. The only API extension is an optional strict UUID orderId on the existing company/shop-scoped purchasing read; exact reads bypass list filters and pagination while preserving authorization.

Old inbound URLs and task/report source links must continue to open the relevant panel on Purchasing. Invoice review stays within Inventory's existing embedded workflow; Back returns to Purchasing.

## Acceptance evidence

Recorded after implementation in the inventory living record and external orchestrator task. Required: targeted contracts, frontend build, independent review, isolated rendered normal/empty/error/long-content and 1440/768/390 checks. Real authenticated mutation lifecycle and hosted deployment must be reported separately.

## Deferred feature slices

Editable demand-linked PO revisions, manual truck/Workorder quantity allocation, per-line delivery schedules, projected inventory and PO/delivery/invoice three-way reconciliation remain separate work. Consolidation does not claim these features are delivered.
