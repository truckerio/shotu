# Workorder Customer Estimate And Invoice Plan

## Document Control

- **Status:** Approved product and implementation plan; implementation not started by this document
- **Plan owner:** Workorder customer-commercial workflow
- **Created:** 2026-09-28
- **Last updated:** 2026-09-28
- **Repository baseline reviewed:** `005b52c74ad3ee27ad57a62158d20879c0c22fa7`
- **Related design contract:** [`docs/OPERATOR_PAGE_DESIGN_SYSTEM.md`](../OPERATOR_PAGE_DESIGN_SYSTEM.md)
- **Related Workorder module contract:** [`docs/specs/WORKORDER_MODULE_PLATFORM_V2.md`](./WORKORDER_MODULE_PLATFORM_V2.md)
- **Related inventory truth:** [`docs/INVENTORY_ODOO_LIVING_RECORD.md`](../INVENTORY_ODOO_LIVING_RECORD.md)

## 1. How To Use This Plan

This file is the canonical plan for customer-facing repair Estimates, authorization, Estimate revisions, final Invoices, tax, discounts, customer-visible communication, document templates, and their minimal integration into the current Workorder application.

Future work must use the following truth labels:

| Label | Meaning |
|---|---|
| `VERIFIED CURRENT` | Confirmed in the reviewed repository baseline and named source files |
| `DECIDED TARGET` | Product decision agreed for the target experience, but not proof of implementation |
| `PLANNED` | Proposed implementation detail that must still pass discovery, implementation, and verification |
| `DEFERRED` | Deliberately excluded from the first implementation |
| `UNKNOWN` | Requires evidence or a product/legal/accounting decision before implementation |

Rules for all future implementation turns:

1. Read this file before changing Estimate, Invoice, Workorder pricing, customer portal, customer chat, tax, discount, or document-template behavior.
2. Read the current source owners named in this plan. Source code and migrations remain executable truth.
3. Do not promote a `PLANNED` statement to `VERIFIED CURRENT` without named repository and test evidence.
4. Update this document when a decision changes. Preserve superseded decisions in the Change Log instead of silently rewriting history.
5. Implement one vertical slice at a time: data ownership, authorization, service/API, UI, accessibility, tests, rollout, and operational evidence.
6. Do not invent a parallel pricing calculator, Preview implementation, chat system, customer account system, or Workorder lifecycle.
7. Do not infer legal or tax compliance from this plan. The shop must validate configured tax and authorization language with qualified advisers.

## 2. Product Outcome

### 2.1 Customer outcome

The customer receives a clear, modern Estimate showing proposed repair work, labor, parts, discounts, projected tax, and estimated total. The customer can view the exact issued revision, ask questions, request changes, decline, or authorize it. When approved scope changes during repair, the customer receives a Revised Estimate containing the difference. After work is complete and reviewed, the shop issues a final Invoice based on actual completed work.

### 2.2 Shop outcome

The shop continues using the existing Workorder workflow. Pricing, inventory, chat, Activity, role permissions, Workorder detail, and responsive shells remain canonical. The customer-commercial workflow adds the smallest necessary capabilities:

- one canonical financial calculation contract;
- versioned shop commercial settings;
- one customer-document projection and renderer;
- immutable Estimate and Invoice revisions;
- secure customer access grants;
- structured authorization events;
- an internal/customer audience boundary in existing chat;
- final reconciliation between approved Estimate and actual work.

### 2.3 Minimal-change principle

`DECIDED TARGET`: Keep the current modular monolith. Do not create a billing microservice, separate chat product, parallel Workorder detail page, or separate customer-document calculation engine.

## 3. Terminology

| Term | Definition |
|---|---|
| Draft | Editable shop work before a customer document is issued |
| Estimate | Customer-facing projection of proposed work and price; remains an Estimate throughout diagnosis and repair |
| Estimate revision | Immutable issued snapshot such as R1 or R2 |
| Authorization | Structured customer response tied to one exact immutable Estimate revision |
| Proposed change | Saved work/scope/price difference not yet incorporated into an issued revision |
| Revised Estimate | A new immutable Estimate revision containing changed scope or price |
| Invoice | Immutable final customer document issued only after work is complete and office review passes |
| Receipt | Evidence of payment against an Invoice; not active until payment support exists |
| Internal cost | Shop-only cost used for margin and operational decisions; never customer-visible |
| Selling price | Customer-facing unit price used by Estimate and Invoice calculations |
| Customer-visible chat | Messages deliberately shared with the customer portal |
| Internal chat | Existing staff-only Workorder conversation |

## 4. Verified Current Baseline

The following is `VERIFIED CURRENT` for the reviewed repository baseline.

### 4.1 Pricing

- Migration `180_workorder_labor_pricing.sql` owns append-only company/location labor rate versions and immutable Workorder labor-price snapshots.
- Labor prices distinguish `internal_cost` and `selling_price`.
- Migration `181_workorder_price_overrides.sql` adds Workorder-only manual override evidence through `base_unit_price` and `manual_override` for part and labor snapshots.
- `frontend/src/features/create-workorder/create-workorder-pricing.js` owns Create pricing preferences, preview fingerprints, completeness, and submit payload construction.
- `frontend/src/components/workorders/workorder-pricing-model.js` owns current staff Workorder pricing presentation and rejects mixed internal/selling price bases from a completed total.
- A total made entirely from `batch_cost`/`internal_cost` can currently be complete. Current pricing is therefore not a customer-safe financial projection. The planned customer calculator must require `selling_price` or an authorized customer-selling override for every billable row and fail closed for all-internal, all-batch, mixed, or unknown bases.
- Current persisted money columns use PostgreSQL numeric values. The customer-document calculator does not yet exist.

### 4.2 Tax profiles

