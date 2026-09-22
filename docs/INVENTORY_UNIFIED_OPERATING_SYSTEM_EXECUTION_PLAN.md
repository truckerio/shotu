# Inventory Unified Operating System — Execution Plan

**Status:** Complete — locally verified; release pending<br>
**Started:** 2026-09-18<br>
**Authority:** Local implementation and verification only. Commit, push, deployment, hosted mutation, accounting post, and Odoo write require separate authorization.<br>
**Base commit:** `b174c7ad3cc52785e9afb607a864f6f9a31d6c1f`

## Outcome

Deliver one coherent Inventory system whose daily surfaces are Stock, Inbound, Purchasing, Tasks, and Reports, with complete transfer and installed-part removal/reuse cycles. The interface exposes one next action per record while preserving separate PO, invoice, physical receipt, stock movement, custody, and financial evidence.

## Fixed Product Rules

1. Local inventory is authoritative for shop stock, custody, movements, purchasing, and history.
2. A PO authorizes and predicts a purchase. It never changes stock.
3. Invoice Intake can lead directly into receipt confirmation, but an invoice alone never changes stock.
4. The system never creates a PO from an invoice. A purchase made without a PO keeps a permanent `No PO used` classification, reason, actor, approval, and report history.
5. Only confirmed physical receipt, transfer receipt, approved return/reuse release, or count adjustment changes stock.
6. Quantity, Serialized, and Measured/bulk behavior always comes from the saved master-part tracking policy.
7. Accepted, held, rejected, short, and excess quantities remain distinct. Only accepted/released quantities become usable.
8. Every stock movement is company- and shop-scoped, idempotent, auditable, and position-balanced.
9. Workorder demand, financial PO approval, receipt, Workorder reservation, installation, removal, and reuse remain separately authorized events.
10. Routine UI asks only for physical facts, approval, or genuine ambiguity. The server derives status, remaining quantity, next action, owner, tracking, matching, and routine defaults.

## Target Information Architecture

```text
Inventory
├── Stock
│   ├── By part
│   ├── By location
│   ├── Physical count
│   └── Starting inventory
├── Inbound
│   ├── My work
│   ├── Expected
│   ├── Needs attention
│   └── Complete
├── Purchasing
│   ├── Needs ordering
│   ├── Purchase orders
│   ├── Suppliers
│   └── Policies
├── Tasks
│   ├── Damage / inspection
│   ├── Transfers
│   ├── Counts
│   ├── Removed parts / reuse
│   └── Exceptions
└── Reports
    ├── Stock and value
    ├── Purchases and receipts
    ├── No-PO compliance
    ├── Transfers and custody
    └── Part usage and exceptions
```

## Slice Gate

No later slice begins until the active slice has:

- focused model/component/service tests;
- real PostgreSQL coverage for mutations, replay, rollback, tenant scope, and concurrency where applicable;
- authenticated browser verification at 1440px, 768px, and 390px;
- keyboard/focus/error/retry verification for changed interactions;
- regression checks for adjacent Inventory and Workorder behavior;
- independent read-only review with all P0/P1 findings resolved;
- updated evidence in this file and `INVENTORY_ODOO_LIVING_RECORD.md`.

## Slice 0 — Reconciliation And Safety Baseline

**Status:** Complete

### Scope

- Audit every current Inventory surface, route, service, repository, migration, test, and known local-only feature.
- Reconcile duplicate or conflicting flows before changing UI ownership.
- Freeze the lifecycle, permissions, accounting, document, location, and Workorder boundaries above.
- Record the current dirty-worktree baseline and preserve unrelated work.

### Exit Evidence

- Implemented/partial/missing matrix for all target surfaces.
- Canonical owner map and ordered dependency graph.
- Exact verification commands and fixture requirements per slice.
- No code behavior changes in this slice beyond plan and task-state records.

### Audit Result

