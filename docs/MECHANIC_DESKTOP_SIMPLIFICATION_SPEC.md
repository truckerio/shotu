# Spec: Desktop Mechanic Workflow Simplification

**Author:** Codex with Karanpreet Singh
**Date:** 2026-08-01
**Status:** Approved
**Reviewers:** Karanpreet Singh
**Related specs:** `KIOSK_MODE_SPEC.md`, `WORKORDER_HANDOFF_SPEC.md`

## Context

Mechanics use the application primarily on a shared 1920x1080 shop computer.
The current workflow is functionally complete, but it exposes queue, lifecycle,
timing, document, and office concepts before the mechanic's immediate task. A
live audit also found that the mechanic Parts view can become a read-only dead
end even though a durable structured part-request endpoint already exists.

The redesign applies Apple's clarity and progressive-disclosure principles: one
obvious next action, recognition instead of recall, and administrative detail
behind secondary disclosure. Existing workorder lifecycle rules, authorization,
audit history, autosave recovery, kiosk security, office handoff, and integration
contracts remain authoritative.

The release gate is a real desktop walkthrough at 1920x1080 plus compatibility
checks at 1440x900 and 1366x768. The implementation proceeds in independently
testable slices so a visual simplification cannot silently replace workflow
truth.

## Functional Requirements

- FR-1: A registered kiosk MUST list active mechanics in natural numeric name
  order and MUST provide visually distinguishable identity markers.
- FR-2: Selecting a mechanic MUST continue to require that mechanic's kiosk
  PIN and MUST retain the existing two-minute kiosk inactivity lock.
- FR-3: The mechanic home MUST default to assigned work and MUST identify one
  deterministic next job when assigned work exists.
- FR-4: The next-job presentation MUST provide exactly one primary action:
  `Continue job` for in-progress work or `Start job` for accepted work.
- FR-5: Available work MUST remain reachable without mixing its Accept actions
  into the assigned-work list.
- FR-6: Waiting, completed work, search, filters, and workorder creation MUST
  remain reachable as secondary actions.
- FR-7: Opening or accepting work MUST preserve the existing canonical start
  timestamp behavior and MUST NOT overwrite an already-recorded start time.
- FR-8: The primary mechanic detail navigation MUST expose Work, Help, and
  Parts; Unit, Activity, and Preview MUST remain reachable through secondary
  disclosure.
- FR-9: The Work view MUST prioritize concern, diagnosis, and repair-completed
  fields before administrative timing facts.
- FR-10: Diagnosis and repair-completed values MUST autosave, retain local
  recovery on failure, survive a full reload after server confirmation, and flush
  before leaving or completing work.
- FR-11: The Work view MUST NOT display a manual Save progress action while
  autosave is authoritative; it MUST display compact saved/saving/error feedback.
- FR-12: The Help view MUST retain existing message/photo APIs and MUST expose
  direct actions for taking a photo, asking office, and reporting another problem.
- FR-13: An assigned mechanic with `requestParts` permission MUST be able to
  submit a structured part request from the Parts view using the existing mechanic
  part-request endpoint.
- FR-14: A structured part request MUST preserve the durable office review,
  allocation, inventory, and request-event workflow.
- FR-15: A mechanic MUST be able to mark eligible work done without typing
  their name; the authenticated actor MUST remain the completion identity.
- FR-16: Work done MUST require non-empty repair-completed text, flush pending
  progress, record the canonical mechanic-done time, and enter office review.
- FR-17: The mechanic and kiosk UI MUST support English (`en`), Punjabi (`pa`),
  and Spanish (`es`) interface strings through one shared translation owner.
- FR-18: A mechanic's preferred locale MUST persist server-side and MUST fall
  back to English for missing or invalid translation keys.
- FR-19: Dynamic workorder text MUST preserve the original value; interface
  localization MUST NOT rewrite concern, diagnosis, repair, chat, or part content.
- FR-20: Office, surveillance, admin, print, fullscreen Preview, realtime
  refresh, and integration behavior MUST remain unchanged unless explicitly
  consumed through an opt-in mechanic variant.

## Non-Functional Requirements

- **NFR-A1:** Every interactive control MUST be keyboard reachable with a visible
  focus indicator and a minimum 44x44 CSS-pixel target.
- **NFR-A2:** Normal text contrast MUST be at least 4.5:1 and state MUST NOT be
  communicated by color alone.
- **NFR-A3:** The kiosk, mechanic home, and mechanic detail MUST remain usable at
  200% browser zoom without clipped controls or horizontal page overflow.