- Migration `135_inventory_tax_profiles_and_price_treatment.sql` already owns immutable company tax-profile versions with currency, jurisdiction, components, effective time, lifecycle state, and price-version tax treatment.
- `src/server/db/repositories/inventory-tax-profiles.repo.js` already owns tenant-scoped reads plus idempotent create, revise, archive, and optimistic-concurrency behavior.
- These tax profiles support pricing previews; they do not post accounting or infer jurisdiction rules.
- The customer-document feature must reuse and deliberately extend this authority. It must not create a second tax-profile truth. Any new document-specific resolution must reference the existing immutable tax-profile version and add only missing line-category or jurisdiction behavior through one canonical contract.

### 4.3 Workorder lifecycle

- Current durable Workorder lifecycle values include `open`, `accepted`, `in_progress`, `mechanic_done`, `closed`, `odoo_entered`, and `cancelled`.
- Current views/triggers can move active assigned work into `in_progress`.
- `createWorkorderRuntime` currently permits an authorized Mechanic to create a Workorder, self-assigns that mechanic, and requests immediate start. Customer authorization is not currently part of this path.
- `mechanic_done` is already presented as Work done/Ready for review in current surfaces.
- No customer-approval lifecycle state is currently part of the Workorder status enum.

### 4.4 Preview

- `frontend/src/components/preview/PreviewPane.jsx` is the shared Preview surface.
- `frontend/src/components/workorders/CompactWorkorderPreview.jsx` renders compact existing Workorder preview behavior.
- Current Preview is an internal Workorder representation. It is not an immutable customer Estimate/Invoice document.
- Existing print/fullscreen behavior must remain compatible.

### 4.5 Chat

- `chat_messages` is currently Workorder-scoped.
- Current message types are `normal`, `part_request`, `help_request`, and `system`.
- The current repository/realtime UI supports internal Workorder chat, attachments, and per-user delivery/read behavior.
- No durable `internal` versus `customer` audience exists yet.
- The customer is not currently represented as a normal Workorder app user.

### 4.6 Refresh behavior

- `frontend/src/features/workorder-detail/useWorkorderDetailRealtime.js` currently refreshes Workorder detail every 3 seconds.
- That hook is an authenticated staff Workorder-detail owner, not a customer-portal transport. Reusing its cadence and visibility/focus pattern for a new grant-safe, version-aware, rate-limited portal projection is `PLANNED`. The portal must not call the staff hook or staff projection directly.
- A WebSocket/pub-sub platform is not planned initially; measured portal behavior may revisit that choice.

### 4.7 Customer identity and delivery

- Current Workorder form data stores a `customerCompanyName`/legacy `companyName` snapshot. It does not provide a durable customer/contact master, billing address, customer email, customer phone, or named recipient entity.
- Current SMTP transport waits for Nodemailer/provider acceptance from `sendMail`; it does not prove that a recipient received or read a message.
- `DECIDED TARGET`: Every issued revision and delivery attempt stores the immutable recipient fields available for that action: name, company, address, email, phone, and channel. Missing optional fields remain explicitly absent rather than invented.
- Reusable customer-master ownership, selected first-release delivery channels, and stronger provider receipts remain `UNKNOWN` until the corresponding implementation slice resolves them.

### 4.8 Workorder print archive

- `workorder_print_archives` is an immutable Workorder/location archive pattern.
- It remains Workorder-print specific and must not be overloaded as the customer Estimate/Invoice ledger.

## 5. Non-Negotiable Product Decisions

All statements in this section are `DECIDED TARGET`.

1. There is no labor timer in this feature.
2. The shop diagnoses first and enters estimated labor hours, labor selling rates, parts, selling prices, discounts, and expected tax.
3. The customer-facing document is called **Estimate** while the Workorder is draft or work is underway.
4. The Estimate can be updated only by issuing a new immutable revision.
5. The customer portal shows saved changes near-real-time, but an issued revision never mutates.
6. Customer authorization is tied to one exact Estimate revision and document hash.
7. Chat is discussion. Chat text alone is not the legal authorization record.
8. Initial customer work requires authorization before operational repair begins unless an authorized exemption applies.
9. Operational repair begins only when the approved requirement is satisfied, the Workorder is created, and a mechanic is assigned. No timer starts.
10. A scope/price change creates a Revised Estimate when approval is required.
11. Safety-first first release: after a newer Estimate revision is issued for authorization-required external-customer work, all repair-progress mutations pause until the customer accepts that exact latest revision. Office/Admin may still correct proposed scope and pricing, issue/supersede revisions, communicate, and safely unwind unused inventory. A future affected-line-only mode requires an immutable per-line authorization ledger and is deferred.
12. An Invoice is issued only after the mechanic marks Work done and office review/reconciliation passes.
13. An Estimate remains an Estimate; it is never renamed into an Invoice.
14. A Receipt is not issued until payment evidence exists. Payment integration is deferred.
15. Clicking **View** in the customer portal opens the exact immutable Estimate or Invoice document revision.
16. Internal cost, margin, batch cost, inventory allocation, supplier data, and internal messages never appear in customer projections.
17. Existing chat, Preview shell, Workorder modules, Activity, polling, and page design primitives are reused rather than replaced.

## 6. Role And Authority Contract

`PLANNED`: Final capability names must integrate with the existing server authorization/module registry during implementation.

| Action | Admin | Office | Mechanic | Customer grant |
|---|---:|---:|---:|---:|
| Configure company commercial profile | Yes | No by default | No | No |
| Configure location tax/profile override | Yes | Optional explicit grant | No | No |
| View internal cost/margin | Yes | Explicit company policy | No by default | Never |
| Set selling price | Yes | Yes | No by default | No |
| Apply permitted discount | Yes | Policy limited | No by default | No |
| Override tax category | Yes | Explicit grant and reason | No | No |
| Preview customer Estimate | Yes | Yes | Read if explicitly useful | Exact granted revision only |
| Issue/revise Estimate | Yes | Yes | Request change only | No |
| Authorize exemption | Admin or explicit authority | Optional explicit authority | No | No |
| Create/assign authorization-required external-customer Workorder after approval | Yes | Yes | No | No |
| Mechanic self-create/self-assign internal, fleet, warranty, or exempt Workorder | Policy controlled | Policy controlled | `UNKNOWN` pending named server policy | No |
| Propose additional work | Yes | Yes | Yes | No |
| Send customer-visible message | Yes | Yes | Explicit policy | Reply only |
| Mark Work done | Existing authorized role | Existing policy | Existing authorized mechanic | No |
| Issue final Invoice | Yes | Yes after review | No | No |
| View issued Invoice | Yes | Yes | Read if policy allows | Exact granted customer document |