| Area | Current state | First required work |
|---|---|---|
| Stock and counts | Strong local foundation | Preserve exact-position count ownership and complete responsive proof |
| Inbound | Capabilities exist across several pages | Add one read model, queue, next action, and owner |
| Purchasing | Demand, PO, approval, receipt, and bills exist | Compact the PO and remove duplicated entry choices |
| Tasks | Damage, transfer, and count/task owners exist | Unify owner presentation and exception queues |
| Reports | Operational summaries exist | Add audit links, unassigned backlog, no-PO and lifecycle reconciliation |
| Transfers | Transactional lifecycle exists | Fix exact destination placement before further UI restructuring |
| Removed-part reuse | Strong serialized lifecycle exists | Add full database/browser proof, aggregate policy, reissue clarity, and durable core obligation/credit linkage |

## Slice 0A — Exact Destination Safety

**Status:** Complete — local verified

### Reason

Transfer receipt and damage-task release currently accept a free-text storage reference while physically placing aggregate and serialized stock in `SYS-UNASSIGNED`. This allows a task to complete while shelf/bin truth remains wrong.

### User Result

- Transfer receipt requires an eligible exact destination storage position.
- Damage/repair release requires an eligible exact destination storage position.
- The selected position is applied to aggregate balances and serialized units in the same transaction.
- System, receiving-use, inactive, non-storable, non-pickable, cross-company, and cross-shop positions are rejected.
- Free text remains a handoff/provider/reference field and cannot claim to be the physical bin.

### Gate

- Schema and service negatives for missing/invalid destinations.
- Disposable PostgreSQL proof for aggregate and serialized partial transfer receipt, release, rollback, replay, position/shop reconciliation, and exact unit placement.
- Responsive authenticated browser proof for destination selection and stale/error recovery.
- Independent review before Slice 1 begins.

### Completion Evidence

- Backend commands now require `targetPositionId` for transfer receipt and damage release. The canonical placement helpers lock and revalidate same-company, same-shop, active, non-system, pickable storage positions before aggregate or serialized stock is restored.
- Invalid destination classes, missing targets, stale state, changed replay payloads, and serial mismatches roll back without changing the task, stock balance, exact unit, or position movement. Exact retries remain idempotent and partial transfers remain in transit until complete.
- Focused model, service, route, and contract tests passed 46/46; adjacent direct-receipt tests passed 17/17; three fresh migrated PostgreSQL lifecycle tests passed for aggregate and serialized transfer/release placement, rollback, replay, and target drift.
- Authenticated Playwright passed at 1440×1000, 820×1180, and 390×844 with eligible-only destinations, required-field gating, keyboard order, stale shop reset, no horizontal overflow, and no page or Inventory API errors. Temporary QA accounts and fixture rows were cleaned and the database reported zero remaining fixture rows.
- The production build and diff check passed. Independent fingerprint-stable review returned PASS with no remaining substantive findings.

## Slice 1 — Inventory Shell And Unified Inbound Read Surface

**Status:** Complete — local verified

### User Result

- Inventory navigation becomes Stock, Inbound, Purchasing, Tasks, and Reports.
- Expected deliveries move from Purchasing into Inbound.
- Add inventory, invoice upload, PO receipt, and goods-arrival entry points open the same Inbound context.
- Desktop uses a stable list/detail workspace; phone uses list then full-screen detail.
- Each row shows supplier, shop, PO/no-PO truth, invoice, receipt progress, next action, and owner.

### Architecture

- Build a bounded server-derived Inbound read model from existing PO, invoice allocation, receipt, position, and task evidence.
- Persist only workflow assignment/exception metadata that cannot be safely derived.
- Preserve all existing mutations during this read-surface slice.

### Gate

- Read projection authorization/tenant tests.
- Contract tests for navigation and elimination of duplicate global actions.
- Authenticated populated browser evidence at all target widths.
- Existing PO, invoice, direct receipt, and count regressions pass unchanged.

### Completion Evidence

