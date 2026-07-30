# Spec: Mechanic, Manager, and Surveillance Handoff

**Author:** Codex and product owner
**Date:** 2026-07-29
**Status:** Approved
**Reviewers:** Product owner
**Related documentation:** `docs/DATABASE.md`, `docs/ARCHITECTURE.md`

## Context

The application already supports creating and assigning workorders, mechanic
progress, the existing mechanic completion action, Manager approval, and
Surveillance Odoo entry. The missing behavior is a precise handoff between
those existing stages. In particular, canonical database timestamps exist but
the printable form displays independently editable time fields, opening an
assigned workorder does not start it, and Manager has no explicit way to return
completed work for correction or cancel an invalid workorder.

This change strengthens the existing workflow without replacing working
surfaces. The mechanic completion action keeps its current submit behavior and
is labeled `Work done`. Manager review distinguishes correction from terminal
cancellation. Surveillance remains a read-only operational reviewer until
Manager approval, then either records the Odoo result or requests information.

## Functional Requirements

- FR-1: The system MUST set `started_at` once when an unassigned mechanic
  accepts a workorder.
- FR-2: The system MUST set `started_at` once when an assigned mechanic
  first opens a workorder that has not started.
- FR-3: A Manager, Admin, Surveillance user, or unassigned mechanic opening
  a workorder MUST NOT set `started_at`.
- FR-4: A mechanic-created workorder MUST set `started_at` in the creation
  transaction and begin in `in_progress`.
- FR-5: Repeated accept, open, reload, or concurrent start requests MUST NOT
  replace the original `started_at`.
- FR-6: The existing mechanic completion operation MUST remain the only
  mechanic submission operation and MUST be labeled `Work done` in user-facing
  UI.
- FR-7: Confirming `Work done` MUST set `mechanic_done_at` and move the
  lifecycle to `mechanic_done` in the same transaction.
- FR-8: Manager approval and Surveillance processing MUST NOT change
  `mechanic_done_at`.
- FR-9: Manager MUST be able to return `mechanic_done` work to the mechanic
  with a required reason and optional correction categories.
- FR-10: Returning work MUST move the lifecycle to `in_progress`, clear the
  current `mechanic_done_at`, preserve the prior submission in Activity, and
  create active `revision_requested` attention.
- FR-11: A subsequent `Work done` operation MUST resolve
  `revision_requested`, set a new `mechanic_done_at`, and preserve both
  completion attempts in Activity.
- FR-12: Manager or Admin MUST be able to cancel a workorder in `open`,
  `accepted`, `in_progress`, or `mechanic_done` with a required reason.
- FR-13: Cancellation MUST be transactional, set lifecycle `cancelled`, set
  `cancelled_at`, record the actor and reason, deactivate mechanic assignments,
  and release or cancel outstanding part reservations/requests.
- FR-14: Cancelled, closed, and Odoo-entered workorders MUST reject mechanic
  progress, assignment changes, return, and cancellation.
- FR-15: Manager MUST be able to update administrative fields and office
  notes before approval without overwriting mechanic-authored diagnosis, work
  performed, completion identity, or canonical timestamps.
- FR-16: Manager MUST use Return to mechanic when mechanic-authored content
  requires correction.
- FR-17: Manager approval MUST record the approving user and timestamp and
  move `mechanic_done` to `closed`.
- FR-18: Surveillance MUST NOT process Odoo before Manager approval.
- FR-19: Surveillance MUST be able to request information on a closed
  workorder with a required note while keeping the lifecycle closed and adding
  `missing_info` attention for Manager.
- FR-20: Manager MUST be able to add an audited administrative correction or
  addendum for a closed workorder with `missing_info`, without changing
  mechanic-authored evidence.
- FR-21: Surveillance marking the workorder entered MUST resolve
  `missing_info` and move lifecycle to `odoo_entered`.
- FR-22: The shared detail UI MUST display assigned mechanics and canonical
  Assigned, Started, Work done, and Manager approved timestamps as read-only
  values.
- FR-23: The printable document MUST derive Start time and End time from
  `started_at` and `mechanic_done_at`, rather than editable form snapshot time
  values.
- FR-24: Customer authorization MUST remain distinct from system timing and
  approval identity.
- FR-25: Every lifecycle, assignment, return, cancellation, correction, and
  approval mutation MUST be attributable in Activity.