Every server route must independently enforce company, location, Workorder, document, revision, actor, and capability boundaries. UI hiding is not authorization.

## 7. End-To-End Lifecycle

### 7.1 Initial Estimate

```text
Shop diagnoses vehicle
  -> Save Draft
  -> enter proposed labor, parts, selling prices, discount, and tax context
  -> Preview Estimate
  -> Issue Estimate R1
  -> deliver secure customer link
  -> customer views exact R1
  -> Accept | Decline | Request changes
```

### 7.2 Work activation

```text
Estimate authorization satisfied
  + Workorder created
  + mechanic assigned
  -> existing lifecycle enters active work
```

No new timer is created. Estimated and actual labor hours remain explicit entries.

### 7.3 Repair change

```text
Mechanic/Office records changed scope
  -> system compares latest approved revision with current saved projection
  -> Office may keep editing the proposed revision; repair-progress mutations pause
  -> Office reviews changes
  -> Issue Estimate R2
  -> customer views exact difference and new total
  -> Accept | Decline | Request changes
  -> exact R2 acceptance releases the Workorder pause
```

### 7.4 Completion and Invoice

```text
Mechanic marks Work done
  -> Office reviews actual labor, parts, discounts, tax, and approvals
  -> reconcile latest approved Estimate versus actual completed work
  -> resolve unauthorized differences
  -> Issue final Invoice
  -> customer View opens exact Invoice revision
```

### 7.5 Receipt

`DEFERRED`: Keep `receipt` in the conceptual document type vocabulary if helpful for forward compatibility, but expose no Receipt action until payment evidence and payment allocation are implemented.

## 8. Customer Document State Model

`PLANNED`: Customer document state is separate from Workorder lifecycle. Revision lifecycle and customer response are also separate axes.

### 8.1 Document aggregate

Revision lifecycle:

- `issued` — immutable revision available to the permitted audience;
- `voided` — authorized shop void with reason; content remains immutable;
- optional `superseded_by_revision_id` or a supersession event links a newer revision without erasing the older revision's lifecycle or response history.

Customer response status for each revision:

- `pending`;
- `accepted`;
- `declined`;
- `changes_requested`.

`draft_projection` is a computed, mutable pre-issue view and is not an issued revision state.

The aggregate derives the two axes from append-only events where practical. Do not permit mutable content after issuance. An accepted R1 can later be superseded by R2 while R1's accepted response and authorized-scope lineage remain intact.

### 8.2 Document types

- `estimate`
- `invoice`
- `receipt` (`DEFERRED` UI)

### 8.3 Revision rules

- Estimate number remains stable across revisions; revision number increments monotonically.
- Every issued revision stores an immutable JSON projection, canonical hash, template version, tax profile version, issuer, and issuance timestamp.
- Customer responses reference the exact revision ID and hash.
- A newer revision never alters the status or historical content of an older revision.
- Invoice numbering is independent from Estimate numbering.
- Issuance and retries are idempotent.

## 9. Canonical Financial Model

### 9.1 One calculator

`DECIDED TARGET`: One server-owned calculator produces the financial projection used by Create, Workorder detail, Estimate preview, issued Estimate, portal, final reconciliation, Invoice, and reporting.

React may format server results but must not independently decide tax, discount allocation, rounding, or final totals.

### 9.2 Line types

At minimum:

- labor;
- part;
- shop supply;
- fee;
- core charge;
- credit;
- discount allocation.

Each line must carry stable identity, description, quantity, unit, customer unit price, extended amount, tax category, discount eligibility, source lineage, estimated/actual basis, and approval relationship. Internal cost data stays in a protected staff projection.

### 9.3 Calculation order

The default deterministic calculation sequence is:

1. validate currency and precision;
2. calculate quantity multiplied by selling unit price;
3. apply line-level discount;
4. allocate document-level discount across eligible lines using a deterministic remainder rule;
5. calculate the taxable base per line under the versioned tax profile;
6. calculate and round tax according to the selected profile;
7. apply credits/deposits when those features exist;
8. total subtotal, discount, tax, credits, and amount due/estimated total.

Do not use binary floating point for authoritative money. Use PostgreSQL numeric and a decimal-safe server representation. Define currency minor-unit rounding centrally.

### 9.4 Estimated versus actual

- Estimate uses proposed quantities, hours, selling prices, discount, and projected tax.
- Invoice uses actual completed quantities/hours and final approved/authorized selling adjustments.
- Final reconciliation returns line and document differences between the latest approved Estimate and proposed Invoice.

## 10. Discounts

### 10.1 First-release scope

`DECIDED TARGET`:

- fixed line discount;
- percentage line discount;
- fixed document discount;
- percentage document discount;
- required reason;
- actor and timestamp;
- configurable permission threshold;
- before/after audit evidence.

Document discounts must be allocated proportionally across eligible lines so tax basis and reports reconcile exactly. The remainder allocation algorithm must be deterministic.

### 10.2 Deferred discount types

- manufacturer rebate;
- insurance adjustment;
- third-party coupon settlement;
- loyalty program;
- promotion stacking;
- complex account contract pricing.

### 10.3 UI behavior

The normal Workorder shows one compact Discount summary. Editing opens a small controlled editor; it does not add discount controls to every visible row by default. Large/exception discounts show approval requirements before issuance.

## 11. Tax

### 11.1 Product boundary

The app provides a versioned configurable calculation tool. It does not assert that a configuration is legally correct. Admin setup must display a clear validation warning and effective date.

The existing `inventory_tax_profiles` and immutable `inventory_tax_profile_versions` are the canonical tax-profile authority. Customer documents reference those versions. Implementation may extend the shared resolver for labor, fee, supply, core, credit, document, or location categories, but may not create a parallel customer-document tax profile.