- Inventory navigation now presents Stock, Inbound, Purchasing, Tasks, and Reports in that order. Add inventory and Upload invoice belong to Inbound, while Purchasing contains only Needs ordering and Purchase orders.
- The new read-only Inbound projection joins canonical PO, allocation, invoice, local receipt, and delivery evidence without creating a second mutation owner. It derives Expected, My work, Needs attention, and Complete; exposes the next action and owner; and preserves permanent `No PO used` evidence.
- PO-backed invoices remain on their PO row. Direct goods-first arrivals, posted no-PO receipts, unmatched invoices, partial receipts, condition exceptions, and complete POs retain distinct truthful states. Mixed UOM records show unit-type breakdowns instead of a false summed quantity.
- Focused frontend, service, route, and projection tests passed 35/35. Expanded disposable PostgreSQL integration passed expected/partial/complete PO, held/rejected/short receipt, direct no-PO, posted no-PO invoice, unmatched invoice, allocated-invoice coalescing, global counts, search, cross-scope, detail 404, and proof that the read surface does not mutate stock.
- Four additional fresh-database regressions passed for direct-receipt role boundaries, concurrency and rollback, invoice-allocation races, and count-import evidence. Adjacent focused tests passed 62/62 and the production build passed.
- Authenticated Playwright passed at 1440×1000, 820×1180, and 390×844, including section order, keyboard entry, PO receipt and invoice handoffs, truthful no-PO attention state, no overflow, and no page or Inbound API errors. QA accounts and fixtures were removed.
- Independent review found one HIGH workflow classification defect for unmatched invoices. The row now derives `resolve_no_po`, appears in Needs attention, remains owned by Purchasing, and keeps Open invoice as its action. Final fingerprint-stable review returned PASS.

## Slice 2 — Compact Purchase Order

**Status:** Complete — local verified

### User Result

- Needs ordering pre-fills shop, parts, quantities, UOM, tracking, and demand sources.
- Routine user chooses supplier and selects Create order.
- PO number, currency, shop, demand lineage, approval requirement, and routine defaults are server-derived.
- Expected date, price, notes, terms, and supplier reference live under More details.
- Drafts recover automatically; the UI has one final action.
- Approval appears only when policy requires it.

### Gate

- Demand-to-PO lineage and lock/recalculation tests.
- Approval, replay, stale-version, cross-company, and cross-shop negatives.
- Browser flows from Workorder demand, stocking policy, mixed demand, and direct exceptional PO.

### Completion Evidence

- Needs ordering now starts a new supplier-scoped PO and uses `Create order` consistently. It never claims to append canonical demand to an existing linked draft.
- A demand-backed editor keeps selected immutable demand lines, Supplier, and one Place order action above the fold. Optional price, configured currency, expected date, notes, and supplier creation live under More details. Direct exceptional POs retain the full part editor.
- Shop, catalog part, UOM, tracking, PO number, demand lineage, approval routing, and configured approval currency remain server-derived or server-revalidated. Unknown line price is preserved as Unknown and forces the authorized approval path; expected delivery date is optional.
- Demand drafts survive tab navigation, asynchronous location loading, and full page reload through a session-specific saved handoff. Successful placement consumes both the handoff and its draft, after which New purchase order opens a fresh exceptional editor.
- Focused frontend/backend contracts passed 39/39. The current fresh-database Inventory workflow gate passed 10/10, including demand locks/deduplication, replay, stale version, scope, approvals, no-stock PO behavior, receiving, condition exceptions, and bills. Retired standalone request tests and obsolete status expectations were removed from the current gate.
- Chrome browser QA passed the compact demand flow at 1440×1000, 768×1024, and 390×844, including async locations, tab and reload recovery, one-action placement, immediate exceptional PO availability, keyboard use, no overflow, and no page errors. The direct exceptional PO editor passed at all three widths.
- Production build and diff check passed. Independent review found post-success and reload draft-lifecycle defects; both were fixed, reverified, and final fingerprint-stable re-review returned PASS.

## Slice 3 — Unified Inbound Entry And Truthful No-PO Flow

**Status:** Complete — local verified

### User Result

- New inbound offers Upload invoice, Receive against PO, or Record goods arrival.
- Invoice upload automatically searches existing POs and authoritative catalog parts.
- A missing PO becomes permanent `No PO used` evidence; the system never manufactures one.
- No-PO receipt requires reason, purchaser, approval when policy requires it, and physical confirmation.
- Invoice-first waits for goods; goods-first waits for invoice; both remain one visible inbound record.

### Gate

- Explicit proof that invoice-only never changes stock and never creates a PO.
- Matched, unmatched, ambiguous, duplicate, and cross-scope invoice tests.
- No-PO reason/approval/replay/report projection tests.
- Full authenticated browser paths with file upload, recovery, and refresh.

### Completed Integrity Fixes

