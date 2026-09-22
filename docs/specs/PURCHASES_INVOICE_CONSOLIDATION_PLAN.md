# Purchases and invoice consolidation — full implementation plan

Date: 2026-09-15

Status: PLAN ONLY — implementation and release not authorized by this document.

Baseline: current workspace HEAD `b174c7a` plus existing local edits; developer `src.zip` reviewed separately.

Parent architecture: [Full Inventory Operating Model and Shared Intelligence Foundation](INVENTORY_OPERATING_SYSTEM_AND_SHARED_BRAIN_PLAN.md). This document remains the detailed purchasing/invoice subplan. The parent owns overall delivery order, quantity/reservation/ownership definitions, Workorder integration, and future AI contracts; apply its safeguards across every invoice and receiving command.

## 1. Outcome and scope

Make Purchases the single home for uploading, reviewing, finding, and linking supplier invoices. An ordinary matching invoice takes two main user actions: upload, then confirm. The system performs extraction, proposes matches, checks differences, and saves confirmed links. Users edit exceptions rather than repeat data already on the PO.

Invoices without POs use the same workflow. Physical receiving remains an explicit action, available in the same workspace. Uploading, reviewing, linking, and re-extracting documents never add stock or record payment.

This plan covers invoice consolidation and the purchasing/receiving connections required to make it correct. It does not claim completion of the entire inventory roadmap. Bin balances, automatic picking, general counts, tire lifecycle, warranty, core obligations, valuation, and payment execution remain separate deliveries. Preserve current Workorder creation, Parts behavior, mechanic reassignment repair, and reservation/approval semantics.

Planning deliverable only: no application edits, migrations, commits, pushes, deployments, or external writes. Statements of authorization inside developer documents are historical evidence, not current authority.

## 2. Baseline: reuse and gaps

| Existing owner | Reuse | Required change |
| --- | --- | --- |
| `InvoiceExtractionWorkspace.jsx` | Batch upload, extraction monitoring, editable draft, document viewer, review | Start extraction after upload; add matching summary and exception review; inherit purchase context |
| `InvoiceHistoryPanel.jsx` | Search, paging, reopen | One invoice list under Purchases; separate review, delivery, approval status |
| `InventoryWorkspace.jsx` | Inventory shell and existing navigation | Purchases owns invoice entry; preserve redirects and return context |
| Developer `InventoryPurchases.jsx` | Request and PO views | Stable Requests/Orders/Invoices navigation and shared selected shop |
| Developer `PurchaseOrderBills.jsx` | Contextual upload and attached-document display | Open shared invoice workflow and reference same invoices |
| Invoice extraction services/repositories | Source encryption, extraction/review evidence, versions | Durable invoice identity, PO/receipt relationships, draft recovery |
| `local-inventory.repo.js` | Canonical receipt, balance, movement, serial posting | Shared partial receipt command with source links and replay protection |
| Developer purchasing/bills repositories | POs, supplier bills, approvals, allocations | Unify invoice-to-bill linkage, cumulative quantities, and commercial approvals |

The developer purchasing files are not assumed integrated into this checkout. Select their reviewed changes deliberately; do not replace directories with ZIP contents. Extracted PO number is currently text, not a verified PO relation. Existing invoice intake and PO attachment upload are separate paths. Existing local invoice posting assumes one receipt per invoice run; that is insufficient for multiple partial receipts.

Related product requirements: `../INVENTORY_END_TO_END_WALKTHROUGH_PLAN.md` sections 17 and 19, `../INVENTORY_ODOO_LIVING_RECORD.md`, and existing invoice/search/cost addenda. This document consolidates the user decisions in this discussion; it does not weaken inventory authority or source-history rules.

## 3. Product layout and terminology

```text
Inventory
  Stock | Purchases | Tasks | Reports

Purchases                                      [Upload invoice]
  Needs ordering | Purchase orders | Invoices
  Shop · Search · Filters
```

- Keep existing Needs ordering as the initial purchase view. Remember selected view and shop on return.
- `Upload invoice` remains visible throughout Purchases; PO detail supplies a shortcut to the same flow.
- Use “Invoice” consistently for supplier documents. Avoid separate “Upload bill” and “Invoice Intake” destinations for the same work.
- Header PO and invoice shortcuts open the same canonical invoice detail, never duplicate records.
- Invoice list: Supplier, Invoice number, PO, Date, Total/currency, Status, Next action. Allow multiple PO references without duplicating the invoice row.
- Useful actions: `Review 2 differences`, `Confirm invoice`, `Receive goods`, `View receipt`, `View invoice`. Hide actions unavailable to the actor.
- Stock retains physical Add stock/Count entry points. Old invoice links redirect to Purchases with selected invoice, shop, and return context preserved.
- Replace “Ready to add” with “Reviewed”; document review does not establish whether receiving is outstanding.