### 11.2 Required configuration

At minimum:

- company and location jurisdiction;
- tax registration/reference fields when required for documents;
- effective date range;
- rate components;
- line tax categories;
- labor, part, fee, supply, core, and credit treatment;
- exemption handling and evidence reference;
- rounding method;
- inclusive/exclusive display behavior if later supported;
- profile version and publisher.

### 11.3 Why tax is line-level

Repair taxability differs by jurisdiction and charge type. Official guidance demonstrates why the plan cannot rely on one global tax checkbox:

- California generally distinguishes taxable parts from separately stated repair labor: <https://cdtfa.ca.gov/industry/auto-repair-garages/industry-topics.htm>
- Texas distinguishes separated parts/labor treatment from lump-sum invoicing: <https://comptroller.texas.gov/taxes/publications/94-113.php>
- New Jersey generally taxes automobile repair parts and labor: <https://www.nj.gov/treasury/taxation/pdf/pubs/sales/anj6.pdf>
- Arizona local retail repair rules require explicit parts/labor pricing treatment: <https://azdor.gov/model-city-tax-code/articles-and-sections/retail-sales-repair-services>

Implementation must revalidate the current official guidance for every supported jurisdiction and obtain shop/accounting approval before enabling automatic issuance there.

### 11.4 Estimate and Invoice display

- Estimate displays projected tax and labels the document/total as estimated.
- Invoice recalculates final tax from actual completed taxable lines using the applicable versioned profile.
- Both display an understandable summary; detailed jurisdiction components may appear in a disclosure or printable tax breakdown.

## 12. Shop Commercial Profile And Template

### 12.1 Structured settings

`DECIDED TARGET`: First release uses structured settings, not drag-and-drop document design.

Admin can configure:

- legal name and trade name;
- logo and restrained accent color;
- address, phone, email, and registration identifiers;
- location-specific identity overrides;
- Estimate and Invoice numbering;
- default currency;
- tax profile;
- discount policy;
- Estimate expiration default;
- terms, authorization text, warranty language, and footer;
- document preview and publish action.

### 12.2 Versioning

Publishing creates a new immutable profile/template version. Issued documents reference the exact version used. Editing settings affects future revisions only.

## 13. Customer Document Projection And Rendering

### 13.1 Canonical projection

`PLANNED`: Define one `CustomerDocumentProjection` contract containing only customer-safe information:

- document type, number, revision, state, and dates;
- shop/location identity;
- customer identity;
- unit/vehicle identity;
- concern and repair description;
- labor and part lines;
- discounts and tax summary;
- subtotal and estimated/final total;
- terms and authorization language;
- related Estimate/Invoice references;
- authorization summary safe for the customer.

The projection must be explicitly allowlisted. Never serialize a broad Workorder object and delete sensitive properties afterward.

### 13.2 Renderer ownership

- Keep `PreviewPane` as the shared shell for preview/fullscreen/print behavior where appropriate.
- Add one customer-document renderer shared by live preview, immutable revision view, portal view, and print/PDF.
- Keep `CompactWorkorderPreview` as the internal Workorder preview; do not convert it into the customer document.
- PDF/print output and browser rendering consume the same immutable projection.

### 13.3 Customer-safe exclusions

Never include:

- internal or batch cost;
- gross margin;
- supplier/PO data unless deliberately customer-facing;
- inventory batch or position allocation;
- internal-only Activity;
- internal chat;
- private notes;
- staff permission data;
- hidden tax configuration internals.

## 14. UI And Interaction Contract

All UI statements below are `DECIDED TARGET` unless marked otherwise. The current [`Operator Page Design System`](../OPERATOR_PAGE_DESIGN_SYSTEM.md) is authoritative. Old paper-form geometry is not a design source.

### 14.1 Shared page anatomy

```text
Application identity                           Operations  Inventory  Units

Page H1                                             Primary action
Short state when necessary

Local navigation

┌──────────────── primary work surface ───────────────────────────┐
│ Operational content                                             │
└─────────────────────────────────────────────────────────────────┘
```

- The page heading sits directly on the neutral canvas.
- The main work area is one white surface with subtle border/elevation according to the existing contract.
- Do not stack bordered cards around ordinary subsections.
- Use whitespace and section headings inside the primary surface.

### 14.2 Typography and controls

Use the repository design contract:

- page title: `24px/30px`, weight `650`;
- section title: `18px/26px`, weight `600`;
- body/navigation/controls: `14px/20px`;
- secondary metadata: `13px/18px`;
- captions/labels: `12px/16px`;
- standard desktop controls: `40px`;
- phone/high-frequency touch controls: at least `44px`.

Navigation text is not a heading. Use semantic headings in correct order and one H1 per composed page.

### 14.3 Create page

Header action changes with state; do not show competing primary actions:

| Current state | Primary action |
|---|---|
| incomplete draft | Save/resolve required fields |
| complete financial draft | Issue estimate |
| issued, awaiting response | Awaiting customer (status, not blue action) |
| changes requested | Revise estimate |
| approved | Create workorder |
| created | Open workorder |

The primary work surface contains:

1. unit/customer/concern and assignment context;
2. repair plan with compact labor/part rows;
3. Add line plus Request part/Scan part in their existing appropriate positions;
4. compact Discount and Tax summaries;
5. estimated total;
6. save status and validation near the relevant action.

The price row remains one field with a selectable menu and manual entry. The closed field displays only the selected number. Customer-safe totals always use selling prices.

### 14.4 Staff Estimate preview

Preview opens a dedicated Estimate view using the customer renderer. It is not the legacy boxed Workorder paper form. It shows shop/customer/unit identity, proposed repairs, quantities, unit prices, discount, projected tax, total, terms, and revision state.

### 14.5 Customer portal

Portal summary shows:

- shop identity;
- unit/customer repair identity;
- current document number/revision;
- estimated/final total;
- plain-language status;
- **View estimate/invoice**;
- **Messages** when the Workorder-linked customer channel exists.