## Non-Functional Requirements

- NFR-1: Lifecycle mutations MUST use a row lock and a single PostgreSQL
  transaction so partial handoffs cannot persist.
- NFR-2: Role and location authorization MUST be enforced server-side; the
  browser MUST NOT supply the acting user identity.
- NFR-3: Mutating endpoints MUST return `409` for invalid lifecycle or
  concurrent-state conflicts and MUST NOT leak database details.
- NFR-4: Buttons and dialogs MUST be keyboard accessible, labeled, and keep
  a minimum 44-by-44-pixel phone target.
- NFR-5: The detail page MUST have `scrollWidth === clientWidth` at 390x844
  and 430x932 for Mechanic, Manager, and Surveillance.
- NFR-6: Existing Preview print/fullscreen behavior, Chat, Parts, and queue
  API contracts MUST continue passing their existing tests.
- NFR-7: Database migration and health verification MUST complete with zero
  integrity failures.

## Acceptance Criteria

### AC-1: Accept starts available work (FR-1, FR-5, NFR-1)

Given an open, unassigned workorder with no start timestamp
When a permitted mechanic accepts it
Then the mechanic is assigned, lifecycle becomes `in_progress`, and
`started_at` is set once in the same transaction.

### AC-2: Assigned open starts work (FR-2, FR-3, FR-5)

Given a Manager-created assigned workorder with no start timestamp
When an assigned mechanic first opens it
Then lifecycle becomes `in_progress` and `started_at` is set
And opening it again or opening it as another role does not change that time.

### AC-3: Mechanic creation starts immediately (FR-4)

Given a mechanic creates a valid workorder for themselves
When creation commits
Then lifecycle is `in_progress` and `started_at` is set in that transaction.

### AC-4: Work done records end time (FR-6, FR-7, FR-8)

Given an assigned mechanic has active work
When the mechanic confirms `Work done`
Then lifecycle becomes `mechanic_done` and `mechanic_done_at` is set
And later Manager or Surveillance actions do not change that timestamp.

### AC-5: Manager returns work (FR-9, FR-10, FR-16, FR-25)

Given a workorder is ready for Manager review
When Manager returns it with a valid reason
Then it becomes `in_progress`, the current end time clears, the mechanic sees
Changes requested, and Activity preserves the earlier submission and reason.

### AC-6: Mechanic resubmits returned work (FR-11)

Given returned work has active revision attention
When the assigned mechanic confirms `Work done` again
Then the attention resolves, the new end time is displayed, and both attempts
remain in Activity.

### AC-7: Manager cancels active work (FR-12, FR-13, FR-14, NFR-1)

Given a cancellable workorder and outstanding assignments or part commitments
When Manager confirms cancellation with a reason
Then cancellation and dependent cleanup commit atomically, the record leaves
active queues, and the reason and actor remain visible in Activity.

### AC-8: Terminal cancellation is rejected (FR-14, NFR-3)

Given a closed, Odoo-entered, or cancelled workorder
When Manager attempts to cancel or return it
Then the API returns a stable `409` and no row changes.

### AC-9: Manager editing preserves mechanic evidence (FR-15, FR-16)

Given a workorder submitted by a mechanic
When Manager saves permitted administrative corrections
Then mechanic diagnosis and work performed remain unchanged and the permitted
changes are attributable in Activity.

### AC-10: Manager approves work (FR-17, FR-18)

Given a mechanic-done workorder
When Manager approves it
Then lifecycle becomes `closed`, approval actor/time are recorded, and it enters
Surveillance's Needs Odoo queue.

### AC-11: Surveillance requests information (FR-18, FR-19)

Given a closed workorder
When Surveillance requests information with a note
Then lifecycle remains `closed`, Manager sees Missing information in Needs
action, and the note appears in Activity.

### AC-12: Manager supplies missing information (FR-20, FR-25)

Given a closed workorder with missing-information attention
When Manager saves an allowed correction or addendum
Then Surveillance sees the update, mechanic evidence remains immutable, and the
correction is attributable in Activity.

### AC-13: Surveillance completes Odoo entry (FR-21)

Given an approved workorder has sufficient information
When Surveillance records its service order number
Then lifecycle becomes `odoo_entered` and missing-information attention clears.