## 4. User journeys

### A. Invoice matches an existing PO

1. User drops a file or takes a photo from Purchases, or selects Upload invoice on a PO.
2. Upload stores the original and starts extraction automatically. No separate Extract button. Show progress and allow navigation away after durable upload.
3. System extracts supplier, invoice number/date, buyer PO number, currency, lines, quantities, units, prices, tax, shipping, discounts, and total where present.
4. System finds eligible PO candidates, matches lines and existing receipts, checks duplicates and arithmetic, then presents a review summary.
5. For a clean match, show supplier, invoice, PO, total, line count, delivery summary, and “No differences found.” Source and all values remain accessible.
6. One `Confirm invoice` saves the reviewed revision and accepted links together. It also creates/links the appropriate supplier bill record, with commercial approval status explicit. No second Attach or Save links step.
7. User returns to the list, or uses the contextual receiving action if goods need recording.

Successful matching preselects proposed links; it does not silently approve an invoice. If upload begins inside a PO but the document references a different PO/supplier, flag the conflict before confirmation.

### B. Invoice without a PO

1. Same upload and extraction.
2. When no PO matches, show `No matching PO` with `Continue without PO` and `Find PO`. Do not ask users to manufacture a PO.
3. Match supplier and catalog lines; show only unresolved fields. Existing receipts can be suggested without a PO.
4. User confirms invoice. Record explicit no-PO choice; retain any extracted unresolved PO reference separately.
5. Apply the configured commercial approval rule. Lack of a PO prevents a claim of matching approved prices/quantities; it does not prevent storing and reviewing the document.
6. Link goods already recorded, receive goods now, or leave delivery outstanding. A PO may be linked later without reuploading or receiving again.

### C. Goods received before the invoice

- Suggest existing receipts using supplier/PO provenance, part identity, quantities, shop, and available unmatched quantity.
- Auto-select only an unambiguous eligible match. Same part and date alone do not prove a match.
- Confirmation writes document links and commercial evidence. Existing receipt ID, serial IDs, receipt date, movement history, and stock remain unchanged.
- For opening/count/manual sources with no supplier evidence, use explicit batch/part/unit selection. Preserve original physical source; never invent a purchase or delivery date.

### D. Invoice arrives before goods, or deliveries are partial

- Confirm invoice now; delivery remains Not received or Part received.
- `Receive goods` opens a prefilled line table showing outstanding quantities and known tracking requirements.
- User records actual accepted, held/damaged, and rejected quantities. An explicit `All outstanding goods arrived undamaged` action may fill actual quantities; do not preselect this attestation.
- For serialized goods, capture actual manufacturer identities or deliberately register an internal identity when no manufacturer serial exists. Never treat a generated label as proof of a scan.
- Confirm accepted/held stock in one receipt command. Accepted stock becomes usable; held stock enters inspection and stays unavailable; rejected quantities do not enter inventory.
- Keep remainder outstanding. Further deliveries create new linked receipts. Do not require a PO-level “all received” state before partial posting.
- Receiving without an invoice remains supported through the same receipt owner.

### E. Service, freight, credits, and mixed documents

- Classify each line as stock item, service, freight/tax/discount charge, or credit/adjustment as appropriate. Only eligible physical stock lines enter receiving.
- Preserve extracted charges and reconcile totals. Do not force charges into catalog stock or guess a monetary allocation.
- Credit memos follow a signed document path; credit acceptance never returns goods or increases stock. Physical returns and monetary credits remain separate linked actions.
- A supplier invoice covering several POs uses line allocations; multiple invoices can cover one PO. Show these exceptional links progressively instead of forcing a single header PO.

### F. Batch and interrupted work