- A direct receipt that identifies a PO line currently validates that line but is later recorded as a no-PO receipt without advancing the PO. Slice 3 must route it through the canonical PO receipt accounting path.
- A reviewed invoice with no posted allocation is currently labeled `No PO used` before the user chooses that route. It must remain `PO decision needed` until canonical no-PO receipt evidence exists.
- Standalone direct arrivals currently save a generic no-PO explanation. They must require and retain the operator's reason, purchaser/receiver evidence, and configured approval authority.

### Verification

- Direct PO receipts now advance the locked PO line and order and retain delivery/allocation evidence; standalone receipts require durable operator no-PO reason and configured approval authority.
- Unallocated reviewed invoices stay `PO decision needed` until a canonical no-PO receipt exists. Invoice review/upload remains non-mutating.
- Focused UI/service/route tests passed, the fresh PostgreSQL Inventory workflow gate passed 11/11, and the production build and diff check passed.
- Authenticated Inbound and direct-arrival recovery passed at 1440×1000, 820×1180, and 390×844.
- A local-only real file-upload gate passed through the authenticated app/API, encrypted source persistence, background extraction queue, loopback OCR boundary, refresh/source recovery, and zero inventory mutation at all three widths. Anonymous upload/source returned 401 and QA run/job/account residue was zero.
- Final independent review passed at fingerprint `3c1472b4…` after cleanup-failure propagation and exact OCR-result assertions were added.

## Slice 4 — Physical Receipt, Batch Cost, And Put-Away

**Status:** Complete — verified locally on 2026-09-19

### User Result

- One receipt editor handles PO, invoice, and authorized no-PO arrivals.
- Partial, available, held, rejected, short, wrong, and excess quantities remain truthful.
- Quantity, Serialized, and Measured/bulk inputs branch from catalog tracking.
- Invoice/PO price evidence is stored with the receipt batch; missing cost remains Unknown.
- Receiver can leave accepted stock in Receiving or place it into an eligible exact aisle/shelf/bin.
- Invoice documents remain attached to the batch and exact serials for warranty/history.

### Gate

- Disposable PostgreSQL tests for partial episodes, replay conflict, concurrent over-receipt, target-position rollback, serial uniqueness, aggregate balances, and cost lineage.
- Scanner/manual serial and responsive put-away browser evidence.
- Position totals reconcile with shop totals after every path.

## Slice 5 — Stock And Physical Count Completion

**Status:** Complete — verified locally on 2026-09-19

### User Result

- By part and By location remain peer modes.
- Every location can show direct or subtree stock.
- Physical counts are assigned by exact position with counted, expected, difference, actor, and reason.
- Movements after the count watermark mark affected lines Needs recount.
- Starting inventory remains a reviewed count import with no master-part fabrication.

### Gate

- Count watermark/concurrency, position reconciliation, serial identity, measured precision, and import rollback tests.
- Browser counts at nested area/aisle/shelf/bin levels and keyboard/scanner flows.

## Slice 6 — Inventory Tasks And Exception Ownership

**Status:** Complete — verified locally on 2026-09-19

### User Result

- My work shows only actions owned by the current actor/capability.
- Damage, inspection, receipt exceptions, missing invoice, no-PO approval, transfer receipt, recount, and removed-part custody share one task pattern.
- Each task shows source, age, shop, owner, next action, and blocking reason.
- Generic backend state names do not appear in routine UI.

### Gate

- Capability/RBAC matrix, assignment visibility, stale action, replay, cross-tenant, and negative-action tests.
- Responsive browser verification for every task kind and empty/loading/error states.

### Completion Evidence