- **NFR-L1:** At 1920x1080, 1440x900, and 1366x768,
  `documentElement.scrollWidth` MUST equal `documentElement.clientWidth`.
- **NFR-L2:** Primary mechanic content SHOULD remain in a readable centered column
  rather than stretching text fields to the full 1920-pixel viewport.
- **NFR-R1:** Confirmed progress MUST survive a complete browser reload and failed
  progress requests MUST retain the existing device recovery copy.
- **NFR-R2:** Concurrent realtime refresh MUST NOT overwrite dirty or in-flight
  mechanic progress.
- **NFR-S1:** Part requests, completion, and messages MUST continue to use server
  authorization derived from the authenticated actor; client-supplied actor IDs
  MUST NOT be trusted.
- **NFR-S2:** Removing typed-name completion MUST NOT weaken kiosk PIN or session
  expiry protections.
- **NFR-P1:** Home view derivation and locale lookup MUST be synchronous and
  bounded by the current dashboard payload; they MUST NOT add per-row network
  calls.
- **NFR-C1:** Mechanic-only presentation differences MUST be expressed through
  mechanic-owned components, view models, or explicit shared-component variants,
  not role-name CSS leakage into office or surveillance views.

## Acceptance Criteria

### AC-1: Natural kiosk identification (FR-1, NFR-A1)
Given Chino Mechanic 1 through Chino Mechanic 10 are active at a registered kiosk
When the kiosk roster renders
Then Mechanic 1 appears before Mechanic 2 and Mechanic 10
And every mechanic card is at least 44x44 pixels
And identity markers are not all the same `CM` text.

### AC-2: PIN and idle protection (FR-2, NFR-S2)
Given the browser is registered as a Chino kiosk
When Chino Mechanic 1 is selected and enters a valid PIN
Then the mechanic workspace opens
And two minutes without recorded activity returns the browser to the kiosk roster.

### AC-3: One next job (FR-3, FR-4)
Given Chino Mechanic 1 has assigned active jobs
When the desktop mechanic home loads
Then one deterministic assigned job is presented as Next job
And it contains exactly one primary Start job or Continue job action.

### AC-4: Queue separation (FR-5, FR-6)
Given assigned, available, waiting, and completed jobs exist
When My work is selected
Then Accept actions from Available jobs are not rendered in the assigned list
And Available, Waiting, History, search, filters, and Create workorder remain reachable.

### AC-5: Canonical start time (FR-7)
Given an accepted workorder already has a start time
When the mechanic opens or continues it
Then the displayed start time equals the existing canonical value
And no newer value replaces it.

### AC-6: Task-first detail (FR-8, FR-9)
Given an assigned mechanic opens a workorder
When the detail page renders
Then Work, Help, and Parts are primary navigation actions
And diagnosis and repair-completed fields appear before timing history
And Unit, Activity, and Preview remain reachable through More.

### AC-7: Authoritative autosave (FR-10, FR-11, NFR-R1, NFR-R2)
Given an assigned mechanic edits diagnosis and repair-completed text
When autosave confirms persistence and the page is fully reloaded
Then both values are restored from the server
And no manual Save progress button is present
And saving, saved, or error feedback is visible.

### AC-8: Direct part request (FR-13, FR-14, NFR-S1)
Given an assigned mechanic has `requestParts` permission
When they submit a valid description, quantity, and unit in Parts
Then POST `/api/mechanic/workorders/:id/parts` succeeds
And the request appears in the mechanic request list
And it appears in the office review workflow.

### AC-9: Help actions (FR-12)
Given the Help view is open
When it contains no messages
Then Take photo, Ask office, and Report another problem actions are visible
And free-text messaging remains available.

### AC-10: Completion without typed name (FR-15, FR-16, NFR-S1)
Given repair-completed text is non-empty and the authenticated mechanic may mark
the workorder done
When the mechanic confirms `Yes, work is done`
Then no typed-name field is required
And progress is flushed
And the authenticated mechanic is recorded as actor
And mechanic-done time is recorded
And the workorder enters office review.

### AC-11: Locale persistence and fallback (FR-17, FR-18, FR-19)
Given a mechanic selects Punjabi or Spanish
When they sign in again on the same or another authorized browser
Then kiosk/mechanic interface strings use the selected locale
And untranslated keys fall back to English
And original workorder content is unchanged.

### AC-12: Desktop containment (NFR-A3, NFR-L1, NFR-L2)
Given the kiosk, home, and detail pages are tested at all required desktop sizes
and at 200% zoom
When document and primary-component dimensions are measured
Then horizontal overflow is zero
And every primary action remains visible and keyboard reachable.