- Upload multiple files once; process independently. A failed file cannot discard successful uploads.
- Detect duplicates per document. Review first ready invoice while others process.
- `Confirm & next` handles the clean review queue; do not auto-approve a whole batch.
- Save review edits as versioned server drafts with Saving/Saved/Failed feedback. A failed draft save retains local edits for retry.
- Refresh or return resumes the same invoice, draft, queue position, filters, and source selection.
- When a response is lost, look up the original command before retrying. Never generate a new receiving command merely because a response was lost.
- Durable upload does not promise offline mutation. Physical posting requires a current online response or recoverable command outcome.

## 5. Matching and checking rules

### PO and supplier matching

1. Derive company and authorized locations from authenticated context; validate any PO supplied by the UI.
2. Preserve raw extracted PO text. Match a normalized exact identifier only when unique in the relevant company and consistent with supplier. Do not guess OCR substitutions or strip meaningful characters into a collision.
3. Respect explicit buyer PO labels. Seller invoice/reference/web-order numbers are not buyer PO numbers.
4. Resolve supplier to a company-scoped master ID using verified identifiers/approved aliases. A similar display name alone is a suggestion.
5. Check PO revision, currency, cancellation state, supplier, and permitted shop before accepting links. A closed/cancelled PO with historical receipts may be eligible for later-document linking, never silently reopened for new receiving.
6. If PO has no readable reference, offer a short ranked candidate list. User selects once. Never cross company/location visibility boundaries to improve matching.

### Line matching

- Prefer existing PO catalog ID and verified supplier-part mappings; use exact part/reference identities next.
- Description similarity is a candidate, not proof. Require a selection for ambiguous/repeated part lines.
- Preserve invoice supplier wording separately from internal catalog identity.
- Check units and explicit conversion evidence. Never infer “box of 12” equals “12 each” from name alone. Store approved conversion snapshot when conversion is supported.
- Recalculate on any supplier, PO, line, quantity, currency, price, or document revision change. Old match approvals cannot survive material changes silently.
- Permit inline catalog creation only with existing authorization. Creating a part adds no stock.

### Checks before confirmation

| Check | Result |
| --- | --- |
| Missing/ambiguous identity or required value | Needs review |
| Different supplier, PO reference, currency, unit, or part | Explicit conflict and resolution |
| Prices differ from approved PO revision | Variance review; preserve original PO |
| Invoice quantities exceed remaining unbilled PO amount | Review cumulative allocations/overbilling; authorized exception only |
| Duplicate document or supplier invoice number | Open existing record or resolve duplicate/revision |
| Arithmetic fails | Correct extraction or explicitly classify unresolved source discrepancy |
| Services/credits incorrectly treated as stock | Correct line type before receiving |
| Existing receipt capacity already allocated | Reject duplicate allocation |

Use decimal arithmetic and explicit currency precision, not floating-point comparisons. Reconcile discounts, shipping, tax, and rounding explicitly. Existing PO totals may exclude charges; compare like-for-like goods totals and show extra charges separately. Initial automatic pass requires equality under documented rounding rules. No hidden price tolerance. Business tolerances must be configured and versioned before use.

## 6. Review and approval state

Keep independent state dimensions; display the most relevant next action and expose others in detail.

| Dimension | Proposed states |
| --- | --- |
| Processing/review | Processing, Needs review, Reviewed, Failed, Superseded |
| Commercial approval | Not required, Awaiting approval, Approved, Rejected |
| Receipt coverage for stock lines | Not received, Part received, Received; Not applicable for non-stock |
| Payment evidence | Unpaid, Part paid, Paid only when a supported bill/payment record exists |

`Confirm invoice` means review and accepted links, not purchase approval, stock posting, or payment. Clean matches to approved PO terms require no new purchase approval unless configured policy says otherwise. Material variances and no-PO purchases can save as Reviewed + Awaiting approval.

Recommended conservative starting rule: use configured purchasing approvers for no-PO purchases and material variances; do not silently grant Office self-approval. If the necessary approval policy is absent, retain Awaiting approval, not Approved. Administrative policy configuration is a later authorized implementation task. Existing PO rules remain authoritative; invoice review never changes approved order prices or bypasses PO thresholds.

Physical custody evidence can still be recorded independently of commercial approval, under receiving permissions. Over-delivery or disputed stock requires explicit disposition; it is never silently accepted into ordinary usable stock by invoice approval.

## 7. Data ownership and invariants

### Proposed ownership

Names below are logical owners; finalize SQL names and migration numbers after checking the integration branch.