- One normalized task projection now derives damage, receipt exceptions, unresolved invoice decisions, durable no-PO approvals, transfer receipt, position recount, and removed-part custody from their canonical records. Actor, company, shop, module access, capability, assignment, and current source state are revalidated server-side.
- Migration 166 adds immutable no-PO approval requests: requesting approval changes no stock, authorized approval posts the original command once, rejection/cancellation retain evidence, and replay, stale catalog/target/serial, cross-scope, and concurrent decisions fail closed. Held and damaged arrivals remain outside usable stock and expose their inspection disposition.
- Migration 167 adds versioned assignment/claim/unassign evidence without duplicating task state. Canonical source rows are locked before assignment changes; invalid owners recover; state-specific custody capabilities and Workorders module access remain authoritative.
- Exact deep links open canonical Inbound, damage, transfer, count, and custody records, including records beyond the first page. Closing or pressing Escape removes the task route state without reopening it.
- Focused UI, model, route, service, migration, approval, and task tests passed. Fresh disposable PostgreSQL receiving workflows passed 12/12. The full unit gate passed 2,276 with 75 intentional skips and zero failures; structure, production build, and diff checks passed.
- Authenticated task and no-PO browser journeys passed at 1440, 820, and 390 widths, including assignment, stale recovery, exact-source navigation, held/damaged approval truth, refresh, overflow, and cleanup. Independent review passed after the final shared Dropdown correction. Frozen 50-path manifest fingerprint: `4caf86fd…`.

## Slice 7 — Transfer Full Cycle

**Status:** Complete — verified locally on 2026-09-19

### User Result

- Source selects destination, parts, quantities/exact serials, and transport holder.
- Dispatch creates transfer-out custody and in-transit state.
- Destination receives by scan/count, records discrepancy, and puts away.
- Partial receipt, damage, short, extra, cancellation, and reconciliation remain explicit.
- Destination cannot see protected exact serial details before authorized arrival where blind receiving applies.

### Gate

- Aggregate and serialized send/in-transit/partial-receive/final-receive PostgreSQL tests.
- Concurrent source allocation and destination receipt negatives.
- Cross-shop authorization, blind projection, scan-all, discrepancy, and responsive browser proof.

### Completion Evidence

- Dispatch now freezes tracking/UOM, requires exact aggregate source allocations or serialized identities, records provenance, and moves stock into explicit in-transit custody. Destination receiving requires an eligible exact position for good stock and a non-pickable hold position for damaged or unexpected stock.
- Partial receipts, blind serialized receiving, damage, shortage, extra goods, incremental recovery/loss classification, return-to-source, exact put-away, replay, concurrency, custody drift, and source/destination authorization remain in the canonical stock-task lifecycle. Ordinary goods received after a shortage report do not falsely clear the missing quantity.
- Transfer state and outcomes project into Tasks and Reports. Part detail exposes the short Transfer stock entry while discrepancy and return controls remain secondary.
- Invoice review uses the full Inventory workspace. Processing, review, unmatched, posted, and reversed invoices now share the canonical server-side Inbound projection with server pagination/counts, allocation/receipt deduplication, truthful status, and Open invoice history access.
- Full unit gate passed 2,282 with 78 intentional skips and zero failures. Fresh disposable PostgreSQL receiving workflows passed 15/15; focused Inbound PostgreSQL and 64 affected frontend contracts passed; structure, production build, and diff checks passed.
- Authenticated Inbound and complete transfer journeys passed at 1440×1000, 820×1180, and 390×844 with no overflow and full fixture/account cleanup. Independent review passed against the frozen 23-file fingerprint `8d5ed63e…` after shortage-recovery, pagination/count, reversed-deduplication, and completed-history findings were fixed.

## Slice 8 — Installed-Part Removal, Custody, Inspection, And Reuse

**Status:** Complete — verified locally on 2026-09-19

### User Result

- Unit detail is the primary removal entry.
- Removal records exact installed part, reason, actor, unit, and Workorder/installation lineage.
- Removed never means available.
- The cycle is removal → handoff → physical receipt → inspect → repair/core/scrap/quarantine/release → put-away → available/reissue.
- Reusable release requires catalog policy and inspection evidence.
- Post-approval removal never silently restores stock; pre-approval return follows its existing safe accounting path.

### Gate

- Full exact-unit PostgreSQL lifecycle, replay, same-actor policy, permission, lock-order, custody, balance, and reissue tests.
- Unit-detail removal and Parts task browser walkthrough at all widths.
- Workorder close/reservation/install/remove regressions.

### Completion Evidence