### AC-14: Shared timing presentation (FR-22, FR-23, FR-24)

Given any role opens the same workorder
When the timing panel and printable preview render
Then every role sees the same canonical start/end values, those values are
read-only, and customer authorization is presented separately.

### AC-15: Responsive role workflow (NFR-4, NFR-5, NFR-6)

Given Mechanic, Manager, and Surveillance detail views at 390x844 and 430x932
When each role performs its available handoff actions
Then controls remain accessible, the document does not overflow horizontally,
and existing Preview, Chat, Parts, and navigation behavior remains usable.

## Edge Cases and Error Scenarios

- EC-1: Two mechanics accept the same open workorder concurrently: one
  transaction succeeds; the other receives `409` without becoming assigned.
- EC-2: An assigned mechanic and Manager open an unstarted workorder at the
  same time: only the mechanic may set the start timestamp.
- EC-3: A support mechanic joins already-started work: the original start
  timestamp is unchanged.
- EC-4: Return reason or cancellation reason is blank or longer than 1,000
  characters: return `400`; do not mutate the workorder.
- EC-5: Cancellation cleanup fails: roll back lifecycle, assignments, parts,
  and Activity changes together.
- EC-6: Manager submits stale detail state after another transition: return
  `409` and require reload.
- EC-7: A non-participant mechanic opens assigned work: record no start and
  return the existing authorization response.
- EC-8: Surveillance requests information before Manager approval: return
  `409` and leave attention unchanged.
- EC-9: A workorder is returned multiple times: only the current end time is
  cleared; every historical completion/return remains in Activity.
- EC-10: Existing records have printable `startTime` or `endTime` snapshots:
  canonical typed timestamps win without destructive historical rewrites.
- EC-11: A database constraint or connection failure occurs during mutation:
  return the existing generic server error and persist no partial transition.

## API Contracts

### `POST /api/mechanic/workorders/:id/opened`

The existing endpoint records access. When the authenticated actor is assigned,
it also starts an eligible unstarted workorder.

```ts
interface OpenedWorkorderResponse {
  recorded: boolean;
  started: boolean;
  workorder?: { id: string; status: string; startedAt: string | null };
}
```

### `POST /api/office/workorders/:id/return`

```ts
interface ReturnWorkorderRequest {
  reason: string; // 2..1000 characters
  categories?: Array<"diagnosis" | "work_performed" | "parts" | "photos" | "other">;
}

interface WorkorderMutationResponse {
  workorder: PublicWorkorder;
}
```

Errors: `400` invalid reason/category, `404` inaccessible workorder, `409`
invalid lifecycle.

### `POST /api/office/workorders/:id/cancel`

```ts
interface CancelWorkorderRequest {
  reason: string; // 2..1000 characters
}
```

Success returns `WorkorderMutationResponse`. Errors: `400` invalid reason,
`404` inaccessible workorder, `409` invalid lifecycle or cleanup conflict.

Existing creation, acceptance, completion, approval, missing-information, and
Odoo-entry contracts remain backward compatible except for the documented
canonical timestamp/status corrections.

## Data Models

### `operational_workorders` additions

| Field | Type | Constraints |
| --- | --- | --- |
| `cancelled_at` | `timestamptz` | Null unless lifecycle is cancelled |
| `cancelled_by_user_id` | `uuid` | Nullable FK to `user_profiles(id)`, preserve record on user removal |
| `cancel_reason` | `text` | Non-empty when cancelled, otherwise empty |
| `approved_by_user_id` | `uuid` | Nullable FK to `user_profiles(id)` |

Existing `accepted_at`, `started_at`, `mechanic_done_at`, and `closed_at` remain
canonical typed timestamps. Status and attention event tables remain the audit
source; no duplicate role-specific workorder table is introduced.

## Out of Scope

- OS-1: A new mechanic completion endpoint. The existing mark-done operation
  is retained and only its user-facing wording is standardized.
- OS-2: Electronic signature capture. Customer authorization remains text
  until a separately reviewed legal/signature workflow exists.
- OS-3: Cancelling closed or Odoo-entered workorders. These require a future
  void/reversal workflow coordinated with external accounting systems.
- OS-4: Replacing Chat, Parts, Preview, queues, or the shared detail layout.
- OS-5: Automatic production data modification during testing. Live workflow
  verification uses dedicated local/demo records.