`View` navigates to the exact immutable document revision. It is not a mutable live summary modal.

Authorization controls appear after the document:

- Request changes;
- Decline;
- Approve Estimate.

The confirmation surface keeps revision, total, authorization text, and customer-entered name visible before submission.

### 14.6 Active Workorder

Keep the current Workorder detail composition. Add only:

- compact Estimate status/link near Workorder identity;
- quiet “matches approved Estimate” confirmation when true;
- one attention banner when saved work produces approval-relevant changes;
- focused Review changes comparison;
- final reconciliation at Work done.

Do not redesign the entire Workorder page around billing.

### 14.7 Revised Estimate comparison

Show approved revision versus proposed revision, changed lines, previous total, proposed total, difference, and required reason. Emphasize only changes. The action is **Send Revised Estimate**.

### 14.8 Invoice

Invoice uses the same document renderer and visual system. It changes label, numbering, final/actual values, related Estimate references, and terms. It does not overwrite or relabel the Estimate.

### 14.9 Responsive behavior

Validate at minimum:

- `390px` phone;
- `768px` tablet;
- `1440px` desktop;
- `1920px` wide desktop;
- `320px` reflow and `200%` zoom.

Phone rules:

- no horizontal page scrolling;
- stacked line-item summaries with identity, state, amount, and next action visible;
- document opens as a separate full-screen route/view;
- no desktop split pane or nested document scrolling;
- authorization actions do not cover document content;
- touch controls remain at least `44px`.

## 15. Customer Authorization

### 15.1 Canonical event

Authorization is an append-only customer document event, not a mutable flag on chat or a free-text message.

Record at minimum:

- company/document/revision identity;
- revision hash;
- response type;
- authorization language/template version;
- displayed amount and currency;
- customer-entered name;
- timestamp;
- access-grant identity;
- request/audit metadata permitted by privacy policy;
- optional customer note.

### 15.2 Responses

- `accepted`
- `declined`
- `changes_requested`

Requests must be idempotent. A stale or superseded revision cannot authorize a newer revision.

### 15.3 Authorization exception

Internal fleet, warranty, account contract, or other approved workflows may bypass customer authorization only through a permission-controlled exception containing actor, reason, scope, and timestamp. The initial implementation must fail closed when the requirement is ambiguous.

## 16. Chat Integration

### 16.1 Minimal schema extension

`PLANNED`: Extend current Workorder chat rather than creating a new system:

- `audience`: `internal` or `customer`;
- optional customer document/revision link;
- optional external actor/grant identity;
- system cards for issued/accepted/declined/changes-requested events.

Backfill/default all existing messages to `internal`.

### 16.2 Staff UI

Provide an explicit **Internal | Customer** audience switch. The composer must visibly state the audience. Sending to customer is deliberate and permission checked.

### 16.3 Portal UI

The portal shows only customer-audience messages and customer-safe linked document cards. Initial pre-Workorder Estimate response can use structured response notes. Full two-way chat begins after the accepted Estimate is linked to an operational Workorder.

### 16.4 Legal boundary

Chat may explain, discuss, and link. Only the structured document response authorizes work.

## 17. Inventory And Batch Boundary

Inventory remains authoritative for physical quantity, location, position, reservation, issue, and batch/serial lineage.

- Customer documents show part identity, description, quantity, unit selling price, and amount.
- They do not show internal source location, bin, batch, serial, cost layer, or FCFS allocation.
- Quantity and measured/bulk stock continue automatic allocation according to existing inventory rules.
- Serialized parts continue exact manual identity selection when required.
- Invoice actual part quantity must reconcile to recorded usage/issue outcomes, not an uncommitted search selection.

## 18. Planned Data Model

Exact migration numbers must be assigned only when implementation begins and current migration order is rechecked. Do not reserve numbers in this plan.

### 18.1 Commercial profile

`customer_document_profiles`

- company/location scope;
- version;
- structured branding/identity JSON;
- numbering configuration;
- terms and authorization configuration;
- related tax/discount policy versions;
- published by/at;
- immutable after publish.

### 18.2 Customer document aggregate

`customer_documents`

- company and Workorder/draft relationship, plus optional `customer_id` only if a canonical customer owner exists by implementation time;
- document type;
- stable document number;
- current revision pointer derived or guarded;
- lifecycle metadata;
- unique tenant-scoped numbering constraints.

The first migration must not require a customer master that does not exist. Issued revisions store an immutable recipient snapshot containing the available name/company, address, email, phone, and chosen channel. A reusable customer/contact master remains an explicit ownership decision in Section 28.

### 18.3 Immutable revisions

`customer_document_revisions`

- document and monotonic revision number;
- immutable customer-safe JSON snapshot;
- content hash;
- currency and authoritative totals for query/reporting;
- profile/template/tax/discount policy versions;
- issuer and issuance timestamp;
- idempotency key and request hash;
- no update/delete except controlled retention policy, if legally allowed.

### 18.4 Events

`customer_document_events`

- issued, delivery requested, provider accepted, delivery failed, bounced when supported, viewed, accepted, declined, changes requested, superseded, voided;
- actor type and identity;
- exact document revision/hash;
- structured metadata;
- idempotency evidence;
- append-only.

`delivered` may be recorded only when a configured provider supplies a receipt with reviewed delivery semantics. SMTP/provider acceptance alone is `provider_accepted`, not proof of recipient delivery.

### 18.5 Access grants

`customer_document_access_grants`

- company and document scope, plus optional customer identity when a canonical customer owner exists;
- hashed token, never raw token at rest;
- allowed actions;
- issued/expiry/revoked timestamps;
- last-used audit metadata;
- optional Workorder customer-chat scope.

Each delivery attempt snapshots recipient, channel, provider/message identifier, request time, provider-acceptance/failure result, and later bounce/delivery receipts when the selected channel actually provides them.

### 18.6 Tax and discount versions

Reuse `inventory_tax_profiles` and `inventory_tax_profile_versions` as the canonical tax owner. Extend their shared resolver only for missing customer-document line categories and location selection rules. Discounts may use a separate narrow versioned policy owner. Both must support effective dating, immutable published versions, tenant/location scope, and explicit line-category resolution.