### AC-13: Shared-role regression safety (FR-20, NFR-C1)
Given office, surveillance, admin, print, and Preview tests pass before the change
When the mechanic simplification is integrated
Then those role routes and shared behaviors pass unchanged.

## Edge Cases and Error Scenarios

- EC-1: No assigned jobs -> show `No assigned jobs` and one Available jobs action;
  do not present an empty Next job card.
- EC-2: Assigned job becomes unavailable concurrently -> show the existing
  lifecycle conflict, reload dashboard truth, and do not keep a stale primary action.
- EC-3: Progress save fails -> keep the local recovery copy and show an error;
  Work done remains blocked until flush succeeds.
- EC-4: Realtime refresh arrives while progress is dirty -> preserve controlled
  field values and refresh after save or discard.
- EC-5: Part description is shorter than two characters or quantity/unit is
  invalid -> show field-level validation and create no request.
- EC-6: Part-request API fails -> retain the draft fields and show a local error.
- EC-7: Mechanic lacks `requestParts` permission -> show request history only and
  do not render a request submission form.
- EC-8: Message or photo upload fails -> retain composer input/attachment and
  show the existing chat error.
- EC-9: Work done is attempted with empty repair text -> keep the workorder active
  and focus the repair-completed field.
- EC-10: Work done conflicts with a concurrent lifecycle transition -> show the
  canonical conflict and reload server truth without duplicate completion.
- EC-11: Preferred locale is missing, invalid, or has a missing key -> use English.
- EC-12: Long mechanic name or translated string -> wrap within its owner; never
  hide content by relying on page-level `overflow-x: hidden`.
- EC-13: Database or preference update fails -> retain the current in-memory
  locale and show a non-blocking error; do not affect workorder operations.

## API Contracts

### Existing: Submit mechanic part request

`POST /api/mechanic/workorders/:workorderId/parts`

```ts
interface MechanicPartRequest {
  query: string;              // 2..500 characters
  partNumber?: string;
  manufacturer?: string;
  description?: string;
  category?: string;
  quantity: number;           // validated against uomCode
  uomCode: string;
  repairOrder?: string;
  fitmentStatus?: "confirmed" | "possible" | "unknown" | "conflict";
  fitmentNotes?: string;
}

interface MechanicPartRequestResponse {
  partRequest: WorkorderPartRequest;
}
```

The endpoint and response shape MUST remain unchanged.

### Backward-compatible: Mark mechanic work done

`POST /api/mechanic/workorders/:workorderId/mark-done`

```ts
interface MarkMechanicDoneRequest {
  diagnosis?: string;
  workPerformed: string;
  confirmationName?: string; // accepted for old clients; never authoritative
}
```

The server MUST derive identity from the authenticated mechanic. Existing clients
that still send `confirmationName` MUST continue to succeed when otherwise valid.

### Extended: Workorder preferences

`GET /api/workorder-preferences`

```ts
interface WorkorderPreferences {
  defaultLocationId?: string | null;
  defaultView?: string;
  pageSize?: number;
  savedFilters?: Record<string, unknown>;
  locale: "en" | "pa" | "es";
}
```

`PUT /api/workorder-preferences` retains the existing partial-update fields and MAY
include `locale`. Invalid locales return the existing validation error format.

## Data Models

### `user_workorder_preferences`

| Field | Type | Constraints |
|---|---|---|
| user_id | UUID | Existing PK/FK; authenticated preference owner |
| default_location_id | UUID nullable | Existing |
| default_view | text | Existing |
| page_size | integer | Existing |
| saved_filters | jsonb | Existing |
| locale | text | New; not null; default `en`; check in (`en`,`pa`,`es`) |
| updated_at | timestamptz | Existing; server managed |

No workorder, assignment, kiosk credential, part request, chat, or audit schema is
changed by this feature.

## Out of Scope

- OS-1: Native desktop application or App Store packaging.
- OS-2: Machine translation of user-authored workorder content.
- OS-3: Mechanic profile-photo upload and image storage.
- OS-4: Voice transcription or text-to-speech provider integration.
- OS-5: Changes to office, surveillance, admin, print, fullscreen Preview, Odoo,
  Samsara, or proofreading workflows beyond regression-safe shared primitives.
- OS-6: Mobile-first redesign. Existing mobile behavior must remain functional,
  but 1920x1080 is the primary product target.
- OS-7: New part catalog, pricing, fitment, approval, or inventory services.