- Exact serialized removals now retain unit, Workorder, installation, actor, reason, and custody lineage. Physical receipt stops at inspection; release requires inspection evidence and an eligible exact storage position.
- Repair, core, scrap, hold, quarantine, and release stay explicit. Core and scrap never become available stock, and release updates exact position, shop stock, custody, movement, and audit evidence atomically.
- Focused contracts passed 47/47; serialized PostgreSQL lifecycle and authorization gates passed 17/17 and 7/7; production build and diff checks passed.
- Authenticated removal, receipt, inspection, and exact release passed at 1440, 768, and 390 widths. Independent review found and closed a product-module authorization bypass. Final 25-file fingerprint: `465984a9…`.

## Slice 9 — Reports, Compliance, And Operational Completion

**Status:** Complete — verified locally on 2026-09-19

### User Result

- Reports reconcile stock, positions, open POs, receipt batches, invoice cost, tasks, transfers, and reuse custody.
- No-PO reporting shows amount, shop, vendor, purchaser, reason, approver, and trend.
- Exceptions link back to their operational record.
- Unknown data remains Unknown rather than zero.

### Gate

- Bounded query/performance checks and reconciliation totals.
- Role/tenant visibility tests.
- Export and responsive report browser checks.

### Completion Evidence

- One read-only, repeatable-read report now reconciles shop stock with exact-position totals by part and UOM, and separately projects open POs, receipt batches/cost coverage, open tasks/exceptions, transfers, removed-part custody, bills, and cost completeness.
- No-PO evidence includes direct receipts plus pending/rejected approval records, receiver, approver, reason, vendor/amount when known, status, shop, canonical record links, and a bounded 12-month trend. Missing evidence remains Unknown.
- All projections are company/shop scoped and bounded. The single CSV contains every loaded section and neutralizes spreadsheet formulas.
- Focused report and adjacent contracts passed 34/34; the real local PostgreSQL schema query, full unit gate, receiving and reuse PostgreSQL gates, structure, build, and diff checks passed. Authenticated refreshed-server browser checks passed at 1440×1000, 768×1024, and 390×844 with export, keyboard, error, overflow, and cleanup coverage. Final 11-file fingerprint: `511cd72f…`. Independent review corrections included partial-PO commitments, currency-scoped No-PO totals, terminal-transfer task filtering, canonical vendor evidence, exact count-task links, receipt-backed cost coverage, and strict browser success assertions.

## Slice 10 — Final System Verification

**Status:** Complete — locally verified on 2026-09-19

- Fresh database migration and replay.
- Representative populated legacy-data rehearsal.
- Full unit/integration/build/structure/diff checks.
- Authenticated end-to-end walkthrough across Stock, Inbound, Purchasing, Tasks, Reports, transfer, and removal/reuse.
- Desktop, tablet, and phone geometry plus keyboard, scan fallback, refresh, retry, and recovery.
- Independent architectural review and adversarial data-integrity review.
- Update canonical documentation with exact IMPLEMENTED, VERIFIED, and RELEASED boundaries.

### Completion Evidence

- Final full unit gate passed 2,295 tests with 80 intentional skips and zero failures. Disposable PostgreSQL receiving workflows passed 15/15; focused reports passed 34/34; production build and diff checks passed.
- Authenticated Reports passed at 1440×1000, 768×1024, and 390×844 after a server restart, including API success, export, keyboard, error, overflow, and account cleanup.
- Independent review found and closed partial-PO commitment, multi-currency No-PO, terminal transfer, vendor lineage, count deep-link, shortage cost-coverage, browser-proof, and documentation-boundary issues. Final Slice 9 fingerprint `511cd72f…` and global architecture/data-integrity review passed.
- This is local verification only. No commit, push, deployment, production mutation, accounting post, or Odoo write occurred.

## Global Acceptance Criteria

1. No user must re-enter a fact already known from Workorder demand, PO, invoice, catalog, receipt, or shop context.
2. Every routine record exposes one next action and one owner.
3. No invoice-only, PO-only, approval-only, or recommendation-only action changes stock.
4. Every quantity change reconciles receipt/custody/movement/position/shop totals.
5. No-PO evidence remains permanent and reportable; no automatic or retroactive PO is created.
6. Quantity, Measured/bulk, and Serialized follow their tracking-appropriate receipt, count, transfer, and Workorder paths. Exact installed-part custody, removal, and reuse are Serialized-only; aggregate corrections use authorized return or count owners.
7. Partial and exception states survive refresh, retry, concurrency, and later completion.
8. Tenant, shop, role, module, and assignment boundaries fail closed.
9. Existing Workorder lifecycle and inventory authority remain compatible.
10. Every slice passes its gate before the next slice begins.