## 19. Planned Service And API Boundaries

Final route naming must match repository conventions after targeted implementation discovery.

### 19.1 Staff

Conceptual operations:

```text
GET  draft/workorder customer-document projection
POST preview financial/customer-document projection
POST issue Estimate revision
POST void Estimate revision
GET  document/revisions/events
POST create Workorder from authorized draft
POST issue final Invoice
POST/review proposed financial changes
```

### 19.2 Customer portal

Conceptual operations:

```text
GET  grant-safe portal summary
GET  exact immutable document revision
POST accept | decline | request changes
GET  customer-visible messages
POST customer-visible reply
```

Portal routes authenticate the grant, resolve tenant/document scope server-side, and return allowlisted customer projections only.

### 19.3 Idempotency and concurrency

- Every issue, response, create-from-approval, and Invoice operation requires idempotency evidence.
- Revision issuance serializes on the document aggregate or uses optimistic version checks.
- Stale financial fingerprints fail with a conflict and require fresh review.
- Duplicate customer responses return the existing result when the idempotency key and request hash match; conflicting reuse fails.

## 20. Implementation Slices

Each slice is independently testable and releasable behind feature flags. Do not begin a later slice until its stated dependency has stable contracts and evidence.

### Slice 0 — Stabilize existing Workorder pricing

**Dependency:** none.

**Scope:**

- verify migrations 175, 176, 180, and 181 and their services/tests;
- confirm current part/labor selling-price snapshots and manual overrides;
- confirm refresh/reopen persistence;
- confirm internal/selling basis separation;
- freeze the pricing preview/submit contract used by the financial engine.

**Exit gates:**

- Create and detail totals agree for the same snapshots;
- invalid/mixed price bases fail explicitly;
- override old/new values, actor, reason, and time are auditable;
- PostgreSQL integration, focused frontend/server tests, full verification, and build pass.

### Slice 1 — Canonical financial calculator

**Dependency:** Slice 0.

**Scope:**

- decimal-safe line/subtotal/discount/tax/total calculation;
- estimated and actual line basis;
- deterministic document-discount allocation;
- versioned tax-category resolution seam;
- protected internal projection and allowlisted customer projection;
- golden calculation fixtures.

**Exit gates:**

- all consumers receive identical totals;
- rounding and remainder allocation are deterministic;
- customer projection cannot contain protected fields;
- invalid currency/tax/discount inputs fail closed.

### Slice 2 — Admin commercial profile, tax, discount, and template settings

**Dependency:** Slice 1 contracts.

**Scope:**

- versioned company/location profile;
- reuse and extend the existing immutable inventory tax-profile authority for customer-document line categories and location resolution;
- discount policy and approval thresholds;
- Estimate/Invoice numbering;
- branding, terms, authorization language, preview/publish;
- Admin authorization and optimistic concurrency.

**Exit gates:**

- published versions are immutable;
- location override behavior is explicit;
- stale concurrent edits return conflict;
- old issued revisions retain old profile versions.

### Slice 3 — Live customer Estimate projection and renderer

**Dependency:** Slice 1; profile read contract from Slice 2.

**Scope:**

- shared `CustomerDocumentProjection`;
- customer-safe renderer;
- Preview shell integration;
- print/PDF geometry;
- desktop/tablet/phone accessibility.

**Exit gates:**

- staff preview, print/PDF, and portal-ready renderer use one projection;
- no protected data appears;
- totals match calculator fixtures;
- existing internal Preview remains compatible.

### Slice 4 — Immutable Estimate persistence and issuance

**Dependency:** Slices 1-3.

**Scope:**

- document aggregate, revisions, events, numbering, hash, and idempotency;
- issue/void/supersede service;
- activity/audit integration;
- exact revision retrieval.

**Exit gates:**

- retry cannot duplicate a revision/number;
- issued content cannot mutate;
- concurrent issuance is safe;
- previous revisions remain retrievable and render identically.

### Slice 5 — Secure customer portal Estimate response

**Dependency:** Slice 4.

**Scope:**

- revocable, expiring, hashed access grants;
- portal summary and exact revision View;
- Accept, Decline, Request changes, customer note;
- structured authorization event;
- delivery-request, provider-acceptance/failure, bounce when supported, and verified portal-view evidence;
- no customer account requirement initially.

**Exit gates:**

- unauthorized, expired, revoked, cross-tenant, and wrong-document access fail;
- R1 response cannot approve R2;
- portal contains no internal data;
- browser flow works from a fresh grant.

### Slice 6 — Authorization-aware Workorder activation

**Dependency:** Slice 5.

**Scope:**

- bind approved Estimate/draft to Workorder creation;
- require approval, Create, and mechanic assignment for customer repair activation;
- audited authorization exception path;
- explicitly preserve or migrate the current Mechanic self-create/self-assign/immediate-start path: internal/fleet/exempt work may retain it under a named server policy, while authorization-required external-customer work must fail closed before creation/start;
- derived attention state instead of new global `waiting_customer` status.

**Exit gates:**

- required approval cannot be bypassed through direct API calls;
- exemption is permission checked and reasoned;
- existing internal/fleet compatibility is explicit;
- existing lifecycle behavior remains stable outside this gate.

### Slice 7 — Customer audience in existing chat

**Dependency:** Slice 5 grant model and Slice 6 Workorder link.

**Scope:**

- internal/customer message audience;
- staff audience switch;
- customer-only portal channel;
- linked document cards and structured system messages;
- backfill existing messages as internal.

**Exit gates:**

- no legacy/internal message becomes customer-visible;
- direct route cannot read the wrong audience;
- attachments follow the same audience and grant rules;
- chat messages cannot mutate document authorization.

### Slice 8 — Proposed changes and Revised Estimates

**Dependency:** Slices 4-7.

**Scope:**