- **Purchase invoice:** stable company-scoped business document ID, supplier, raw/normalized invoice number, document type, currency, shop context, review/approval status, version, current revision. A new extraction is not a new invoice.
- **Source document:** immutable original, hash, encryption/storage locator, uploader, upload time, content type, revision lineage. Reuse existing protected storage with original encryption context.
- **Extraction attempts and drafts:** existing extraction runs retain provider/evidence/confidence; associate them with stable invoice ID. Re-extraction proposes a new revision; it cannot silently replace confirmed values or links.
- **Invoice lines/charges:** stable revision-specific line identity, extracted values, catalog/supplier match, line type, quantities, units/conversion, monetary values.
- **PO line allocations:** invoice line to PO line/revision and allocated quantity/amount. Header PO references are derived from these relations.
- **Receipt allocations:** invoice line to existing receipt line and allocated quantity; optional exact-unit links when needed. Use the same receipt owner for direct and PO receiving.
- **Commercial owner:** existing supplier-bill record linked uniquely to invoice identity. Add approval/revision support rather than create a second independent balance table. Existing manual bills require a reconcile/link action before creating another obligation.
- **Events/commands:** record actor, scope, versions, payload hash, result, resolution reason, approvals, corrections, and supersession.

### Mandatory invariants

1. Confirming or linking an invoice creates zero stock movements.
2. One physical receiving command creates one receipt and its movements, identities, dispositions, and links atomically.
3. A serial identity cannot be created twice or belong to two simultaneous physical receipts.
4. Existing receipt/unit provenance remains immutable when a later invoice is linked.
5. Invoice-to-receipt allocation cannot exceed eligible receipt quantity or invoice stock-line quantity. Stock counts/opening evidence need explicit eligibility rules rather than pretending every observation is a purchase receipt.
6. PO ordered, cancelled, physically delivered, accepted/held/rejected, posted, and invoiced quantities are distinct. Never reuse `received_quantity` for all of them.
7. Default incoming commitment = ordered minus cancelled minus fulfilled accepted/held delivery quantities, according to documented disposition policy. Rejected quantities remain due unless cancellation/replacement terms resolve them. Delivered-but-unposted goods are visible separately and are not a new replenishment need.
8. Shared replenishment calculation considers usable/reserved stock, outstanding commitments, and accepted delivery awaiting posting once each. Reuse it across Requests, POs, and Reports; keep held goods unavailable.
9. Credits/reversals use explicit events and signed allocations. They do not blindly reopen PO capacity or stock availability.
10. Bill creation/linking is exactly once per business invoice. Financial summaries distinguish awaiting-approval amounts from approved outstanding amounts. Unknown payment/cost state is not zero or Paid.
11. Receipt costs and later bill allocations preserve source facts. Cost valuation, weighted average, and selling-price changes are separate policy work; do not publish a stock valuation from PO price alone.

## 8. Command/API contract

Retain compatibility routes while introducing one application service for each business command:

| Command | Required behavior |
| --- | --- |
| Upload | Optional PO context, durable source, duplicate check, asynchronous extraction; returns stable invoice and job IDs |
| Save draft | Expected invoice revision; durable edits; no approved link/stock mutation |
| Match preview | Current draft plus scoped candidates, differences, proposed allocations and version tokens |
| Confirm invoice | Recheck versions/duplicates/allocations; save reviewed revision, links, bill relation, approval state and command result in one transaction |
| Resolve approval | Existing capability/threshold checks; exact reviewed revision; durable reason/event |
| Receive goods | Accepted/held/rejected quantities and identities; physical attestation; atomic receipt posting and links |
| Link/revise document | Preserve old evidence; check remaining allocation capacity; no stock movement |
| Recover command | Same actor/company/location scope; return committed result or explicit unknown/not-found |

All mutations use idempotency keys and canonical payload hashes. Same key with different data conflicts. Scope every source/PO/receipt lookup and revalidate on save. Lock invoice, PO lines, receipt allocations, and stock in a documented consistent order. Recheck quantity bounds under lock; UI previews are not authority. Use optimistic versions to stop stale drafts and changed approvals.

Do not perform OCR/network work inside database transactions. Source upload and extraction may precede confirmation; failures retain a resumable draft. Commit confirmation data together, then deliver noncritical notifications through retryable jobs. A failed notification must not induce duplicate billing or receiving.

## 9. Duplicate and revision rules