## Execution Log

| Slice | Status | Implementation evidence | Test evidence | Browser evidence | Review |
|---|---|---|---|---|---|
| 0 | Complete | Three parallel read-only audits reconciled | 2 task/report tests, 82 reuse-focused tests and build passed in audits | Existing evidence only | Audit complete; one P1 identified |
| 0A | Complete | Exact position required and atomically applied to aggregate/serialized transfer receipt and damage release | 46/46 focused, 17/17 adjacent, 3/3 fresh PostgreSQL lifecycle tests; build/diff pass | Authenticated 1440/820/390 destination, keyboard, stale/error, overflow pass | Independent fingerprint-stable PASS |
| 1 | Complete | Ordered shell and read-only canonical Inbound projection with truthful PO/no-PO/action/owner states | 35/35 focused, 1 expanded PostgreSQL integration, 4 fresh-database regressions, 62/62 adjacent; build/diff pass | Authenticated 1440/820/390 navigation, handoff, keyboard, error and overflow pass | HIGH unmatched-invoice classification fixed; final PASS |
| 2 | Complete | Compact demand PO, server approval defaults, session/reload draft recovery, direct exceptional compatibility | 39 focused contracts, 10/10 fresh PostgreSQL workflow gate; build/diff pass | Chrome 1440/768/390 compact and exceptional flows, async locations, reload, keyboard, no overflow | HIGH post-success and MEDIUM recovery findings fixed; final PASS |
| 3 | Complete | PO/no-PO truth, approval, replay, Inbound projection, direct-arrival recovery | 33 focused, 11/11 fresh PostgreSQL workflows, 40 invoice contracts; build/diff pass | Authenticated Inbound, direct receipt, and real invoice upload/reload at 1440/820/390 | Final fingerprint-stable PASS |
| 4 | Complete | Shared line receipt, exact put-away, immutable cost/document lineage | 121 focused; 11/11 fresh PostgreSQL; build/diff pass | Authenticated 1440/820/390 PO, invoice, direct receipt | Independent 29-path manifest PASS |
| 5 | Complete | Exact-position counts and reviewed starting inventory | Focused and fresh PostgreSQL count/import gates; build/diff pass | Authenticated 1440/820/390 nested count/import | Independent `938283b4…` PASS |
| 6 | Complete | Durable no-PO approval, normalized actor-aware task queue and exact deep links | Full unit 2,276 pass/75 skip/0 fail; fresh PostgreSQL 12/12; structure/build/diff pass | Authenticated 1440/820/390 task, approval, exact navigation and cleanup | Independent 50-path `4caf86fd…` PASS |
| 7 | Complete | Canonical transfer lifecycle with exact source allocation, in-transit custody, blind/partial receiving, discrepancies, return, loss, and exact put-away | Full unit 2,282 pass/78 skip; fresh PostgreSQL 15/15; focused Inbound 64; structure/build/diff pass | Authenticated Inbound and transfer 1440/820/390 pass with cleanup | Independent `8d5ed63e…` PASS |
| 8 | Complete | Exact installed-unit removal, handoff, receipt, inspection, disposition, and exact-position release | Focused 47/47; serialized PostgreSQL 17/17; authorization 7/7; build/diff pass | Authenticated removal/reuse 1440/768/390 pass | Authorization finding fixed; independent `465984a9…` PASS |
| 9 | Complete | Scoped reconciliation, purchasing/receipt/task/custody evidence, no-PO history/trend, canonical links and full safe export | Focused 34/34; real PostgreSQL query; full unit 2,295 pass/80 skip; receiving 15/15; reuse 17/17; structure/build/diff pass | Authenticated 1440/768/390 refresh, export, keyboard, error, overflow and cleanup pass | Review findings fixed; frozen 11-file `511cd72f…` independent PASS |
| 10 | Complete | Final local verification and canonical documentation reconciled | Full unit/DB/structure/build/diff pass | Final Reports plus prior slice browser evidence pass | Independent architecture/data-integrity PASS; no findings remain |