- compare current saved financial projection with latest accepted Estimate;
- identify changed/added/removed lines for review and customer presentation;
- require reason;
- Office review and issue R2+;
- pause all repair-progress mutations for authorization-required external-customer work until the exact latest revision is accepted;
- allow Office/Admin revision management and safe inventory return/release while paused;
- portal difference presentation and authorization.

**Exit gates:**

- earlier accepted scope and immutable approval lineage remain visible;
- diagnosis/work performed/labor changes, mechanic used-parts changes, serialized issue/install/repair-order changes, aggregate reserve/increase/consume, and Work done fail server-side while the latest revision is unaccepted;
- reads, customer discussion, part requests, document revision management, and inventory unwind remain available;
- declined revision does not erase older accepted scope;
- race between save/issue/response fails safely.

### Slice 9 — Completion reconciliation and final Invoice

**Dependency:** Slice 8 and trustworthy actual labor/part usage.

**Scope:**

- Work done financial review;
- approved Estimate versus actual comparison;
- unresolved difference gate;
- final tax calculation;
- immutable Invoice numbering/revision/issuance;
- portal Invoice View.

**Exit gates:**

- Invoice cannot issue before completion/review requirements;
- unapproved material differences block issuance or require an explicit lawful path;
- Invoice uses actual recorded work;
- Estimate history remains independent and accessible.

### Slice 10 — Reporting, operations, and hardening

**Dependency:** Slice 9.

**Scope:**

- pending approval, accepted value, revision, variance, discount, tax, and issuance reports;
- document-generation and delivery-request/provider-acceptance/failure/bounce monitoring using only evidence the selected channel can prove;
- support tools for grant revocation and safe resend;
- retention/backups/restoration;
- performance and long-record tests;
- security/a11y review.

**Exit gates:**

- support can identify failed delivery/issuance without database edits;
- reports reconcile to immutable revisions;
- backup/restore preserves hashes, revisions, events, and grants;
- release runbook and rollback gates are documented.

### Slice 11 — Receipt scaffold

**Dependency:** future payment design.

**Scope:** none in initial release beyond compatible document vocabulary.

**Exit gate:** Receipt remains unavailable until verified payment evidence and allocation rules exist.

## 21. Release Plan

### Release A — Staff financial foundation

- Slices 0-3;
- staff-only feature flag;
- compare new projection against current Workorder pricing;
- no customer document issuance.

### Release B — Estimate and authorization

- Slices 4-6;
- controlled pilot locations;
- read-only portal can precede response actions;
- response and activation flags enabled only after security/tenant negatives pass.

### Release C — Repair revisions and customer communication

- Slices 7-8;
- start with Office-only customer messaging;
- add mechanic customer-send capability only through explicit policy;
- monitor leaked-audience and stale-revision protections.

### Release D — Final Invoice and reporting

- Slices 9-10;
- compare Invoice totals to actual usage and approved revisions in shadow mode;
- issue to pilot customers only after reconciliation evidence passes;
- expand location by location.

### Feature flags

Suggested independent gates:

- customer document live preview;
- Estimate issuance;
- customer portal read;
- customer response;
- authorization activation gate;
- customer chat;
- revised Estimate;
- final Invoice issuance.

Flags must fail closed for mutations and must not produce two competing sources of truth.

## 22. Verification Contract

### 22.1 Financial unit tests

- zero, fractional, and large quantities;
- labor and parts with different tax categories;
- fixed and percentage line discounts;
- fixed and percentage document discounts;
- deterministic remainder allocation;
- mixed currency rejection;
- manual override audit values;
- exempt customer/profile;
- core charge and credit treatment where enabled;
- estimated versus actual comparison;
- locale-independent rounding.

### 22.2 Database/integration tests

- migration idempotency and representative legacy data;
- immutable revision update/delete guard;
- unique number/revision under concurrency;
- idempotent issue and response;
- stale fingerprint/version conflict;
- append-only events;
- token hashing, expiry, revocation;
- tenant/location/document foreign-key integrity;
- legacy chat backfill to internal;
- exact approval lineage through revised Estimate and Invoice.

### 22.3 API security tests

- unauthenticated staff endpoint;
- unauthorized role;
- cross-company/cross-location Workorder;
- cross-customer document token;
- expired/revoked/replayed grant;
- superseded revision response;
- customer projection redaction;
- internal message/attachment leakage;
- direct Workorder activation bypass;
- direct Invoice issuance before readiness.

### 22.4 Frontend tests

- loading, saving, saved, failure, stale conflict, permission, and empty states;
- primary action by lifecycle state;
- price field selection/manual override;
- compact discount/tax editor;
- exact revision View;
- authorization confirmation;
- audience switch and visible composer context;
- proposed-change comparison;
- completion reconciliation;
- refresh preserves safe edits and selection.

### 22.5 Browser end-to-end

Required happy path:

1. Admin publishes commercial/tax/discount/template profile.
2. Office creates draft and prices labor/parts.
3. Office previews and issues Estimate R1.
4. Customer View opens exact R1 and accepts.
5. Office creates/assigns Workorder.
6. Mechanic/Office proposes additional work.
7. Office issues R2.
8. Customer accepts or declines R2.
9. Only authorized work continues.
10. Mechanic marks Work done.
11. Office reconciles actual work.
12. Office issues final Invoice.
13. Customer View opens exact Invoice.
14. Activity shows every price, discount, issue, view, response, revision, and Invoice event.

Required failure paths:

- missing price;
- invalid tax profile;
- discount above permission threshold;
- duplicate issue click;
- stale draft during issue;
- expired portal token;
- customer attempts R1 response after R2 issued;
- internal message cannot appear in portal;
- any repair-progress mutation or Work done while the latest revised Estimate is unaccepted;
- Invoice mismatch without resolution;
- PDF/document generation failure and safe retry.

### 22.6 Rendered matrix

- `390px`, `768px`, `1440px`, and `1920px`;
- `320px` reflow;
- `200%` zoom;
- keyboard-only flow;
- visible focus and focus restoration for menus/dialogs;
- no horizontal page overflow;
- long customer names, long concerns, many lines, multi-page documents;
- print/PDF parity against immutable snapshot.