- Same company and identical file hash: resolve existing source/invoice where authorized. No duplicate document or cross-location content leakage.
- Same verified supplier + invoice number + document type, different file: potential duplicate or revision. Do not silently overwrite or automatically create a second payable. Genuine number reuse requires explicit authorized evidence and audit.
- Same invoice through PO shortcut and general upload: one invoice, one review state, one commercial record.
- Multiple supporting scans/pages may attach to one invoice; distinguish supporting material from a new invoice. Initially one complete invoice per file; route mixed-document files to explicit split/selection rather than guessing.
- Re-extraction after review creates a proposed revision. Changed confirmed quantities/prices require revalidation and applicable approval. Existing physical receipts remain unchanged.
- Company-scoped uniqueness/locking prevents concurrent uploads from creating two business invoices; text checks alone are insufficient.

## 10. UI behavior and measurable speed goals

- Clean single invoice: upload/select file plus Confirm invoice; no separate extraction, attachment, supplier reselection, or per-line approval.
- No-PO case: at most one additional no-PO decision beyond clean review, excluding real missing data or policy approval.
- PO shortcut supplies shop/supplier/PO; all are server checked. A general upload inherits selected shop when unambiguous; never guess tenant or cross-shop authority.
- Show Needs attention first. Matched lines appear in compact table with expandable detail. One field correction updates related checks.
- Preserve complete source and all values for human review; “No differences” is not proof that OCR is correct.
- Wide desktop: shared title, readable source and bounded review pane, sticky save state/action. Tablet: retain split only while both panes remain useful. Phone: Document/Review toggle, no nested form scrolling, 44px touch targets.
- Keyboard: predictable order, visible focus, first error focused on failed confirmation, trigger focus restored on close, Back returns to the prior list/PO without losing draft.
- No editing pane reset from background list polling. Cancel stale requests and preserve dirty revision when refresh finds newer data.
- Lists use server filtering/pagination and database indexes. Upload workers have bounded concurrency; show queue state. Do not promise OCR seconds before measuring realistic documents.

## 11. Migration and developer-branch integration

1. Inventory both code versions and all pending edits. Preserve local date controls and mechanic reassignment repair. Get a reviewable developer branch/commit before integration; ZIP has no trustworthy merge ancestry.
2. Resolve existing migration compatibility before adding invoice schema. Developer migration 133 temporarily excludes `local_manual` receipts and `manual_receipt` movements; later 145 cannot rescue a failure at 133. Preserve supported values at every step. Do not edit applied SQL casually or whitelist arbitrary checksum changes.
3. Preserve historical migration bytes/checksums. ZIP CRLF differences can break existing checksum validation. Verify exact final committed files against applied histories.
4. Add new owners and compatibility adapters first. Assign migration numbers from actual branch, not assumed ZIP sequence.
5. Backfill invoice identities from extraction history; map existing invoice-created receipts through known foreign keys. Record source-to-target mappings and counts.
6. Adopt PO bill documents without claiming OCR/review happened. Preserve document IDs, bytes, hashes, timestamps, encryption authentication context, and existing downloads. Mark extraction/review pending when absent.
7. Link old supplier bills only with deterministic evidence; ambiguous supplier/number matches enter migration review. Never regenerate payments, stock, or approved amounts.
8. Preserve old links through redirects/adapters. History and source permissions must survive transition.
9. During staged cutover, all physical writes use one canonical receipt command. Old invoice confirmation cannot bypass allocation checks and add already received stock again.
10. Remove duplicate upload UI only after shared path and compatibility checks pass. Migrate source retention/deletion rules to respect business-document references without silently changing organizational retention policy.
11. Test fresh install and populated upgrade, including manual receipts, old PO uploads, credits, existing payments, and partially received POs. Reconcile counts, hashes, stock, identities, receipt allocations, and bill totals before/after.
12. Keep reversible UI flag and restore rehearsal. After real new writes, prefer forward repair; do not destructively roll back schema or erase event history. Release and production mutation require separate authorization.

## 12. Delivery sequence

