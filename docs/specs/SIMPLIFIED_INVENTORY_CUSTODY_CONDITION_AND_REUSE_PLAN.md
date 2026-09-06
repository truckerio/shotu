# Simplified Inventory Custody, Condition, and Reuse Plan

Status: reviewed implementation plan only. No application code, database migration, deployment, commit, or push is authorized by this document.

## 1. Decision

Build one understandable inventory system around four separate truths:

1. **Identity** — which catalog part and, when individually tracked, which exact serialized unit.
2. **Physical holder** — warehouse/bin, installed unit, technician/handoff, repair area/vendor, core vendor, scrap area, or unknown.
3. **Condition** — new, serviceable used, refurbished, needs repair, unserviceable, or unknown.
4. **Availability** — ready, reserved, or unavailable, derived by the server from custody and lifecycle state.

Do not create one giant status field that attempts to represent all four truths.

Keep two daily Inventory destinations:

- **Stock** — what can be selected for work and where it is.
- **Returns & repairs** — removed parts requiring physical handoff, inspection, repair, core return, quarantine, or scrap approval.

Keep the existing Operations Parts surface for workorder part requests, but label it **Part requests** so it is not confused with returned-parts custody.

## 2. Product Patterns We Are Adapting

Source references: [Fleetio part locations](https://developer.fleetio.com/docs/api/part-locations), [MaintainX location and availability breakdown](https://help.getmaintainx.com/multi-location-parts), [Odoo serial traceability](https://www.odoo.com/documentation/17.0/applications/inventory_and_mrp/inventory/product_management/product_tracking/create_sn.html), [Odoo repair-order documentation](https://github.com/odoo/documentation/blob/19.0/content/applications/inventory_and_mrp/repairs/repair_orders.rst), and [IBM Maximo condition-enabled items](https://www.ibm.com/docs/en/masv-and-l/maximo-manage/cd?topic=items-condition-enabled). The workflow and simplifications below are our design synthesis, not a claim that these products implement our exact queues or permissions.

### Fleetio pattern

Take:

- one catalog part connected to inventory locations and bins;
- workorder usage and part activity history;
- purchase/source history;
- return-needed flags.

Simplify:

- one part detail panel instead of separate configuration-heavy screens;
- automatic workorder and location derivation when there is one safe answer.

### MaintainX pattern

Take:

- visible counts by operational state;
- clear separation between in-stock, committed, and issued quantities;
- workorder availability that is calculated rather than manually typed.

Simplify:

- four top-level stock counts: Ready, Reserved, Installed, Action needed;
- no optional kitting/staging stages unless the shop later proves it needs them.

Reject:

- returning a physically used or failed installed part directly to available stock.

### Odoo pattern

Take:

- every receipt, issue, return, transfer, repair, and scrap as a durable movement;
- lot/serial traceability;
- scrap as a recorded destination rather than deletion;
- repair work linked to the exact item.

Simplify:

- users choose plain outcomes; the server writes the movements;
- no accounting-style transfer form for ordinary removal and handoff.

### IBM Maximo pattern

Take:

- permanent identity for expensive repairable components;
- condition changes without changing identity;
- movement between asset, storeroom, repair, and return locations.

Simplify:

- no percentage condition-value configuration in the first release;
- six fixed condition labels;
- configuration remains outside the daily operator path.

## 3. Current-System Audit

Current useful foundation:

- exact serialized identity and encrypted QR resolution;
- receipt and invoice lineage;
- exact workorder issue, reservation, installation, and removal usage;
- append-only inventory unit events and stock movements;
- unit detail with installed-part removal;
- custody cases with removal, physical receiving, hold, and release;
- company/location/module/capability authorization;
- deterministic locks, idempotency keys, request hashes, and uncertain-request reconciliation;
- same exact serialized unit can be released and installed on another vehicle without losing history.

Current gaps:

- serialized-unit `location_id` represents inventory ownership/scope, not necessarily the current physical holder;
- exact units have no explicit bin override or current-holder projection;
- removal asks for workorder, reason, ownership, and evidence before the basic action is understandable;
- removal cannot record an intended reuse, refurbishment, core, scrap, or uncertain route;
- custody review supports only release or hold;
- no refurbishment, core-return, quarantine, or scrap-approval workflow;
- no global returned-parts queue in Inventory;
- serialized children appear in one long list without condition or action grouping;
- inventory availability filters operate at aggregate catalog-part level only;
- queue reads are capped rather than fully filterable and paginated;
- legacy untracked installed parts cannot provide exact physical-item history.

## 4. Canonical Vocabulary

### Condition

| Code | User label | Meaning |
|---|---|---|
| `new` | New | Never placed in service after receipt/manufacture. |
| `serviceable_used` | Reusable | Previously used, inspected, and ready without refurbishment. |
| `refurbished` | Refurbished | Repair/refurbishment completed, inspected, and released. |
| `needs_repair` | Needs repair | Not ready; repair or refurbishment required. |
| `unserviceable` | Unserviceable | Not fit for reuse; core or scrap route required. |
| `unknown` | Not classified | Current condition lacks reviewed evidence. |

“New” and “Refurbished” are conditions. “Core return” and “Scrap” are dispositions, not conditions.

### Intended route

Recorded by the remover as a provisional routing signal:

- Inspect for reuse
- Repair/refurbish
- Core return
- Scrap
- Not sure

The receiving/review actor may correct the intended route. A remover’s “Inspect for reuse” choice never releases stock.

### Workflow queue

| Queue | Meaning | Available? |
|---|---|---:|
| Awaiting handoff | Removed but not physically received. | No |
| Needs inspection | Received; final condition not approved. | No |
| Repair/refurbish | Awaiting or undergoing repair. | No |
| Core returns | Must be physically returned to a vendor. | No |
| Scrap approval | Unserviceable; awaiting authorized disposition. | No |
| Quarantine | Identity, ownership, location, or condition unresolved. | No |
| Completed | Released, core-returned, or scrapped history. | Depends on terminal result |

### Availability

Availability is server-derived:

```text
Ready = exact unit status is in_stock
        AND condition is new, serviceable_used, or refurbished
        AND current holder is an inventory location
        AND no open custody, transfer, repair, core, scrap, or quarantine case exists

Reserved = exact unit is reserved to one active workorder

Unavailable = every other state
```

Client code may display availability. Client code must never calculate or mutate authoritative availability.

## 5. Physical Location Model

Preserve two different concepts:

- **Owning inventory location** — tenant/location scope and the balance owner. Existing `inventory_serialized_units.location_id` continues to serve this role during migration.
- **Current physical holder** — where the exact physical unit is now.

Current holder types:

| Holder | Required reference | Example |
|---|---|---|
| `inventory_location` | location; optional bin | Chino Parts Room, bin A-03 |
| `asset` | unit/asset | Installed on Unit 1017 |
| `handoff` | source unit and expected receiving location | With mechanic; expected at Chino |
| `internal_repair` | location; optional bin | Chino Repair, bench 2 |
| `external_repair` | vendor/party reference | ABC Rebuilders |
| `core_vendor` | vendor/return reference | Returned to dealer core program |
| `scrap_area` | location; optional bin | Chino scrap cage |
| `disposed` | disposition event | Scrapped on date |
| `unknown` | explanation | Legacy removed unit; location unverified |

Holder changes and condition changes are separate append-only events even when saved in one operator action.

## 6. End-to-End Workflows

### 6.1 Receive new inventory

```text
Confirm receipt
→ Create/resolve exact serialized child where tracking is required
→ Condition = New
→ Holder = selected inventory location and bin
→ Status = In stock
→ Available = Ready
```

Receipt location is required. Exact bin is optional unless the location policy requires bins.

### 6.2 Install a part

```text
Open workorder
→ Add part
→ Scan or select exact eligible unit
→ Reserve exact unit
→ Issue/install
→ Holder = Unit 1017
→ Available = No
```

Picker groups ready exact units by condition and location:

1. Reusable
2. Refurbished
3. New

Shop policy may change preference. The picker never silently substitutes a different serial.

### 6.3 Remove from a unit

Entry: Unit detail → Installed parts → Remove part.

Visible decisions:

1. Why removed: Failed, Worn, Preventive replacement, Wrong part, Other.
2. Where should it go: Inspect for reuse, Repair/refurbish, Core return, Scrap, Not sure.
3. Optional note.

Derived values:

- exact serialized identity;
- source unit;
- owning and expected receiving location;
- original installation and workorder;
- current active workorder when exactly one qualifies;
- company ownership only when durable source evidence proves it.

Exception behavior:

- multiple eligible workorders: ask the user to choose;
- no workorder and Office/Admin actor: create a minimal open removal workorder atomically with the confirmed removal;
- no workorder and mechanic: require an assigned active workorder or provide Request removal workorder;
- ownership unknown: ask Company, Customer, or Unknown; never default silently to Company;
- company ownership without durable evidence: accept removal but route to Quarantine until evidence is reviewed.

Commit result:

```text
Usage = Removed
Serialized inventory status = Removed
Holder = Handoff
Queue = Awaiting handoff
Available quantity unchanged
```

For an already-installed unit, stock was consumed during installation. Removal must not add it back.

### 6.4 Receive a removed part

Entry: Inventory → Returns & repairs → Awaiting handoff.

Default action: Scan QR. Manual exact serial lookup remains available.

Receiver sees:

- exact part and serial;
- source unit and removal workorder;
- expected receiving location;
- intended route;
- ownership status;
- removal reason and note.

Receiver records:

- physical receipt confirmation;
- actual location;
- bin/shelf when known;
- initial inspection evidence;
- corrected final route when needed.

One save may both receive and route when the actor has both capabilities. The transaction still writes distinct receipt and route events.

### 6.5 Release as reusable

Required:

- physical receipt;
- exact serial match;
- company ownership evidence;
- catalog reuse policy;
- inspection evidence;
- authorized actor different from remover;
- no conflicting open case;
- expected version matches.

Result:

```text
Condition = Reusable
Holder = Inventory location + bin
Status = In stock
Queue = Completed
Available quantity +1 exactly once
```

### 6.6 Refurbish

Route result:

```text
Condition = Needs repair
Queue = Repair/refurbish
Available = No
```

Repair record stores:

- internal location or external vendor;
- sent/start date;
- expected return date when known;
- work performed;
- parts/labor cost when known;
- attachments/evidence;
- completion actor and time.

Completion does not automatically release. A completion inspection releases the unit as Refurbished in the same transaction only when all release gates pass; otherwise it remains Needs inspection.

### 6.7 Core return

Route result:

```text
Condition = Unserviceable
Queue = Core returns
Holder = Core holding location/bin
Available = No
```

Track physical vendor return reference and date. Link future core-credit records, but do not let a credit memo create, remove, or release physical inventory.

Terminal result: Core returned. Exact identity and history remain searchable; quantity does not return to stock.

### 6.8 Scrap

First decision:

```text
Condition = Unserviceable
Queue = Scrap approval
Holder = Scrap area
Available = No
```

Authorized disposal confirmation records reason and evidence, changes holder to Disposed, changes exact-unit status to Scrapped, and retains the record permanently. No hard delete.

### 6.9 Not sure / quarantine

Any unresolved identity, ownership, physical location, or condition sends the unit to Quarantine. Quarantine always requires an explicit resolution action and never counts as ready stock.

## 7. Inventory Information Architecture

### 7.1 Main page

Two peer tabs:

```text
Stock | Returns & repairs
```

Stock filters remain below Stock only. Queue filters remain below Returns & repairs only. Filters never form one hidden cross-tab submission.

### 7.2 Stock list

One row per catalog part:

| Part | Ready | Reserved | Installed | Action needed |
|---|---:|---:|---:|---:|

Ready count includes only released new, reusable, and refurbished stock. Action needed includes handoff, inspection, repair, core, scrap, and quarantine.

### 7.3 Part detail

Sections:

1. Ready stock: New, Reusable, Refurbished counts.
2. Other units: Reserved, Installed, Awaiting handoff, Needs inspection, Repair, Core, Scrap, Quarantine.
3. Locations: ready and action-needed counts per location.
4. Exact units: searchable, paginated, grouped by the selected state.
5. Part identity and source settings.

Do not render all exact children at once. Preserve selected filter, unit, and scroll position after refresh.

### 7.4 Returns & repairs queue

Queue tabs:

- Awaiting handoff
- Needs inspection
- Repair/refurbish
- Core returns
- Scrap approval
- Quarantine
- Completed

Filters:

- location;
- part number/description/serial;
- age;
- intended route;
- assigned vendor for repair/core;
- ownership exception.

Every row states object, current holder, elapsed time, and next action. Opening a row uses the existing secondary detail pattern. Phone uses one page scroller and a full-height detail surface; no nested horizontal table.

### 7.5 Exact serialized-unit detail

Header always shows:

- serial;
- condition;
- availability;
- current physical holder;
- next action.

Facts:

- catalog part;
- owning inventory location;
- exact bin/current holder;
- source receipt/invoice;
- ownership evidence status;
- active workorder/custody/repair/core case.

Timeline includes every receipt, reservation, issue, install, removal, handoff, receipt, condition decision, repair, release, transfer, core return, scrap, and governed correction.

## 8. Aggregate And Serialized Tracking Policy

Continue quantity-only handling for fluids, mass, gas, length, and ordinary consumables.

Require exact-unit tracking for catalog parts configured as repairable, reusable, warranty-returnable, or core-returnable, limited to whole count/package units.

Do not infer repairability from UOM alone. Add an explicit catalog lifecycle policy.

Legacy untracked repairable part removal:

1. Resolve the catalog part and quantity of one.
2. Confirm the physical item exists.
3. Generate one permanent internal QR identity.
4. Record origin as `legacy_tracking_started_at_removal`.
5. Display “Earlier physical history unavailable.”

Do not invent prior serial, receipt, invoice, cost, ownership, or installation dates.

## 9. Data Model

### 9.1 Existing owners retained

- `parts_catalog`: stable catalog identity and lifecycle policy owner.
- `inventory_items`: aggregate balance by owning inventory location and UOM.
- `inventory_serialized_units`: permanent exact physical identity and current projection.
- `workorder_serialized_part_usages`: installation episodes.
- `inventory_unit_events`: append-only exact-unit history.
- `inventory_stock_movements`: append-only quantity ledger.
- `inventory_reuse_cases`: removal/return/disposition workflow.

### 9.2 Additive fields/tables

Add to `inventory_serialized_units`:

- `condition_code` with fixed check constraint;
- `custody_holder_type` with fixed check constraint;
- nullable `custody_location_id` scoped by company;
- nullable `custody_asset_id` scoped by company;
- `custody_bin_location`;
- nullable external holder label/reference;
- `custody_version` for optimistic concurrency;
- condition/custody update actor and timestamp where useful for recovery.

Add to `inventory_reuse_cases`:

- `intended_route`;
- expanded workflow status;
- reviewed/final route;
- current condition decision;
- receiving bin;
- repair/core/vendor fields through a child case table rather than sparse unrelated columns;
- optimistic `version`;
- routed/completed actor and timestamps.

Add `inventory_repair_cases` only when the route is refurbishment:

- one active repair case per reuse case;
- internal/external handler;
- vendor reference;
- lifecycle dates;
- evidence and costs;
- version and idempotent command records.

Add event types for holder and condition transitions. Do not edit applied migrations 113–115.

### 9.3 Constraints

- holder reference shape must match holder type;
- one open reuse case per exact unit;
- one active installation/reservation per exact unit;
- one active repair case per reuse case;
- Ready requires inventory-location holder and serviceable condition;
- Installed requires asset holder and active installed usage;
- Scrapped requires disposed/scrap holder and cannot be issued;
- Core returned cannot be issued;
- company/location foreign keys remain composite where supported;
- state transitions occur only through guarded commands, not generic PATCH.

### 9.4 Indexes

- queue: `(company_id, location_id, workflow_status, updated_at, id)`;
- exact part/location/state: `(company_id, location_id, catalog_part_id, status, condition_code)` through the receipt-line catalog relationship or a validated direct catalog projection;
- holder asset: partial index for `custody_holder_type='asset'`;
- active repair/vendor queue;
- unit timeline remains ordered by unit and event time/id.

Measure with realistic cardinality before adding overlapping indexes.

## 10. API And Command Boundaries

Read endpoints:

- paginated stock summary with server-derived state counts;
- paginated exact units by catalog part/location/state/condition;
- paginated returns/repairs queue;
- authorized exact-unit detail and timeline;
- authorized custody-operation reconciliation.

Commands:

- remove from unit;
- receive exact returned unit;
- route after inspection;
- start/send repair;
- complete repair and optionally release;
- confirm core return;
- approve/confirm scrap;
- quarantine resolution;
- governed physical-location correction.

Every mutation includes:

- actor-derived tenant scope;
- exact entity identifiers;
- expected version;
- idempotency key;
- normalized request hash;
- server-derived allowed transitions;
- deterministic locking order;
- append-only event/audit evidence;
- one atomic stock movement when and only when availability changes.

Do not trust client-provided company, location, condition eligibility, availability, ownership proof, or transition targets without server revalidation.

## 11. Permissions

| Action | Mechanic | Office/parts | Admin |
|---|---:|---:|---:|
| View assigned unit installed parts | Assigned work only | Scoped locations | Scoped companies |
| Remove exact part | Assigned active work + explicit capability | Explicit location capability | Explicit capability |
| Receive handoff | No default | Explicit location capability | Explicit capability |
| Inspect/route | No default | Explicit location capability | Explicit capability |
| Release reusable/refurbished | No default | Explicit release capability | Explicit release capability |
| Confirm core return | No default | Explicit disposition capability | Explicit disposition capability |
| Confirm scrap | No default | Explicit disposition capability | Explicit disposition capability |
| Change lifecycle policy | No | No | Admin only |

The same authorized person may remove, receive, route, inspect, release, or dispose the same case. Capabilities, exact-unit confirmation, evidence, version checks, and separate event timestamps remain mandatory; operator identity is preserved in every event instead of forcing an extra employee.

All-location views are read-only summaries. A mutation requires one explicit location context and reauthorization.

## 12. Migration And Compatibility Plan

Use expand/transition/contract discipline through additive migrations:

1. Add nullable/default-safe projection fields and new tables.
2. Deploy code that dual-reads legacy state and new projection.
3. Backfill in bounded batches with reconciliation reports.
4. Enable new commands and dual-write current projection plus append-only events.
5. Compare aggregate balances, exact-unit states, active usages, and open custody cases.
6. Make constraints stricter only after zero invalid rows are proven.
7. Remove compatibility reads only in a later separately reviewed migration.

Backfill rules:

- active installed usage → asset holder;
- `in_stock`/reserved units → owning inventory location; catalog bin may be displayed as inherited, not exact-unit proof;
- open reuse case → holder/queue derived from case;
- scrapped → scrap/disposed holder;
- legacy removed without case → Unknown/Quarantine;
- existing condition → Unknown unless a durable event proves New or a reviewed reuse/refurbishment outcome.

Existing in-stock Unknown units remain usable during transition to avoid silently removing valid stock, but show Unclassified. Configured repairable/core parts require classification at the next governed return/release.

Rollback strategy:

- application rollback remains possible while old columns and meanings stay intact;
- additive tables/columns remain dormant after rollback;
- no destructive down migration after new events are written;
- correction uses a forward migration and reconciliation command;
- staging migration rehearsal and backup verification are required before production authority is requested.

## 13. Failure And Recovery

- Persist idempotent command before uncertain POST.
- Disable duplicate action while pending.
- On timeout/5xx, reconcile the command result before retry.
- Preserve queue filters, selected row, entered notes, and scanned identity after recoverable validation failures.
- On stale version, reload the exact current holder/condition and explain who/what changed.
- Duplicate scans are successful no-ops only when request identity and result match.
- A wrong serial scan fails without revealing cross-company/location details.
- If stock ledger and exact-unit projection disagree, quarantine the unit and create a reconciliation exception; never guess a repair or availability state.

## 14. Responsive And Accessibility Contract

Desktop 1440:

- dense queue table with part, serial, holder, age, route, and next action;
- secondary detail panel for action/history;
- no page-wide modal for ordinary inspection/receiving.

Tablet 768:

- reduced columns with identity, holder, queue, and next action retained;
- filters wrap without horizontal page scrolling.

Phone 390:

- queue rows become stacked cards;
- one page scroller;
- full-width 44px actions;
- scanner opens camera-first with manual entry fallback;
- no nested table or nested horizontal scroll;
- sticky action never obscures focused input.

All widths:

- visible focus;
- logical keyboard order;
- status is never color-only;
- errors remain next to the failed field/action;
- 200% zoom preserves identity, current holder, and next action;
- optional explanation stays behind accessible help, while required status and warnings remain visible.

## 15. Implementation Slices

### Slice 1 — Domain contract and projections

- document constants and transition matrix;
- additive schema and indexes;
- exact-unit custody/condition projection;
- migration/backfill rehearsal and reconciliation queries;
- no UI cutover yet.

Exit: current data maps without fabricated facts; legacy application remains compatible.

### Slice 2 — Server commands and queue reads

- simplified remove payload with intended route;
- atomic Office/Admin removal-workorder creation when needed;
- receive-and-route command;
- repair/core/scrap/quarantine commands;
- paginated scoped queue and exact-unit reads;
- authorization, replay, concurrency, and stock-math tests.

Exit: every lifecycle transition is safe through API/DB tests.

### Slice 3 — Unit-page removal

- replace current form with reason, intended route, optional note;
- derive single workorder/location;
- show ownership only as an exception;
- preserve reconciliation recovery;
- display committed result and queue destination.

Exit: ordinary removal requires at most three decisions.

### Slice 4 — Inventory Stock

- Stock/Returns & repairs peer navigation;
- ready/reserved/installed/action-needed counts;
- part detail condition and location breakdown;
- searchable/paginated exact units;
- exact-unit current holder and history.

Exit: a user can answer “how many, where, which condition, and which exact unit?” without leaving Inventory.

### Slice 5 — Returns & repairs

- queue tabs and server counts;
- QR/manual receiving;
- receive-and-route action;
- repair, core, scrap, and quarantine detail/actions;
- rename Operations label to Part requests.

Exit: every action-needed unit has one visible next action.

### Slice 6 — Integration and rendered acceptance

- workorder exact-unit picker condition grouping;
- unit and inventory history links;
- responsive, accessibility, failure/recovery, and realistic-volume verification;
- authenticated mechanic/office/admin browser journeys;
- physical camera/device verification called out separately.

Exit: all acceptance gates pass or exact unverified gates remain explicit.

## 16. Acceptance Gates

1. Ordinary Unit → Remove part completes with at most three operator decisions.
2. One eligible workorder and one receiving location require no manual selection.
3. Removal immediately leaves Installed and enters Awaiting handoff without increasing stock.
4. Receiving requires an exact serial and explicit physical-location confirmation.
5. New, Reusable, and Refurbished counts reconcile to exact ready units.
6. Handoff, inspection, repair, core, scrap, quarantine, installed, issued, and reserved units never count as ready.
7. Release adds one stock unit once; duplicate/replayed/concurrent release cannot add another.
8. Reinstallation creates a new usage episode while preserving serial, receipt, invoice, and previous-unit history.
9. Core financial credit and physical core return remain separately auditable.
10. Scrap never deletes identity or history.
11. Wrong serial, wrong catalog part, wrong unit, wrong location, cross-company, revoked capability, guessed ID, and stale version all fail safely.
12. Every queue is server filtered/paginated and preserves state after refresh or correction.
13. Legacy backfill produces no invented condition, location, ownership, cost, serial, or invoice fact.
14. Aggregate balance equals eligible exact ready units for serialized whole-unit stock after reconciliation.
15. Normal, empty, loading, error, long-content, permission, recovery, and concurrent-change states work at 1440, 768, and 390 widths.
16. Keyboard, focus, screen-reader labels, 200% zoom, reduced motion, camera-first scan, and manual fallback pass.
17. Existing inventory, workorder part request, exact issue/install, Units, invoice lineage, and custody tests remain green.

## 17. Adversarial Stress Test

### Saboteur findings

#### Finding A — One status field will corrupt truth

Attack: set a unit to `refurbished` and accidentally treat that condition as availability even while it remains at a vendor.

Resolution: separate condition, holder, workflow case, and server-derived availability. Ready requires every release predicate.

#### Finding B — Removal can double-add stock

Attack: double-click, retry after timeout, or race two reviewers.

Resolution: deterministic row locks, expected version, actor-scoped idempotency/request hash, conditional unit update, unique open case, and one unique stock movement per release command.

#### Finding C — Warehouse location lies while installed

Attack: display owning `location_id` as current physical location and send a picker to a bin where the part does not exist.

Resolution: owning inventory location and current physical holder are separate fields. Installed holder points to the unit.

#### Finding D — Refurbishment completion bypasses inspection

Attack: vendor marks repair complete and unit becomes available without receipt or inspection.

Resolution: repair completion returns to Needs inspection unless a properly authorized receive/inspect/release transaction satisfies all gates.

#### Finding E — Scrap becomes a destructive shortcut

Attack: wrong scan followed by irreversible deletion.

Resolution: scrap first enters Scrap approval, never changes ready quantity twice, requires explicit disposition authority/evidence, and retains identity/events permanently.

### New Hire findings

#### Finding F — Vocabulary is internally correct but operator-heavy

Risk: users see custody, condition, availability, disposition, and status together.

Resolution: UI exposes only contextual labels: Where it is, Condition, Ready/Not ready, Next action. Technical axes remain server/domain concepts.

#### Finding G — Too many new pages

Risk: separate pages reproduce Odoo/Maximo complexity.

Resolution: only Stock and Returns & repairs inside existing Inventory. Use existing part detail and secondary detail patterns.

#### Finding H — “Reusable” is ambiguous

Risk: remover’s visual judgment becomes final approval.

Resolution: removal choice is “Inspect for reuse.” Final condition “Reusable” exists only after governed inspection/release.

### Security Auditor findings

#### Finding I — All-location queues create IDOR risk

Attack: filter/query another location or reuse an ID from another tenant.

Resolution: actor-derived company/location sets on every read; mutations require one explicit authorized location; indistinguishable not-found/forbidden behavior where disclosure matters.

#### Finding J — Client chooses condition and availability

Attack: call release endpoint with `condition=new` or `available=true`.

Resolution: strict schemas reject unknown fields; server derives transition, condition, holder, and stock movement from the locked current state.

#### Finding K — Hidden auto-created workorders permit spam or bypass

Attack: repeat removal requests to generate workorders or avoid workorder authorization.

Resolution: workorder creation and removal share one idempotent transaction; only Office/Admin can auto-create; mechanic remains bound to assigned active work; exact unit permits one open case.

### Stress-test verdict

**CONCERNS resolved in revised plan.** No known critical design blocker remains. Implementation remains HIGH risk because migration, tenancy, concurrency, and stock arithmetic require PostgreSQL and authenticated browser evidence. Physical-device scanning, production-scale query plans, and real operator comprehension remain unverified until implementation/testing.

## 18. Explicit Non-Goals

- no full purchasing redesign;
- no financial core-credit posting in the custody command;
- no generalized repair-shop ERP;
- no individual serialization for fluids or arbitrary aggregate consumables;
- no replacement of current workorder part-request workflow;
- no production migration, commit, push, or deployment without separate authority;
- no claim of physical location when evidence is unknown.

## 19. Definition Of Done

The feature is complete only when an authorized user can:

1. open a unit;
2. remove one exact tracked part with a short form;
3. find it immediately in Awaiting handoff;
4. scan and receive it into a real location/bin;
5. route it to reuse, refurbishment, core, scrap, or quarantine;
6. release only a safely eligible unit;
7. install the same exact unit on another vehicle;
8. see the uninterrupted lifetime history from source receipt through both installations;
9. reconcile exact-unit Ready counts with aggregate stock;
10. complete the workflow at desktop, tablet, and phone widths without hidden required information or unsafe shortcuts.

## 20. Production Contract: State, Accounting, and Compatibility

This section is normative for implementation. If an earlier illustrative sentence conflicts with this section, this section wins.

### 20.1 Two different count contracts

`inventory_items.quantity_on_hand` and `quantity_reserved` remain the authoritative aggregate ledger projections. They are not a count of physical objects in every workflow state.

| Measure | Definition | Includes | Excludes |
|---|---|---|---|
| On hand | Existing local ledger balance | ready stock and a pending installation that has not yet been approved/issued | approved installed, removed-hold, repair, core, scrap and quarantine units |
| Reserved | Existing active reservation balance | `reserved` and `installed_pending_approval` usage until it is approved, released, or removed | approved installed and every custody case |
| Ledger available | `max(quantity_on_hand - quantity_reserved, 0)` | unreserved aggregate balance eligible under existing ledger rules | a reservation even when its exact unit is physically fitted pending approval |
| Exact ready | Count of whole tracked units that meet every Ready predicate below | `in_stock` units with a ready condition, inventory holder, no open case, and no active usage | unknown/unavailable states; it is a subset/projection, not a substitute for legacy aggregate availability |
| Installed | exact usages in `installed` or `installed_pending_approval` | both approved and pending fitted placements | removed historical episodes |
| Action needed | exact units with an open custody/reconciliation case | handoff, review, repair, core, scrap and quarantine | normal reservation and installed placement unless an exception case exists |

The Stock screen uses **Available**, **Reserved**, **Installed**, and **Needs attention**. Its Available detail separates New, Reusable, Refurbished, and Unclassified legacy units; aggregate consumables retain quantity/UOM presentation. The API and reconciliation retain distinct ledger-available and exact-ready measures, but these technical terms are supporting detail rather than primary operator labels. Never call `quantity_on_hand` “Ready,” combine overlapping measures into a total, or imply that aggregate inventory has individual condition/custody proof.

### 20.2 Ready predicate and the unknown compatibility rule

For a newly projected exact unit, Ready is true only when all are true:

```text
unit.status = in_stock
AND custody_holder_type = inventory_location
AND condition_code IN (new, serviceable_used, refurbished)
AND no open reuse/disposition/repair/reconciliation case exists
AND no active serialized usage exists
```

Existing `in_stock` serialized units with no durable condition evidence are deliberately **legacy available**, not **Ready exact units**: they remain selectable by the pre-existing picker while the compatibility flag is enabled, show `Unclassified legacy stock`, and cannot be auto-promoted to reusable/refurbished. A lifecycle-policy part must be classified on its next governed return or release. The implementation must not change their ledger on-hand/reserved figures merely by adding projections. A later separately approved cutover may require classification for selection; it is not part of this rollout.

### 20.3 Exact transition and movement matrix

All rows lock the scope, case/usage/unit, and aggregate balance in the existing deterministic order; each command is idempotent by actor/key/request hash. “No” in the movement column means no `inventory_stock_movements` row and no aggregate delta.

| Command / source state | Exact projection after commit | Case state | `on_hand` delta | `reserved` delta | Movement | Notes |
|---|---|---|---:|---:|---|---|
| Existing/local receipt → `in_stock` | holder inventory location/bin; condition `new`, `serviceable_used`, or `refurbished` only when supplier/inspection evidence supports that exact assertion; otherwise `unknown` | none | +1 per whole local unit already created by receipt writer | 0 | existing receipt | Fresh receipt is not automatically New: purchased used/refurbished stock retains its supported condition. New projection must never duplicate receipt movement. |
| Reserve ready/legacy unit | `reserved`; holder remains inventory location | none | 0 | +1 | existing reservation | Condition/holder must remain factual. |
| Issue then pending install | `installed_pending_approval`; holder asset | none | 0 | 0 | no issue yet | It is still on-hand and reserved. |
| Approve pending installation | `installed`; holder asset | none | -1 | -1 | existing `issue` | One approval consumes once. |
| Release reservation before approval | `in_stock`; holder inventory location | none | 0 | -1 | no | Restores picker eligibility; no physical receipt. |
| Remove approved installation | `removed`; holder handoff | `awaiting_handoff` | 0 | 0 | no | It was already consumed on approval. |
| **Remove pending installation** | `removed`; holder handoff | `awaiting_handoff` | **-1** | **-1** | **one existing-style `issue`** | Required exception: the physically fitted pending part is still on-hand/reserved, so removal consumes both once before custody hold. |
| Receive handoff | `removed`; actual physical holder/location/bin | `received_pending_review` | 0 | 0 | no | Receipt confirms custody only; it does not restore stock. |
| Inspect → release reusable | `in_stock`; inventory holder/bin; `serviceable_used` | completed/released | +1 | 0 | one `return` | Only after evidence, policy, ownership and capability gates. |
| Route/start repair | `removed`; internal/external repair holder; `needs_repair` | repair | 0 | 0 | no | No return until release. |
| Repair complete, not released | `removed`; receiving/review holder; condition remains `needs_repair` or `unknown` | needs inspection | 0 | 0 | no | Vendor completion cannot make stock ready. |
| Repair completion + authorized release | `in_stock`; inventory holder/bin; `refurbished` | completed/released | +1 | 0 | one `return` | Same release guards; one authorized operator may complete the steps while each event remains separately audited. |
| Route/confirm core return | `removed`; core holding/vendor holder; `unserviceable` | core / completed | 0 | 0 | no | Future credit links financial evidence only. |
| Route/confirm scrap | `scrapped`; scrap/disposed holder; `unserviceable` | scrap / completed | 0 | 0 | no | Never hard-delete. |
| Quarantine/resolution without release | exact status remains unavailable; factual holder/condition updated | quarantine or next required state | 0 | 0 | no | Resolution cannot increase stock except an explicit governed release. |
| Legacy untracked removal | create one new exact identity in unavailable custody state | awaiting handoff or quarantine | 0 | 0 | no | No backfilled receipt, cost, ownership, serial, or prior installation. |

The invariant is therefore **not** `aggregate on_hand = exact Ready`. Reconciliation must separately prove: (a) ledger deltas equal append-only movements; (b) each tracked whole local receipt/issue/return has one coherent exact identity/usage projection; and (c) Ready exact units are a subset of unreserved in-stock exact units. It must report, rather than “fix,” legacy aggregate and unclassified differences.

### 20.4 Expanded case state machine

Allowed forward states are:

```text
awaiting_handoff
  -> received_pending_review
  -> repair | core_pending_return | scrap_pending_approval | quarantine | released
repair -> repair_complete_pending_review | quarantine
repair_complete_pending_review -> released | repair | quarantine | scrap_pending_approval
core_pending_return -> core_returned | quarantine
scrap_pending_approval -> scrapped | quarantine
quarantine -> received_pending_review | repair | core_pending_return | scrap_pending_approval
```

`hold` remains readable legacy compatibility and maps to `received_pending_review` plus its recorded reason during transition. Terminal `released`, `core_returned`, and `scrapped` are immutable except a separately audited correction that creates a new corrective case/event; no generic status PATCH exists. `inventory_reuse_cases.status` must be expanded additively; legacy `released` retains its existing meaning.

## 21. Schema, Constraints, and Migration Detail

Create new numbered migrations after the currently applied `113_inventory_reuse_custody.sql` and `114_inventory_reuse_evidence_constraints.sql`; never amend them. The exact filenames/numbers are assigned only after checking the current migration head at implementation time.

1. Add nullable `condition_code`, `custody_holder_type`, `custody_location_id`, `custody_asset_id`, `custody_bin_location`, `external_holder_reference`, `custody_version`, `condition_updated_at/by`, and `custody_updated_at/by` to `inventory_serialized_units`. Keep current `location_id` as owning location. Add a compatibility marker such as `custody_projection_source`/`condition_evidence_state` so `unknown` facts do not masquerade as reviewed condition.
2. Expand `inventory_reuse_cases` with `intended_route`, `final_route`, `case_version`, receiving holder/bin and terminal timestamps. Add child tables for repair activity and disposition/vendor references rather than a nullable-column collection. Retain existing `usage_id` uniqueness and add a partial unique open-case-per-unit constraint covering every nonterminal state.
3. Extend `inventory_reuse_operations.action` and `inventory_unit_events.event_type` checks additively for route, repair, repair completion, core, scrap, quarantine, and correction. Preserve every existing event/check shape; new event types that lack a workorder must have an explicitly compatible workorder-shape rule.
4. Add check constraints only where a DB constraint can prove a local fact: enumerations; a holder-type/reference-shape condition; no asset reference for an inventory holder; and terminal evidence requirements. Cross-table facts (active usage, open case, aggregate movement) are enforced in locked commands plus reconciliation, not fragile check constraints.
5. Use composite `(company_id, location_id)` and `(company_id, id)` foreign keys consistently with the existing tenant model. The migration must confirm the actual bins schema before adding a foreign key; until then, `custody_bin_location` is a validated text snapshot, not an invented `bins` relation.
6. Add keyset indexes for queues: `(company_id, location_id, status, updated_at desc, id desc)` and relevant route/vendor variants; exact-unit reads by part/status/condition; and active holder/case lookup. Verify `EXPLAIN (ANALYZE, BUFFERS)` against representative data before retaining each index.

Backfill is resumable, transaction-batched, and writes only projections/events explicitly marked `migration_backfill`; it does not alter balances. Map active installed/pending usage to asset holder, exact in-stock/reserved to owning inventory holder, existing cases to their case state, and legacy removed without case to unknown/quarantine. Do not infer bins, ownership, serials, costs, conditions, invoices, vendors, or historic holder movements. Produce counts and exception IDs for every unmappable row.

Rehearsal order: restore production-shaped sanitized snapshot in isolated staging DB; run expand migration; run backfill in restartable batches; run reconciliation; exercise old binary against expanded schema; deploy dual-read/dual-write; run reconciliation again; then enable UI/commands behind the compatibility gate. Rollback before new commands means application rollback with additive structures idle. After new events exist, rollback is forward-only: disable commands/feature flag, preserve evidence, diagnose, and ship a corrective migration/command. Take and verify a pre-migration backup/restore; do not run production migration in this task.

## 22. API Contract (Versioned Under Existing Inventory Reuse Routes)

Keep legacy endpoints working during migration. Add cursor pagination (`limit` 1–100, opaque cursor, stable `updatedAt,id` ordering) to every queue/read; never return a guessed total. All commands use strict schemas, body scope validation, actor-derived authorization, `expectedVersion`, and `idempotencyKey` (8–120 chars); all success payloads include current `case`, `unitProjection`, `ledgerEffect`, `operationId`, and `replayed`.

| Endpoint | Request essentials | Response / errors |
|---|---|---|
| `GET /api/inventory-reuse/stock` | scope, part/location/state/condition filters, cursor, limit | stock rows with ledger and exact counts; `nextCursor`; 400 invalid filter, 403 scope, 409 reconciliation-required where a requested exact action is unsafe |
| `GET /api/inventory-reuse/queue` | scope, queue/route/vendor/age/query/cursor/limit | stable paginated cases and counts scoped to authorized locations; no unbounded all-location query |
| `GET /api/inventory-reuse/units/:id` | scope | exact detail/timeline/redacted unavailable data; 404/403 disclosure-safe |
| `POST /remove` | existing fields plus `intendedRoute`, optional note, `expectedVersion`; optional auto-create only for Office/Admin | case `awaiting_handoff`; errors `INVENTORY_REUSE_CHANGED`, `...FORBIDDEN`, `...SEPARATION_REQUIRED`, `...REPLAY_CONFLICT`, `...PENDING_LEDGER_CONFLICT` |
| `POST /:id/receive` | evidence, actual holder/location/bin, optional corrected route, expected version | `received_pending_review` or authorized route result; exact scan mismatch is 409 without cross-scope details |
| `POST /:id/route` | final route, evidence, expected version | repair/core/scrap/quarantine/review state; never release |
| `POST /:id/repair/start`, `/repair/complete` | handler/vendor, dates/evidence; completion evidence/version | repair or pending-review state; vendor completion is not release |
| `POST /:id/release` | inspection evidence, holder/bin, expected version | released exact unit and exactly one return movement; 409 stale/policy/ownership/ledger mismatch |
| `POST /:id/core-return`, `/:id/scrap`, `/:id/quarantine/resolve` | required disposition/resolution evidence and version | terminal/next state, no stock increment unless separate release |
| `GET /operations/:key` | existing scope/key | reconciliation-safe replay result; retained for interrupted client recovery |

Return validation errors as existing `{ error, code: "validation_error", issues }`; domain errors as `{ error, code, retryable }`. Concrete error-code names above are required to be finalized alongside the strict Zod schemas and route tests; clients branch on `code`, not prose. Commands reject client fields for company authority, derived availability, condition eligibility, ledger deltas, actor, and arbitrary target status.

## 23. Authorization and UI Boundaries

The existing reuse service/repository currently authorizes the **workorders** product module for every reuse read/write, and additionally `partsScanning` for Unit removal/asset reads. Preserve that contract for Unit detail: mechanic removal remains tied to assigned accepted/in-progress work and `partsScanning`; Office/Admin can use the existing open-workorder exception. Do not weaken it to an Inventory-page-only permission.

There is no current `inventory` product-module key: `shared/product-modules.js` currently exposes workorders and inspections only. Therefore this rollout deliberately retains workorders-module policy compatibility for custody queue reads/writes rather than inventing a module-system redesign. Inventory route role/company/location guards remain the read boundary: use the existing broad company inventory read scope for Office company-wide read-only summaries, but return actionable custody details only after the existing workorders-policy and explicit capability checks. Mutations always require one explicit location plus location membership and the named capability. Expand grants from `remove/receive/release` to named route/repair/disposition/quarantine capabilities only with an additive migration and Admin configuration UI. Separation: remover cannot receive, route-to-release, release, core-return, or scrap their own case; a different authorized actor can receive then route when no release/disposition is included.

Removal UX remains only reason, intended route, optional note in the common case. Existing fields (`usageId`, workorder context, exact serial, owner/location) are derived. Ownership appears only when durable source facts do not determine it. Auto-created removal workorders remain a single idempotent server transaction, Office/Admin-only, and must not be added client-side.

## 24. Writer Inventory and Integration Work Packages

Every existing writer must be inspected and either dual-write the new projection or be explicitly unchanged because it cannot affect custody/condition. The known canonical owners are:

| Work package | Current owner files | Required implementation responsibility |
|---|---|---|
| Schema/reconciliation | `src/server/db/migrations/113_inventory_reuse_custody.sql`, `114_inventory_reuse_evidence_constraints.sql`, new migrations; `scripts/qa/inventory-custody-local.js` | additive schema, resumable backfill, projection/ledger reconciliation and pending-removal fixture |
| Custody commands | `src/server/db/repositories/inventory-reuse.repo.js`; `src/server/modules/inventory/inventory-reuse.service.js`, `.schemas.js`, `.test.js`, `.integration.test.js`; `src/server/routes/inventory-reuse.routes.js`, `.test.js` | state machine, locks, capabilities, strict APIs, ledger matrix, pagination |
| Exact unit reservation/issue/install/remove/approve | `src/server/db/repositories/inventory-unit-workorder-usage.repo.js`; `src/server/modules/inventory/inventory-unit-workorder.service.js` and tests; `src/server/routes/inventory-unit-workorder.routes.js` and tests | reserve/issue/pending/approve/release/remove projection updates; preserve one active usage and pending exception |
| Create-workorder exact selection | `src/server/db/repositories/operational-workorders.repo.js`; create workorder service/routes and `frontend/src/features/workorder-modules/parts/CreatePartsModule.jsx` | `inventoryUnitSelections` must accept only server-eligible exact units; conditions are display/filter hints, never client authorization |
| Aggregate reservations/approval | `src/server/db/repositories/inventory-aggregate-workorder-usage.repo.js`; its service/tests | aggregate counts remain ledger truth; no false exact Ready claim for measured/legacy stock |
| Receipt, count and serialized creation | `src/server/db/repositories/local-inventory.repo.js`, `inventory-receipts.repo.js`, `inventory-part-serialization.repo.js`, `inventory-count-imports.repo.js`; corresponding inventory services/tests | initialize only factual holder/condition projections; receipts/counts/transfers must not create a duplicate movement |
| Catalog/detail/read model | `src/server/modules/inventory/inventory-part-details.service.js`, `inventory-part-serialization.service.js`, `local-inventory.service.js`; `src/server/modules/inventory/inventory.routes.js` | stock summaries, exact-unit filtering and source/legacy labels; inspect all direct inventory reads before changing list semantics |
| Units experience | `frontend/src/features/units/UnitPartsLifecycle.jsx`, `unit-parts-lifecycle-model.js`, tests; `UnitsWorkspace.jsx` | simplified removal and recovery, route destination, scope-safe fetch/refresh |
| Inventory experience | `frontend/src/features/inventory/InventoryWorkspace.jsx`, inventory workspace/scan contract tests; Office/Admin shells | peer Stock/Returns tabs, cursor queues, secondary detail, state preservation, explicit permission empty/error states |
| Operations naming/history | `frontend/src/components/operations/PartRequestQueue.jsx`; unit/history projections including `src/server/db/repositories/units-directory.repo.js` and `src/server/modules/workorders/unit-service-history.service.js` | label Part requests; retain historical removed episodes and canonical event IDs without duplicate timeline entries |

At implementation kickoff, run a repository-wide search for `inventory_stock_movements`, `quantity_on_hand`, `quantity_reserved`, `inventory_serialized_units`, `workorder_serialized_part_usages`, `inventory_unit_events`, and every receipt/transfer/issue/return writer. Update this table with any owner discovered after this plan; do not assume the list is exhaustive.

## 25. Required Test, Monitoring, and Recovery Evidence

Database/integration tests must cover the entire matrix, especially: reserve → pending install → remove (one `issue`, on-hand -1/reserved -1) → receive → release (one `return`); approved install → removal (zero movement) → same-actor receipt → release (one return); idempotent replay/key mismatch; two concurrent release attempts; stale case/unit version; cross-company/location serial and case IDs; policy/ownership/evidence/revoked-capability failures; legacy unknown remains selectable under compatibility but not Ready exact; repair/core/scrap/quarantine cannot enter Ready; and exact identity reuse creates a new installation episode.

Read/API tests must prove opaque-cursor stability under inserts, filter composition, limits, empty/loading/error values, no fake zero when a count is unavailable, and no unbounded child/queue list. Migration tests must run expand/backfill twice safely, compare pre/post ledger totals and movement counts, emit exception rows instead of invented data, and demonstrate old-reader compatibility before cutover.

Authenticated browser journeys: mechanic removal from assigned active work; Office/Admin removal with exactly one eligible workorder and with atomic minimal-workorder exception; same-operator receive using scan/manual fallback and location/bin entry; authorized inspector repair/release; optional multi-operator handoff; core and scrap approvals; quarantine recovery; Stock and Returns filter/cursor/detail retention after refresh/stale conflict; correct counts after pending removal; and 1440/768/390, keyboard, 200% zoom, screen-reader naming, long serial/notes, and camera fallback. Camera hardware/real scanner and production-scale query-plan results remain separately marked **not verified** until actually executed.

Operational monitoring: dashboard/alerts for reconciliation exceptions, commands stuck in awaiting handoff/repair/core/scrap/quarantine beyond policy age, command replay conflicts, permission denials spikes, migration batch failures, and queue query p95/error rate. Every alert links to a read-only case/unit/operation view and runbook: freeze affected command via feature gate, reconcile operation by idempotency key, lock/quarantine only the mismatched unit, correct forward with an audit event, and rerun scoped reconciliation. Never mass-adjust balances automatically.

## 26. Implementation Decisions and Remaining Decisions

Decided by this production plan:

- Pending installation removal consumes on-hand and reserved exactly once; approved installation removal does not.
- `unknown` legacy stock remains ledger-usable during compatibility but is not Ready exact stock.
- Ready exact units and aggregate ledger availability are different displayed/reconciled measures.
- Current physical holder is separate from owning `location_id`; bin relation is not invented before schema inspection.
- The existing custody API and history are extended additively; append-only movements/events and idempotent recovery remain mandatory.

Implementation defaults resolved for coding:

1. `custody_bin_location` is optional validated text; no bins table or required-bin policy is introduced.
2. Extend the existing location-scoped reuse policy with lifecycle route eligibility; do not grant capabilities implicitly.
3. Store evidence notes and durable external references using existing evidence patterns; no upload subsystem or regulatory-retention claim is added.
4. Per-unit grandfathered legacy availability remains until that unit is governedly classified; no timed global cutover is introduced.

### Adversarial completion check

This specification rejects the two unsafe shortcuts most likely to appear in implementation: equating Ready with aggregate on-hand, and treating a pending fitted unit as already consumed before its removal/approval writer records the issue. It also rejects a UI-only Inventory queue permission change that bypasses the current Unit/workorder/parts-scanning authorization path.

## 27. Full-Feature Release Acceptance Addendum

These criteria are required for the implementation, alongside section 16. A partial schema or navigation-only delivery does not satisfy them.

| ID | Concrete acceptance | Required evidence |
|---|---|---|
| PROD-01 | An untracked physical part can begin permanent tracking from the Unit removal flow. Its source is explicitly a present-day removal observation, not an invented historical purchase. Receipt-based legacy joins either support that source kind honestly or use a separately modeled nullable lineage. Original invoice/cost/installation remain unavailable. | Actual API + PostgreSQL + browser removal, scan resolution, detail, handoff, ownership hold, release and subsequent installation. No receipt-stock increase at tracking creation. |
| PROD-02 | Changing the current shelf/bin requires an expected version, reason and audit event recording prior/current holder. It cannot modify original receipt, installation history, owning warehouse, or balances. | Successful correction, stale/concurrent correction and replay tests; refreshed detail and timeline. |
| PROD-03 | Admin can configure and revoke every new capability and lifecycle policy in the existing setup UI. Grant/revoke records prior and next effective values. | Admin/Office/mechanic negatives, explicit grants, revoked access on mutations and recovery reads, rendered setup. |
| PROD-04 | Core-return and scrap completion capture destination/reference, occurrence date, actor and evidence. Conflicting installation or holder blocks completion. Identity remains searchable after completion. | Missing reference, wrong scope, replay and concurrent terminal command tests; terminal detail and timeline. Financial credit changes never change stock. |
| PROD-05 | Invoice receipt, manual intake, opening count, serialized creation and workorder usage update condition/custody coherently. Each source has either supported condition evidence or a visible unknown classification with its explicit compatibility reason. | Cross-writer PostgreSQL tests, quantity/movement reconciliation, scan and picker eligibility agreement. |
| PROD-06 | New commands require case/unit version and return authoritative current state. Legacy compatibility cannot create an unversioned bypass for new repair/disposition/correction commands. | Real route/schema success and stale/omitted version failures, duplicate command reconciliation. |
| PROD-07 | Receiving confirms the exact physical serial/QR and actual holder. A selected case alone is not proof of receipt; wrong serial cannot complete handoff. | Scan/manual paths, wrong serial and tenant negatives, actual location/bin in refreshed detail. |
| PROD-08 | Every new workflow is reachable and usable without direct API calls, including repair completion, inspection/release, core, scrap, quarantine and legacy tracking. | Authenticated browser journeys with real API/DB at desktop and phone widths. |

Cross-warehouse stock transfers require their own paired source/destination ledger lifecycle and remain outside this unit-removal/reuse feature. This release supports reinstallation on another vehicle within the same owning inventory location. A location correction or receiving request must reject a different owning location; it may never silently transfer stock, reservations, or authority. The current physical holder can identify an external repairer without changing inventory ownership.

### 27.1 Implementation stress-test refinements

- Selecting a route never changes the recorded physical holder. Repair start, verified physical return, and terminal disposition are separate evidenced movements.
- Completing repair requires the independently confirmed exact serial/QR, physical-return evidence, and a recorded bin/shelf value (blank remains explicitly unspecified). Release refuses a part still recorded outside inventory custody.
- Shelf/bin correction is limited to in-stock inventory-held units. Installed, reserved, handoff and terminal items use their lifecycle commands; a correction cannot detach an installation or silently change availability.
- Every public remove/receive/review command uses the current exact-unit/case version. There is no public unversioned compatibility bypass. Existing callers and test harnesses must move together.
- Manual creation of ready physical units asks for an evidenced New, Reusable or Refurbished classification. Existing receipt/count compatibility records retain truthful unknown classification; do not infer New from their source.
- Condition totals and work queues are calculated for the scoped part/location, independently of the current paginated page. Ready condition totals are distinct from unavailable serials with the same physical condition.
- An uncertain write must retain its original body and idempotency key. A reload checks that saved operation before offering the same-key retry; successful screens reload authoritative state instead of inventing a new version.

Implementation and automated checks do not themselves establish production deployment, physical-camera behavior or operator acceptance. Those evidence gates must be reported separately.