## 23. Security And Privacy

- Store portal tokens hashed; show raw value only at creation/delivery boundary.
- Scope every grant and document query by company plus document/customer relationship.
- Keep grant permissions narrow and revocable.
- Do not embed sensitive content in guessable URLs.
- Apply rate limiting and structured security logging to portal responses.
- Treat customer notes and messages as potentially sensitive content.
- Define retention for IP/user-agent evidence with privacy counsel; collect only what is justified.
- Escape/sanitize document and message content for browser and PDF rendering.
- Prevent remote asset fetching from turning document generation into SSRF.
- Never expose internal cost/margin through network payloads intended for the portal.

## 24. Reliability And Failure Behavior

- Issuance commits immutable revision/event/number atomically.
- PDF/delivery failure does not erase an issued revision; show delivery failed with retry.
- Response event and current aggregate state update atomically.
- Reconciliation never mutates an accepted revision.
- Polling must not overwrite dirty local staff edits.
- Network retry uses idempotency keys.
- Document hash is computed from a canonical serialization, not renderer HTML.
- Portal gracefully shows revoked/expired/unavailable without leaking document existence.
- Feature-flag rollback disables new mutation entry points without deleting durable evidence.

## 25. Reporting

First useful reports after the lifecycle is stable:

- Estimates issued, accepted, declined, changes requested;
- value awaiting approval;
- acceptance rate;
- time from issue to response;
- Estimate revision count;
- latest approved Estimate versus final Invoice variance;
- labor and part variance;
- discounts by actor, reason, and threshold approval;
- taxable sales and tax collected by profile/category/location;
- final Invoices issued;
- delivery-request, provider-acceptance, failure, bounce, and portal-view outcomes without labeling SMTP acceptance as delivery.

Internal cost and gross margin reports remain restricted to authorized roles.

## 26. Performance Targets

Targets must be measured against realistic line counts and document length during implementation. Initial expectations:

- calculation remains deterministic and fast without per-line database round trips;
- preview requests are debounced/cancel stale requests;
- document revision list is paginated;
- customer portal payload contains only needed projection data;
- polling returns version/ETag-friendly projections and avoids full attachment reload;
- PDF generation is bounded and moved to a worker only if synchronous performance fails measured targets.

Do not add infrastructure before measurement demonstrates the need.

## 27. Explicit Non-Goals

- payment collection;
- active Receipt generation;
- accounts receivable aging tied to payments;
- online card processing;
- accounting general ledger;
- insurance claim adjudication;
- coupon/loyalty engine;
- drag-and-drop document designer;
- nationwide automatic tax-compliance guarantee;
- customer self-registration/accounts in the first release;
- WebSocket platform;
- labor timer;
- replacing the Workorder lifecycle;
- replacing internal Workorder Preview;
- exposing inventory batch/bin/cost detail to customers.

## 28. Open Decisions That Must Be Resolved Before Their Slice

These are `UNKNOWN`, not permission to guess:

1. Which locations/jurisdictions enter the first pilot?
2. Exact accountant-approved tax profiles and effective dates for those locations.
3. Exact customer authorization wording and electronic-consent evidence policy.
4. Estimate expiration defaults and behavior after expiration.
5. Whether Office can approve discounts above thresholds or only Admin can.
6. Which internal/fleet/account workflows may use authorization exceptions.
7. When a changed amount requires a Revised Estimate versus an allowed non-price informational update.
8. Whether customer-visible mechanic messaging is enabled initially or Office-only.
9. PDF storage/retention requirements and whether browser rendering plus immutable JSON is sufficient for the first release.
10. Required customer delivery channels for first release: copy link, email, SMS, or a subset.
11. Final Invoice correction policy: void/reissue, credit memo, or both.
12. Privacy retention for portal access evidence.
13. Whether a reusable customer/contact master is introduced, and which module owns it; first-release issuance must still snapshot recipient name/company/address/email/phone/channel immutably.
14. Document numbering scope and legal policy: company versus location sequence, prefix, calendar/fiscal reset, gap handling, void behavior, number reuse prohibition, and concurrency guarantees.
15. Exact policy for the existing Mechanic self-create/self-assign/immediate-start path on customer, internal fleet, warranty, and exempt work.

Implementation must stop at the affected slice if an unresolved decision changes authorization, money, tax, legal evidence, or irreversible data shape.

## 29. Completion Definition

The full feature is complete only when:

- one canonical calculator owns all customer totals;
- tax/discount/profile versions are explicit;
- issued revisions are immutable and idempotent;
- customer access and responses are tenant-safe;
- approval gates cannot be bypassed;
- chat audience cannot leak internal content;
- changed scope produces correct targeted authorization behavior;
- final Invoice reconciles actual work and approvals;
- desktop/tablet/phone/a11y flows pass;
- required focused, PostgreSQL, full verification, and production build gates pass;
- operational monitoring, support, backup, rollout, and rollback evidence exists;
- this plan is updated from `PLANNED` to the correct evidence-backed status.

## 30. Change Log

### CDEI-20260928-01 — Initial consolidated plan

- **Status:** PLANNED
- **Decision/requirement:** Consolidate the agreed Estimate, authorization, revisions, Invoice, tax, discount, customer portal, chat, UI, rollout, and verification strategy into one repository plan.
- **Before:** Decisions existed across conversation and current pricing/UI work without one canonical feature plan.
- **After:** This file defines current verified owners, non-negotiable decisions, planned architecture, ordered slices, and completion gates.
- **Canonical owners:** Existing Workorder pricing, Workorder modules, Preview shell, chat, Activity, inventory, and the planned customer-document module.
- **Data/API changes:** None in this documentation change.
- **User-experience changes:** None implemented by this documentation change.
- **Authorization/security changes:** None implemented by this documentation change.
- **Failure/reconciliation behavior:** Planned in Sections 22-24.
- **Verification:** Documentation structure and repository diff review required before marking this entry verified.
- **Release evidence:** None; plan only.
- **Remaining gaps:** All implementation slices and open decisions in Section 28.