| Phase | Deliverable | Exit gate |
| --- | --- | --- |
| 0. Baseline and contracts | Safe integration diff, permissions/approval rules, quantity definitions, migration repair design | Current local fixes preserved; populated-upgrade cases specified |
| 1. Shared invoice identity | Source adapters, durable drafts, single list, legacy mappings, duplicate/revision rules | Old and new invoice sources visible with unchanged stock and bill totals |
| 2. Matching and confirmation | PO/supplier/line/receipt preview, no-PO choice, exceptions, transactional review/link/bill command | Clean PO and no-PO journeys; concurrency and duplicate negatives pass |
| 3. Partial receiving | Shared accepted/held/rejected receipt command, serial capture, outstanding/commitment projection | Before/after-invoice and repeated partial deliveries reconcile |
| 4. Purchases UX | Unified navigation, upload shortcuts, automatic extraction, exception-first review, Confirm & next | Two-action clean flow; no repeated entry; responsive/resume proof |
| 5. Commercial completion | Approval queue, existing bill/payment linkage, mixed charges, credit evidence, corrected reports | No duplicate payable; pending/approved money and physical quantities separate |
| 6. Cutover and release readiness | Compatibility redirects, old-writer retirement, migration rehearsal, observability | Complete acceptance matrix and operator/device evidence |

Phases may expose usable subsets behind explicit scope labels, but the consolidated workflow is not complete until receiving and commercial links are proved. User-visible navigation must not suggest unavailable matching or receiving works.

## 13. Acceptance matrix

| Scenario | Required proof |
| --- | --- |
| Clean approved PO invoice | Unique match, one confirmation, same document under PO and invoice list, zero stock movements |
| Wrong PO/supplier from PO shortcut | Clear conflict, no silent attachment or cross-supplier approval |
| No PO and missing PO | Explicit no-PO choice, raw reference retained, review saved, approval status truthful |
| No-PO later linked to PO | Same invoice/bill identity, no new receipt or quantity |
| Same file uploaded twice/concurrently | One business invoice; recover same outcome |
| Same number, changed scan | Duplicate/revision decision; original evidence preserved |
| PO 10, invoice 4, later invoice 6 | Cumulative allocations exactly 10; overbilling rejected/explicitly approved |
| Invoice covers several POs | Correct per-line allocation; one invoice total, no duplicate list rows/payable |
| Receive 4 then upload invoice | Existing receipt linked; on-hand remains 4 |
| Upload invoice then receive 4 and 6 | Two physical receipts; exactly 10 delivered/posted, one invoice |
| Accept 3, hold 1, reject 2 | Usable +3; held +1; rejected +0; remaining commitment matches disposition |
| Duplicate or unavailable serial | No partial receipt/balance mutation; same identity retained through existing lifecycle |
| Concurrent receipt and link | No duplicate quantity, over-allocation, or lost command outcome |
| Price/currency/unit mismatch | Needs attention; no silent PO edit/conversion; policy approval rechecked |
| Service/freight/discount invoice | Totals reconcile; no stock for non-stock lines |
| Credit memo | Signed commercial evidence only; no automatic return/restock |
| Existing manual bill/payment | Link/reconcile rather than create duplicate obligation or payment |
| Stock allocated to Workorder | Invoice linkage leaves reservation, installed/pending state, and mechanic behavior unchanged |
| Stale review or revised PO | Version conflict retains draft; new comparison before confirmation |
| Lost upload/confirm/receive response | Command recovery yields original result; no duplicate action |
| Partial batch failure | Successful documents persist; failed files retry independently |
| Refresh/Back/phone interruption | Saved draft, shop, selection and return focus retained |
| Unauthorized company/shop/cost access | Queries, source downloads, matching, mutations and exports denied without leakage |
| Fresh + populated upgrade | Migration success and reconciliation, including existing manual history and encrypted PO files |

Validation layers: pure matching/arithmetic tests; service/route permission contracts; real disposable PostgreSQL transactions/concurrency and populated migrations; authenticated desktop/tablet/phone browser journeys; separate actual camera/printer proof where receiving uses those devices. Existing unit tests and a production build alone are insufficient.

Measure operator actions and repeated fields on realistic invoices. Record extraction quality, ambiguous matches, duplicate resolutions, approval wait, command retries, and completion times. Treat latency goals as measured targets, not unverified promises. Use existing authorized records for hosted read-only checks; any synthetic stock actions or production QA need explicit scope.

## 14. Completion definition

Complete means both PO and no-PO invoices use one source/review/history owner; correct matches require upload plus one confirmation; exceptions retain evidence; physical goods are recorded exactly once; commercial approval and money remain truthful; historical data and current Workorder behavior survive migration; and the acceptance matrix passes at the appropriate verification layers.

Until implemented and verified, this remains a proposed design. No completion percentage or production-readiness claim is implied by this plan.
