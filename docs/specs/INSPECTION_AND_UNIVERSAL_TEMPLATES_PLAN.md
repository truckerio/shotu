# Inspection Workflow and Universal Templates Platform Plan

## Metadata

- **Date:** 2026-09-01
- **Status:** Ready for weekly-first staged implementation; implementation is not authorized by this document
- **Initial delivery:** Minimal weekly truck and trailer inspections and their editable templates
- **Future delivery:** Annual/FMCSA Periodic inspections, company-defined workorder documents, and other typed operational templates
- **Architecture:** Modular monolith; application-owned records and immutable template snapshots

## 1. Outcome

Add Inspection beside Workorder as a first-class operational workflow. Office and Admin can request an inspection for a truck or trailer and assign mechanics. A mechanic can also start an inspection for themselves. Mechanics complete a structured checklist, record findings and notes, create or link a workorder from a defect, preview the inspection slip, and print it for a physical signature. Every completed inspection appears in the selected unit's service history.

The first release is weekly-only. Annual/FMCSA Periodic inspections remain documented for a later phase but are not visible, selectable, seeded, or required in V1.

Replace the proposed Admin-only Inspection Templates page with one company-wide **Templates** workspace. Inspection templates are its first template family. The same platform can later support a visual workorder-template builder and other company documents without allowing templates to inject code or bypass domain rules.

## 2. Scope boundaries

### In scope

- Create menu with Workorder and Inspection choices.
- Weekly truck and trailer inspection requests, assignments, execution, findings, completion, preview, print, and history.
- Versioned company templates with company defaults and optional location assignments.
- Admin template builder for truck and trailer inspections.
- Safe template catalog designed to add a workorder builder later.
- Workorder creation or explicit linking from one or more inspection findings.
- Immutable completed inspection and print evidence.
- A permission-controlled Inspection module with Off, Read only, and Full access modes.
- A minimal read-only inspection mode in the existing Office workspace for authorized dispatch and guard users.
- System presets for Weekly Truck and Weekly Trailer inspections.

### Not in the first inspection release

- Automated legal determination that a vehicle is safe to operate.
- Electronic signatures.
- Upload and recognition of a signed paper slip.
- Arbitrary HTML, CSS, JavaScript, SQL, or executable template extensions.
- A fully generic workorder builder.
- Fleet-management dashboards, maintenance forecasting, or customer portals.
- Gate approvals, load-release decisions, truck-trailer pairing, or new guard/dispatcher roles.
- Replacing the current workorder print renderer or location workorder templates before a separately verified migration.
- Annual/FMCSA Periodic inspection presets, qualification records, regulated certification, and periodic-inspection retention workflows.

## 3. Regulatory and checklist baseline

The default V1 workflow uses the product labels **Weekly Truck Inspection** and **Weekly Trailer Inspection**. These are routine company/shop inspections and must not be represented as DOT annual or FMCSA periodic certification.

Annual/FMCSA Periodic inspections are a future, separately authorized phase. They are retained in this plan so the weekly architecture does not block them, but V1 must not expose periodic presets, periodic create choices, compliance claims, qualification controls, or periodic completion paths. When that phase is implemented, applicable Appendix A minimum groups cannot be removed, only recorded qualified inspectors may complete those inspections, reports must contain the records required by 49 CFR 396.21, and completed reports must be retained for at least fourteen months. If a company removes or changes a protected minimum, the resulting template is labelled **Custom inspection**, not FMCSA Periodic.

The default routine templates should be reviewed with the operating company and applicable state requirements before release. U.S. source baseline:

- [49 CFR 396.13](https://www.ecfr.gov/current/title-49/subtitle-B/chapter-III/subchapter-B/part-396/section-396.13): driver must be satisfied the vehicle is in safe operating condition and review the prior report where required.
- [49 CFR 396.11](https://www.ecfr.gov/current/title-49/subtitle-B/chapter-III/subchapter-B/part-396/section-396.11): defect reporting, repair certification, electronic reports, and retention rules where applicable.
- [49 CFR 396.17](https://www.ecfr.gov/current/title-49/subtitle-B/chapter-III/subchapter-B/part-396/section-396.17): periodic inspection scope, applicable Appendix A minimums, twelve-month interval, and documentation on the vehicle.
- [49 CFR 396.19](https://www.ecfr.gov/current/title-49/subtitle-B/chapter-III/subchapter-B/part-396/section-396.19): periodic inspector qualifications and qualification-evidence retention.
- [49 CFR 396.21](https://www.ecfr.gov/current/title-49/subtitle-B/chapter-III/subchapter-B/part-396/section-396.21): periodic report contents, availability, and fourteen-month retention.
- [Appendix A to 49 CFR Part 396](https://www.ecfr.gov/current/title-49/subtitle-B/chapter-III/subchapter-B/part-396/appendix-Appendix%20A%20to%20Part%20396): brakes, coupling, exhaust, fuel, lighting, loading, steering, suspension, frame, tires, wheels, glazing, wipers, and trailer rear-impact guards.
- [FMCSA Model CDL Manual, Pre-trip Inspection](https://www.fmcsa.dot.gov/sites/fmcsa.dot.gov/files/docs/2005%20CDL%20DRIVER%20MANUAL%20FINAL%20July%202010.pdf): practical cab, engine, brake, wheel, lighting, trailer-connection, structure, and landing-gear checks.

## 4. Product flows

### 4.1 Create menu

Change the shared create action from one button to an accessible split button or anchored menu:

- Workorder
- Inspection

Canonical owners:

- `frontend/src/components/layout/WorkspaceCreateActions.jsx`
- `frontend/src/features/admin/workspace/OperationsPage.jsx`
- `frontend/src/app/routes/route-state.js`
- `frontend/src/app/routes/useRoleRouteNavigation.js`
- `frontend/src/app/routes/RoleWorkspaceOutlet.jsx`

Use the same permission-aware menu in Office, Mechanic, and Admin Operations. Hide unauthorized choices; if only one create action is authorized, open it directly. Preserve a minimum 44px target, keyboard operation, focus restoration, and phone-safe presentation.

The trigger label is **Create**. Menu items use exactly **Workorder** and **Inspection**, with no subtitles or explanatory copy inside the menu.

### 4.2 Create inspection

1. Enter the truck or trailer number and search authorized canonical assets.
2. Select the asset. Its `unit_type` resolves the Weekly Truck or Weekly Trailer preset by default.
3. If no exact asset exists, use **Create local unit** with an explicit unit type and stable asset identity.
4. Derive company and location when unambiguous; ask only when the actor has a real choice.
5. Office/Admin selects one or more mechanics. The first is primary.
6. Put optional due date and office instructions under **More details**.
7. Mechanic-created inspection assigns the current mechanic and starts immediately.
8. Save an immutable template-version snapshot on the inspection.

V1 has no inspection-type selector. Truck or trailer type resolves the corresponding active weekly template automatically; annual/periodic choices do not appear in the create flow.

The created record derives and stores inspection number, status, inspection kind, preset/template version, requester, assignees, company, location, unit identity, requested/due/started/completed timestamps, and audit/version metadata. Users enter only values that cannot safely be derived.

Inspection creation must require a real `asset_id`. A text-only unit cannot meet the requirement that every inspection appears in exact-unit service history. Manual creation must check normalized unit number, VIN, and plate for likely duplicates and require explicit confirmation instead of silently producing another asset.

Current workorder lookup prevents choosing an asset with an active workorder. Inspection lookup must reuse search and unit-summary components but use an inspection-specific availability policy: an active workorder does not prevent inspecting that unit.

### 4.3 Inspection queues and detail

Lifecycle:

```text
requested -> assigned -> in_progress -> completed
      |           |            |
      +-----------+------------+-> cancelled
```

Surfaces:

- **Inspections** is a product module, not a mandatory new page. When Office/Admin has both Workorders and Inspections, a compact product selector switches the existing operational workspace between those domains in place.
- Workorder mode preserves the current Office queue. Inspection mode reuses the same header, tabs, search, filter, list, pagination, and responsive space with inspection-specific data; the two record types are not mixed in one supervisory list.
- An inspection-only Office user lands directly in locked Inspection mode with no product selector.
- Mechanic keeps one **My Work** queue. It may contain clearly labelled workorders and inspections when both modules are enabled, or only inspections when Workorders is Off.
- Opening an inspection uses one focused detail route with compact identity, checklist, findings, notes, completion, and on-demand preview regions.
- Preserve the current queue/filter state when the user opens an inspection and returns.

Each checklist item uses an explicit tri-state response:

- Pass
- Issue
- N/A

The printed slip renders one physical box for each state. A single checkbox is prohibited because “checked” would not distinguish inspected from passed.

Rules:

- Required items need Pass, Issue, or N/A before completion.
- Template may disallow N/A on selected items.
- Issue requires notes and a severity: Attention, Repair required, or Out of service.
- Each issue needs a disposition before completion: new workorder, linked workorder, Office follow-up required when Workorders is unavailable, or documented no-workorder reason.
- Unit, location, and template snapshot become immutable after start.
- Response saves use `expectedVersion`; stale updates return `409` without overwriting newer work.
- Start, response, assignment, disposition, completion, cancellation, and revision events are append-only.
- Completed inspections cannot be reopened in place. Corrections create a revision with a reason and predecessor.

Overall result is derived and then confirmed by the mechanic:

- Passed
- Issues found
- Out of service

An Issue or Out-of-service item prevents a Passed result. Internally an Issue remains a typed defect/finding state. The application records the result; it does not make an automated legal determination that a vehicle is safe to operate.

### 4.4 Workorder from a finding

Each defect can be selected for workorder disposition. After the first defect, one findings-level **Create or link workorder** action lets the mechanic combine several findings into one workorder without repeating a large action on every checklist row.

If Workorders is Off for the mechanic, do not show workorder data or navigation. The available disposition is **Office follow-up required**. This satisfies the mechanic's disposition requirement and puts the completed inspection in the Full-access Office inspection queue for later workorder handling.

Prefill:

- Asset and unit snapshot.
- Company and location.
- Inspection number.
- Concern assembled from selected checklist labels and mechanic notes.
- Customer company snapshot where available.
- Optional mechanic assignment, subject to current workorder policy.

The create/link operation must be atomic and idempotent. The inspection receives reciprocal workorder links only after workorder creation commits.

Current database policy permits only one active workorder per asset. When one exists, present its number and require an explicit action:

- Link selected findings to existing workorder.
- Cancel and return.

Never create a second conflicting workorder, silently attach findings, or weaken `operational_workorders_one_active_per_asset`.

### 4.5 Inspection module access

Do not create Security Guard or Dispatcher authentication roles. Keep the existing role model and add an Inspection module setting resolved at company, location, and named-user scope:

| Mode | Visible behavior | Server capability |
| --- | --- | --- |
| Off | No Inspection navigation, dashboard, routes, counts, or create action | No inspection list, detail, preview, print, or mutation access |
| Read only | Locked Inspection mode in the existing workspace, search, filters, lifecycle status, and completed-slip preview/print | Authorized summary reads plus completed slip/archive reads only |
| Full | Role-appropriate request, assignment, execution, completion, preview, and print UI | Existing role rules plus inspection mutation authorization |

The module mode narrows the role; it never expands the actor beyond their base role. A location-scoped Office user with Read only access is the minimal guard/dispatch configuration. Workorders may be Off independently. Such a user sees inspection slips only and cannot create, edit, assign, complete, approve, link, or open workorders.

Inspection module state must be returned in the authenticated application bootstrap so routing and navigation render the authorized shell without briefly exposing forbidden destinations. Every inspection and workorder API repeats the server-side module decision; UI hiding is not authorization. Existing users retain their current Workorders access when this feature is introduced, while Inspection access starts Off until Admin enables it.

Canonical access owners:

- `shared/product-modules.js` — product-module catalog and Off/Read only/Full normalization.
- `src/server/db/repositories/product-module-access.repo.js` — sparse company/location/role/user rules with optimistic versioning.
- `src/server/modules/access/product-module-access.service.js` — one effective-access resolver used by bootstrap and every protected route.
- `frontend/src/app/routes/product-module-access.js` — navigation and landing projection from server decisions.
- Existing `frontend/src/features/admin/modules/ModulesPage.jsx` — Admin editor; product modules appear above the existing Workorder block catalog.

Use one additive `product_module_access_rules` store rather than pretending that all hidden Workorder form blocks disable the Workorders product. Do not add custom guard/dispatch capability checkboxes in V1; module mode, base role, and location membership are sufficient.

Match the current module resolver precedence: location named-user rule, company named-user rule, location role rule, company role rule, then compatibility default. Admin UI must show the winning source. After resolution, effective Off is a hard deny and Full remains capped by the actor's base-role actions.

## 5. Templates workspace

### 5.1 Admin information architecture

Add **Templates** as a top-level Admin destination beside Operations, Inventory, Locations, Modules, and System.

New owner:

```text
frontend/src/features/admin/templates/
  TemplatesWorkspace.jsx
  TemplateCatalog.jsx
  TemplateBuilder.jsx
  TemplateAssignments.jsx
  TemplatePreview.jsx
  template-builder-model.js
  *.test.js
  templates.css
```

The existing `frontend/src/features/admin/workspace/TemplatePage.jsx` and `location_workorder_templates` remain the current location-specific workorder-template owner during the first inspection release. The Templates workspace may link to that editor but must not duplicate or silently migrate its data.

Future workorder-builder delivery should migrate that legacy owner through an explicit compatibility adapter and rehearsed data migration. Until then, the V1 Templates catalog shows:

- Weekly Truck inspection — editable company template seeded from the system preset.
- Weekly Trailer inspection — editable company template seeded from the system preset.
- Workorder — current location templates available; visual builder planned.

Future catalog entries, not created or visible in V1:

- FMCSA Periodic Truck inspection — protected minimums with company additions allowed.
- FMCSA Periodic Trailer inspection — protected minimums with company additions allowed.

### 5.2 Typed template families

“Customizable templates for everything” must mean a safe declarative platform, not one untyped document blob.

Each template family registers a developer-owned manifest:

```ts
interface TemplateFamilyManifest {
  familyKey: "inspection" | "workorder" | string;
  schemaVersion: number;
  allowedBlockTypes: string[];
  allowedBindings: string[];
  validators: string[];
  rendererKey: string;
  supportedAssetTypes: string[];
}
```

Admin may compose only blocks declared by that family. Server schemas validate saved definitions and runtime snapshots. Templates never load code.

Initial inspection block types:

- Section heading.
- Instruction text.
- Pass/Issue/N/A checklist item (`Issue` maps to the typed internal defect state).
- Notes field.
- Unit-identity field group.
- Inspection metadata field group.
- Findings summary.
- Related-workorders list.
- Physical-signature line.
- Page break.

Future workorder block types can add typed labor, parts, authorization, customer, schedule, and totals blocks without forcing inspection records into the workorder schema.

### 5.3 Version and assignment model

Template hierarchy:

```text
system seed -> company template/version -> company default assignment
                                      -> optional location assignment
```

Admin workflow:

1. Create or duplicate template.
2. Edit a draft.
3. Preview at phone, desktop, and print width.
4. Validate required blocks and size limits.
5. Publish an immutable version.
6. Assign the published version as company default or selected-location override.
7. Archive obsolete templates without deleting historical versions.

Editing a published template creates a new draft version. Every block and checklist item has an immutable version-local key. In-progress and completed records keep those keys plus the template definition, template version, family schema version, renderer version, and display strings captured at creation. Responses reference snapshot item keys, never mutable template row positions.

Inspection creation resolves the assignment and published version inside the same transaction that stores the snapshot. A concurrent publish can affect the next inspection, but it cannot produce an inspection whose recorded version and checklist content disagree.

Suggested generic tables:

- `template_definitions`
- `template_versions`
- `template_assignments`
- `template_audit_events`

Suggested constraints:

- Company-scoped identity and composite foreign keys.
- One published company-default assignment per family and applicability key.
- One location override per family and applicability key.
- Draft/published/archived state checks.
- Optimistic version on drafts and assignments.
- Definition payload, item count, depth, and printable-size limits.
- No hard deletion when any operational record references a version.

Inspection domain tables stay typed rather than becoming generic template responses:

- `inspections`
- `inspection_responses`
- `inspection_assignments`
- `inspection_assignment_events`
- `inspection_events`
- `inspection_findings`
- `inspection_workorder_links`
- `inspection_print_archives`
- `inspection_serial_counters`

## 6. Default inspection content

The first-release defaults are deliberately broad weekly safety checks. They target approximately five minutes of mechanic time and twelve responses. Detailed fields appear only for an exception. Companies can add checks, but the shipped weekly defaults should remain short enough that routine use does not become box-ticking fatigue.

### 6.1 Weekly Truck preset

**Outside**

1. Lights and reflectors.
2. Tires and tire condition/pressure.
3. Wheels, rims, hubs, and lug nuts.
4. Mirrors, windshield, and wipers.

**Mechanical**

5. Brakes and visible air or hydraulic leaks.
6. Steering.
7. Suspension.
8. Engine fluids and visible leaks.
9. Belts and hoses.

**Safety**

10. Fifth wheel and coupling equipment.
11. Frame and body condition.
12. Horn and emergency equipment.

Truck start fields are odometer, optional engine hours, inspection location, and previous report reviewed when applicable. Known unit, VIN, plate, year/make/model, company, mechanic, and timestamps are derived rather than re-entered.

### 6.2 Weekly Trailer preset

**Outside**

1. Lights and reflectors.
2. Tires.
3. Wheels, rims, hubs, and lug nuts.
4. Body, doors, roof, and floor.

**Mechanical**

5. Brakes, air lines, and ABS indication.
6. Kingpin and coupling condition.
7. Electrical connection.
8. Suspension and axles.
9. Landing gear.

**Safety**

10. Frame and crossmembers.
11. Mudflaps and rear-impact guard.
12. Cargo securement equipment.

Trailer mileage is hidden unless the company explicitly tracks it. Known unit identity, company, location, mechanic, and timestamps are derived. Optional reefer, liftgate, hydraulic, or specialty-equipment checks are company additions rather than part of every weekly trailer inspection.

### 6.3 Checklist response and completion fields

Every weekly item has one single-choice **Pass / Issue / N/A** response. The data model may continue to store the issue state as `defect`; the user-facing weekly label is **Issue** because it is faster and clearer for routine use.

Selecting **Issue** reveals only:

- Severity: Attention, Repair required, or Out of service.
- What is wrong: required short note.
- Disposition: create workorder, link existing workorder, Office follow-up required, or no workorder required with reason.

Selecting **N/A** reveals a reason only when required by the published template. Completion shows unanswered items, issues, missing dispositions, final notes, and the server-derived result: Passed, Issues found, or Out of service. The mechanic cannot select Passed directly.

### 6.4 Future: FMCSA Periodic presets

This section is a future compatibility boundary, not V1 scope. The weekly release creates no periodic preset records, exposes no periodic template/create option, requires no inspector-qualification administration, and makes no annual/FMCSA certification claim.

When separately implemented, FMCSA Periodic is an optional protected preset, never the weekly default. It contains the applicable Appendix A minimum groups: brakes, coupling, exhaust, fuel, lighting, safe loading, steering, suspension, frame, tires, wheels/rims, windshield glazing, wipers, motorcoach seats where applicable, and rear-impact guard where applicable.

For these presets only:

- The system keeps applicable federal minimum groups locked and permits company additions.
- Removal or incompatible modification changes the label to **Custom inspection** before publish.
- Assignment and completion require recorded qualified-inspector status and qualification-evidence retention under 49 CFR 396.19.
- The completed record identifies the inspector, motor carrier, date, vehicle, components/results, and certification required by 49 CFR 396.21.
- The immutable completed report is retained for at least fourteen months where the vehicle is housed or maintained and remains retrievable by authorized users.
- Physical signature remains a print affordance; the application does not claim electronic-signature compliance.

## 7. API and authorization plan

Representative runtime routes:

```http
GET    /api/inspections/create-context
POST   /api/inspections
GET    /api/inspections?status=&unitType=&result=&locationId=&mechanicId=&from=&to=&search=&cursor=
GET    /api/inspections/:inspectionId
PATCH  /api/inspections/:inspectionId/responses
POST   /api/inspections/:inspectionId/actions/assign
POST   /api/inspections/:inspectionId/actions/start
POST   /api/inspections/:inspectionId/actions/complete
POST   /api/inspections/:inspectionId/actions/cancel
POST   /api/inspections/:inspectionId/actions/revise
POST   /api/inspections/:inspectionId/workorders
POST   /api/inspections/:inspectionId/workorder-links
GET    /api/inspections/:inspectionId/slip-preview
GET    /api/inspections/:inspectionId/print-archives/current
POST   /api/inspections/:inspectionId/print-archives
```

Representative Admin template routes:

```http
GET    /api/admin/template-families
GET    /api/admin/templates?companyId=&familyKey=
POST   /api/admin/templates
POST   /api/admin/templates/:templateId/versions
PATCH  /api/admin/template-versions/:versionId
POST   /api/admin/template-versions/:versionId/publish
POST   /api/admin/templates/:templateId/archive
GET    /api/admin/template-assignments?companyId=&familyKey=
PATCH  /api/admin/template-assignments/:assignmentId
```

Module access is evaluated before role/action access:

```text
authenticated membership
AND effective module mode
AND company/location/record scope
AND role/action permission
AND lifecycle/version rule
```

An explicit module Off decision is a hard deny. Read only permits summary lists plus completed-detail, read-only slip preview, and existing completed-archive download through GET routes; all POST/PATCH inspection operations fail. Archive creation remains a Full/Admin or completion-transaction operation. Workorders Off independently denies workorder queues, search, detail, creation, linkage, and related-workorder navigation, even for an Office role that historically had workorder permission.

Role baseline when the Inspection module is Full:

| Capability | Mechanic | Office | Admin | Surveillance |
| --- | --- | --- | --- | --- |
| Create self inspection | Yes | No | No | No |
| Create inspection request | No | Yes | Yes | No |
| Assign/reassign mechanics | No | Yes | Yes | No |
| Complete assigned inspection | Yes | No | Yes when explicitly acting as inspector | No |
| Read authorized inspection | Assigned/location scope | Company and location scope | Company scope | Read-only only if separately enabled |
| Create/link workorder from finding | Subject to workorder permissions | Yes | Yes | No |
| Manage templates and assignments | No | No | Yes | No |

Every server operation enforces company membership, location scope, assignment or administrative capability, lifecycle, and current expected version. UI visibility is not authorization. Cross-company, cross-location, and unauthorized record IDs return resource-not-found semantics and make no mutation.

Read-only projections must contain inspection data only. Unfinished inspections expose summary status in the list but not draft checklist responses or notes. Completed slips may expose unit identity, inspection number/status/result, completed date, mechanic display name, checklist answers, findings, notes intended for the slip, and the immutable print archive. They must not serialize workorder concern, parts, labor, pricing, customer-private notes, assignments, chat, or workorder URLs. A related workorder may be represented only as a neutral “Workorder linked” indicator unless the actor separately has Workorders access.

Permission changes take effect on the next authorized request and bootstrap refresh. Cached list/detail responses must be private and scoped by actor, company, location, and effective module mode. Search input is schema-validated and bounded. Rate-limit abusive search and document-download traffic. Audit module changes, denied access, archive creation, and print/download events; use ordinary redacted request telemetry for successful list/detail reads so audit storage does not grow with every keystroke.

### 7.1 Inspection-mode list and search performance

Inspection mode uses one server-owned summary query rather than loading full checklists or PDFs for every row:

- Cursor pagination with a bounded page size; reuse `ProgressiveQueue` only for client presentation, not as a substitute for server pagination.
- Select only row fields: inspection ID/serial, asset identity, unit type, location, status, result, mechanic summary, defect count, and relevant timestamps.
- Fetch checklist responses and print archives only after opening a record.
- Stream an existing completed PDF after authorization; do not regenerate it, buffer the full file in application memory, or embed it in list/detail JSON.
- Debounce search and cancel superseded requests. Search normalized unit number, VIN/serial, plate, and inspection number within the authorized tenant/location scope.
- Add or confirm composite indexes for scoped status/date pagination and asset inspection history. Use `EXPLAIN (ANALYZE, BUFFERS)` against representative data before choosing final indexes.
- Avoid per-row asset, mechanic, defect-count, or module-access queries; the list endpoint has a bounded query count independent of row count.
- Preserve previous rows during background filter refresh and show a local loading state instead of blanking the dashboard.

Provisional release budgets, measured in a production-like staging dataset:

- Inspection list and search API p95 at or below 300 ms for a bounded page.
- Inspection detail API p95 at or below 400 ms excluding PDF generation.
- No request count growth per additional list row.
- No unbounded result set or full-PDF generation from list/search endpoints.
- Client interaction remains responsive with the maximum supported page and long labels at phone and desktop widths.

## 8. Service history

Extend the existing combined unit timeline rather than adding inspection-only history UI.

On completed inspection:

- Materialize a `service_history_orders` record with `source_provider = 'local_inspection'`.
- Store ordered defects as service-history lines.
- Add `recordKind: workorder | inspection | odoo` to the read model.
- Display inspection number, result, defect count, notes, and related workorders only when the actor has the corresponding access.
- Link to inspection detail when the actor remains authorized.

Only completed inspections enter durable service history. Requested, cancelled, and abandoned drafts stay in operational/audit views. Add record-kind filters and compact inspection summaries so frequent checks do not bury repairs.

Primary owners:

- `src/server/db/repositories/service-history.repo.js`
- `src/server/modules/workorders/unit-service-history.service.js`
- `frontend/src/features/workorder-modules/unit/UnitServiceHistory.jsx`
- `frontend/src/features/workorder-modules/unit/service-history-model.js`

## 9. Print plan

Create `shared/inspection-template.js`. Reuse the safe HTML escaping, browser preview, Chromium PDF generation, hashing, immutable archive, idempotency, contained storage, and integrity-verification patterns from workorder printing. Do not force inspection data through `shared/workorder-template.js` or workorder archive tables.

Printed inspection slip:

- Company/shop heading.
- Inspection number and template-version label.
- Unit, VIN/serial, plate, mileage, location, date/time, and mechanic.
- Sectioned checklist with Pass/Issue/N/A boxes for weekly forms.
- Finding notes and related workorder numbers only when the print actor has Workorders access; otherwise omit workorder identity.
- Overall result.
- Blank mechanic physical-signature and date lines.
- Optional office acknowledgment line.
- Page number and revision label.

An in-progress print carries an **IN PROGRESS** watermark. Completed original archives are immutable. Later changes generate a revised archive with reason and predecessor. The system records who printed and when, but a blank or printed signature line is not represented as an electronic signature.

## 10. Minimal UI/UX interaction contract

### 10.1 Product-level subtraction rules

- One create entry point, one existing role workspace, one in-place product mode at a time, and one Templates destination.
- Do not add dashboard cards, duplicate inspection dashboards, a wizard for a short create flow, or a second service-history owner.
- Show the object identity, current state, progress, save state, and next action before supporting metadata.
- Use one primary action per region. Put infrequent actions such as Duplicate, Archive, Cancel, and Print draft in **More**.
- Prefer existing typography, spacing, buttons, dialogs, search, assignment, preview, and responsive dock primitives. New visual language is out of scope.
- Remove repeated instructions after the first successful use. Keep contextual help beside the exceptional decision that needs it.

### 10.2 Create menu and inspection request

Reuse `WorkspaceCreateActions` for a single **Create** button with two options:

- Workorder
- Inspection

Only show authorized options. With one authorized create capability, the button opens that flow directly instead of showing a one-item menu. Read-only Inspection users have no create action.

The normal inspection request is one compact surface, not a multi-step wizard:

1. **Unit** — searchable truck/trailer selector with unit summary; manual local-unit creation remains the explicit fallback.
2. **Location** — prefilled from the current workspace or unit context when unambiguous; show a selector only when the actor must choose.
3. **Assign to** — Office/Admin can assign mechanics; mechanic-created inspections assign the current mechanic automatically.

Template family and version are resolved from unit type, company, and location. Display the resolved template as read-only context. Show a template selector only when several equally valid published templates require a real user choice. Put optional due date and office instructions under **More details**.

Primary action labels reflect intent: **Request inspection** for Office/Admin and **Start inspection** for a mechanic. Validation stays beside the affected field. Successful creation opens the inspection; it does not add a confirmation page.

### 10.3 Role workspaces and in-place Inspection mode

Reuse the current operational collection, task-row, search, filter, pagination, and responsive queue primitives. Keep one `InspectionQueue` presentation model with role-appropriate actions; do not build separate guard, dispatch, Office, and Admin queue components.

Every inspection row uses unit number as the title and shows truck/trailer, inspection number, status, result, location, mechanic, and the most relevant date. Status and result always include text. The complete row is openable; the only separate row action is the actor's real next step.

**Mechanic page**

- Keep the existing decision-oriented **My work**, **Available**, and **Done** structure.
- When both product modules are enabled, show clearly labelled Workorder and Inspection rows in the same personal task queue because the mechanic acts on assignments rather than supervising domain-wide dashboards.
- Do not add a visible Workorder/Inspection type filter in V1. Text badges and search are sufficient for the initial queue; add a Type filter later only when measured realistic volume shows that mechanics cannot find assigned work quickly.
- When Workorders is Off, remove workorder rows, create actions, counts, filters, routes, and detail links. The page becomes inspection-only without changing its visual system.
- An assigned inspection row shows unit, truck/trailer, progress, issue count, save/error state when resumed, and **Start** or **Continue**.
- Opening the row enters the linear checklist. Back returns to the same tab, search/filter state, and scroll position.

**Office page with Workorders and Inspections enabled**

- Keep the existing Office workspace and its usable queue area. A compact **Workorders / Inspections** selector in the workspace header changes the domain in place; it does not add a destination, sidebar page, dashboard, or mixed record list.
- Workorder mode stays unchanged with its current **Needs action**, **In progress**, and **Done / Odoo** behavior.
- Inspection mode maps the same status-tab area to **Needs action**, **In progress**, and **Completed**. Requested and assigned records are decision states within Needs action rather than extra top-level tabs.
- Reuse the existing search, filter row/sheet, list, pagination, empty/error states, and route-state owners with a domain-specific presentation model.
- The shared Create button offers Workorder and Inspection. Each mode's filters, scroll, and selected record survive switching, navigation, and refresh.
- Inspection rows expose **Assign**, **Review**, or **View slip** only when the actor has the corresponding Full capability.

**Read-only Office page for guard or dispatch users**

- If Workorders is Off, the existing Office workspace is locked to Inspection mode and is the default landing surface; no product selector is shown.
- Put unit search first and use one **Status** dropdown with **All**, **Completed**, and **Not completed**. Do not add another tab row for read-only users.
- Search unit number, VIN/serial, plate, or inspection number. Keep Truck/Trailer, location, date, and result in the existing filter sheet; show only filters relevant to the user's authorized scope.
- Rows show unit, truck/trailer, status, completed date, mechanic, and Passed / Issues found / Out of service. A completed row opens the read-only slip and Print/Download. An unfinished row shows status only and does not expose draft checklist answers or notes.
- No Create, Assign, Edit, Complete, Approve, Workorder, or template actions appear. Dispatch users search truck and trailer independently; the application does not add a pairing or load-release workflow.

**Admin page**

- Admin retains Operations, Inventory, Locations, Modules, Templates, and System. Operations gets the same in-place Workorders/Inspections selector when both modules are enabled.
- Inspection-mode behavior matches Full Office access; Admin additionally manages module access in Modules and inspection definitions in Templates.
- Admin does not receive a different checklist or queue component.

**Surveillance page**

- Default remains unchanged with Inspection Off.
- If Inspection Read only is explicitly enabled, reuse the same read-only Inspection mode and slip projection; do not create a surveillance-specific inspection UI.

Empty states contain one sentence and at most one relevant action. Loading uses stable row skeletons. Permission and server errors replace the affected region without erasing filters. Search and filters persist in the URL; back/forward and refresh reproduce the same safe list state.

### 10.4 Inspection detail and checklist

The detail page is one compact checklist, not a spreadsheet or traditional data table. It stays a single-column completion path on every breakpoint; desktop may align the item label left and response control right within a row, while phone places the response control below the label.

The page order is:

1. Compact header: Weekly Truck/Trailer badge, unit number, inspection number, status, location, due date, and mechanic.
2. Sticky progress summary: answered count, issue count, and `Saving | Saved | Save failed` state.
3. Start fields: truck odometer, optional engine hours, location, and previous-report review only when applicable; trailer mileage remains hidden unless configured.
4. Twelve checklist rows grouped under **Outside**, **Mechanical**, and **Safety**.
5. Final notes, issue review, and completion region.

Do not hide required work inside closed accordions. Keep the current and incomplete sections expanded. Completed sections may collapse to a summary, but must remain one action away from editing. Provide a section-jump menu and **Next unchecked** for long templates.

Each weekly checklist row contains:

- The checklist label and optional short guidance.
- A single-choice Pass / Issue / N/A control implemented as a labelled radio group or equivalent accessible segmented control—not three independent checkboxes.
- Issue severity, note, and disposition fields only after Issue is selected.
- An N/A reason only when the published template requires it.

Use at least 44px touch targets on phone. Selection cannot depend on color alone. Exception fields expand in place without moving the operator to another page. Autosave is the normal behavior; the save indicator remains visible and completion is blocked while required changes are unanswered or unsynced. A sticky **Next unchecked** action moves directly to the next missing response.

### 10.5 Finding-to-workorder flow

After the first issue, show one compact findings summary with issue count and **Create or link workorder**. Do not repeat a large button on every row. The action opens a dialog or sheet that:

- Lets the mechanic select one or more findings.
- Shows an existing active workorder first and offers **Link findings** when applicable.
- Otherwise reuses the canonical workorder create surface with unit and concern prefilled.
- Preserves the inspection draft, scroll position, active section, and focused finding when closed.
- Returns to the same inspection row after success and shows the linked workorder number in context.

When Workorders is Off, replace the action with the single **Office follow-up required** disposition; do not open or imitate the workorder surface.

The final completion region lists unanswered required items, issues, and missing dispositions. It exposes one primary **Complete inspection** action. Print remains secondary and is available from preview or the completed state.

### 10.6 Templates catalog and builder

The Admin **Templates** workspace has two peer views: **Templates** and **Assignments**. Do not mix assignment rules into the content editor.

Catalog rows show only family, name, status, assigned scope summary, and last updated time. One **Create template** action first offers **Use preset** rather than a blank builder: Weekly Truck or Weekly Trailer. **Start blank custom inspection** remains a secondary option. Future workorder templates enter through the same family choice.

Weekly presets can be edited normally. The annual/FMCSA Periodic phase will later add protected presets, qualification rules, and compliance-specific publishing behavior without changing the weekly builder's basic interaction model.

Editor behavior:

- Draft content autosaves. **Publish** is the single primary action; Duplicate and Archive live in **More**.
- Use multi-open section panels because an Admin edits subsets, but do not nest accordions.
- Section summaries show title, item count, and validation issues.
- Add checklist items inline. Reordering supports drag-and-drop plus visible **Move up** and **Move down** controls for keyboard and touch parity.
- Publish opens a concise review of changed sections, validation issues, assignment impact, and the new immutable version.
- Company context appears only when an Admin can act across multiple companies.

At wide desktop widths where both panes remain useful, use a bounded edit/preview split with the editor slightly wider than the preview. At narrower desktop, tablet, phone, or 200% zoom, switch to explicit **Edit** and **Preview** modes. Never force a squeezed split view or nested page scrolling.

### 10.7 Responsive, accessibility, and state rules

- Inspection mode on phone: search first, one compact status row, secondary filters in the shared filter sheet, one-column rows, and progressive rendering without horizontal page movement.
- Office phone with both modules: one Workorders/Inspections product switch followed by that product's status views; do not stack duplicate global and local tab bars.
- Inspection mode on desktop/tablet: keep search, status views, result/type/location/date filters, and row geometry consistent with existing operational queues. Collapse filters before compressing row meaning.
- Read-only slip on phone: one full-width document view with a clear Back action and Download/Print; no squeezed split pane or editable-looking controls.
- Phone: one column, compact sticky progress, and a bottom dock for **Next unchecked** or **Complete inspection**. Add scroll padding so the dock never covers the focused control.
- Tablet: one column with optional section navigation; no side-by-side preview.
- Desktop: centered readable checklist width. Preview is supporting and opens on demand; it is not permanently visible during mechanic entry.
- Keyboard order follows the visible task. Opening and closing menus/dialogs restores focus to the trigger or affected finding.
- Every field has a persistent label; every grouped response has a legend; status and error text is announced to assistive technology without stealing focus on each autosave.
- Support loading, empty, permission denied, offline/retrying, stale-version conflict, saved, save-failed, cancelled, and completed states without blank screens or destructive resets.
- Use the existing spacing rhythm and restrained borders. Avoid stacked cards, decorative gradients, icon-only mystery actions, and repeated summaries.

### 10.8 Explicitly rejected UI alternatives

- A new Inspection Dashboard page or separate guard, dispatcher, Office, Admin, or Surveillance implementations of the inspection list.
- Mixing Office workorder and inspection records into one overloaded supervisory list; switching the existing workspace in place is the accepted model.
- Clearance receipts, gate approvals, truck-trailer pairing, or load-release controls in the Inspection module.
- A create-inspection wizard when the normal path has three or fewer decisions.
- A grid/table checklist on phone.
- One checkbox per item or independent Pass/Issue/N/A checkboxes.
- All checklist sections collapsed by default.
- Permanent live preview beside the checklist on tablet or phone.
- Raw JSON, arbitrary HTML, or free-position canvas editing in the template builder.
- Drag-only ordering, color-only statuses, or icon-only critical actions.

## 11. Implementation slices

1. **Template foundation** — family manifest registry, generic version/assignment tables, company and location resolution, Admin APIs, tenant tests.
2. **Admin Templates workspace** — top-level destination, catalog, inspection builder, assignments, preview, publish/archive flow.
3. **Inspection module access** — Off/Read only/Full catalog, bootstrap projection, company/location/user resolution, route/API hard denies, compatibility defaults, and negative authorization tests.
4. **Inspection domain** — typed tables, serials, repository, schemas, lifecycle, assignments, events, conflicts, idempotency.
5. **In-place role workspace modes** — bounded summary query, indexes, cursor pagination, shared search/filters/list owners, permission-locked product selector, read-only projection, and preserved per-mode route state.
6. **Create and execution** — permission-aware create menu, exact asset selection/manual local asset path, mechanic queue rows, role actions, and route hydration.
7. **Inspection detail** — responsive checklist, findings, autosave, version conflicts, completion, activity, and read-only slip mode.
8. **Workorder linkage** — new/link decision, multi-finding concern projection, reciprocal links, active-workorder conflict path, and Workorders-Off denial.
9. **Print/archive** — inspection renderer, live preview, completed archive, PDF download, revision path, integrity and authorization tests.
10. **Service history** — completed inspection projection, timeline record-kind support, filters, linked navigation, and restricted read-only projection.
11. **Hardening and release evidence** — permissions, concurrency, query plans/load test, migration rehearsal, accessibility, phone/tablet/desktop, browser workflows, and full repository verification.
12. **Future annual/FMCSA Periodic phase** — protected presets, applicability rules, inspector qualifications, regulated report fields, retention, certification-safe labels, and separate release evidence.
13. **Future workorder builder** — typed workorder manifest, compatibility adapter, legacy location-template migration rehearsal, dual-read cutover, rollback, and removal only after parity evidence.

## 12. Verification matrix

- Template family registry rejects unknown families, blocks, bindings, renderer keys, and schema versions.
- Admin template CRUD is tenant-scoped; Office and Mechanic direct calls fail.
- Stale draft or assignment writes return `409` and preserve the winner.
- Published versions are immutable; archive never breaks referenced inspections.
- Concurrent publish and inspection creation always capture one internally consistent version and snapshot.
- Reordered or removed template items cannot remap historical responses because responses use immutable snapshot item keys.
- Location assignment overrides company default; missing override falls back deterministically.
- Asset search permits inspection when active workorder exists but prevents cross-company selection.
- Manual local-asset creation detects likely identity conflicts.
- Inspection lifecycle rejects invalid transitions and unauthorized assignment/completion.
- Off module mode removes Inspection navigation and denies list, detail, preview, print, and mutation APIs.
- Read only permits authorized list/detail/GET preview/existing-archive download and rejects every create, archive-generation, assign, response, completion, cancellation, revision, template, and workorder-link mutation.
- Workorders Off denies workorder queues, search, detail, creation, and linkage even for an Office actor with Inspection Read only or Full.
- Company, location, named-user, cross-tenant, guessed-ID, stale-session, and permission-revocation cases fail without record-existence leakage.
- Read-only JSON and print responses contain no workorder concern, notes, chat, parts, labor, pricing, customer-private fields, or unauthorized URLs.
- Read-only unfinished rows expose summary status only; draft checklist responses, findings, and notes remain unavailable until completion.
- Existing users retain their current Workorders access after module-access migration; Inspection defaults Off until enabled.
- Required responses, N/A rules, defect notes, severity, and disposition are enforced server-side.
- Concurrent response saves do not lose newer changes.
- Workorder creation/link replay is idempotent; active-workorder conflict offers explicit link path.
- Completion and service-history materialization commit consistently or fail together.
- Print archive snapshot is immutable, hash-verified, tenant/location scoped, and traversal-safe.
- Print handles maximum allowed sections/items/notes without clipping or unreadable boxes.
- Inspection list endpoints are cursor-paginated, have bounded query counts, omit checklist/PDF bodies, and use verified scoped query plans.
- Production-like performance tests meet provisional p95 budgets for dashboard/search and detail, including high inspection volume and concurrent filter traffic.
- Ordinary inspection creation requires no more than three decisions after choosing **Inspection**; derived template data is not presented as a fake choice.
- The Create menu contains exactly **Workorder** and **Inspection**, with no subtitles, and hides unauthorized items.
- V1 creation accepts no annual/periodic profile choice; selecting an asset resolves the active Weekly Truck or Weekly Trailer template from canonical unit type.
- V1 template catalog, runtime APIs, seeded data, and role workflows expose no annual/FMCSA Periodic option or compliance claim.
- A mechanic can identify unit, inspection state, progress, save state, and next action within five seconds in moderated checks.
- The default Weekly Truck and Weekly Trailer checklists each render exactly three sections and twelve broad checks before company customization.
- A default weekly inspection can be completed without issues in approximately five minutes during pilot testing, while issue entry remains explicit and cannot be skipped.
- A separately tested maximum custom checklist remains operable with 12 sections, 100 items, long labels/notes, 10 issues, and intermittent save failures.
- Route round trips and workorder creation preserve queue filters, inspection answers, active section, scroll position, and focus target.
- At 320px, 390px, 430px, 768px, 1440px, 1920px, and 200% zoom there is no page-level horizontal scrolling or obscured focused control.
- Phone response controls and dock actions meet the 44px target; Pass/Issue/N/A, save state, and status remain understandable without color.
- Keyboard and screen-reader checks cover response groups, section navigation, dialog focus restore, autosave announcements, reorder controls, errors, and completion blockers.
- Template editor switches between split and Edit/Preview modes before either pane becomes unusable; long preview content has one intentional scroll owner.
- Mechanic with both modules sees labelled personal tasks; inspection-only Mechanic sees no workorder residue and returns to the same queue state after checklist work.
- Office with both modules can switch the existing workspace in place between Workorders and Inspections without mixing records or losing either mode's filters and scroll state.
- Guard/dispatch configuration lands directly in locked read-only Inspection mode and can find and open a slip without encountering a product selector, creation, or mutation controls.
- Read-only dashboard normal, empty, loading, error, no-results, long-label, expired-session, and permission-revoked states render without blank screens or data flashes.
- Templates workspace and inspection pages work at 390px, 430px, tablet, desktop, 200% zoom, keyboard-only, and screen-reader landmarks.
- Fresh browser flows cover Admin publish/assign/module access, Office request/assign, Mechanic complete/create workorder, Office-with-both navigation, read-only guard/dispatch search and slip viewing, Office history review, and completed print.
- Run focused tests, PostgreSQL integration tests, `npm run test:role-workflow`, `npm run verify`, and fresh rendered browser checks.

## 13. Stress test

### Assumption A: one generic builder can safely support every document

- **Counter-evidence:** Inspection checklists and workorders have different data, lifecycle, tables, validation, permissions, and print requirements. One arbitrary JSON/HTML builder would hide domain rules and create unsafe bindings.
- **Downside:** Template data becomes an untyped second application platform; runtime failures or authorization leaks surface after customers publish templates.
- **Sensitivity:** Critical.
- **Hedge:** Developer-owned typed family manifests, strict block/binding allowlists, server validation, renderer versions, and separate operational tables.
- **Early warning:** A new template family requires raw HTML, custom SQL, role checks in template JSON, or family-specific exceptions in the generic renderer.

### Assumption B: company defaults alone cover every shop

- **Counter-evidence:** Locations may use different equipment, customer requirements, branding, and operating procedures. The current app already has location workorder templates.
- **Downside:** Admin duplicates companies or mechanics ignore irrelevant checklists.
- **Sensitivity:** High.
- **Hedge:** Company default plus explicit location override; no hidden per-user template fork.
- **Early warning:** Users copy templates only to change one location-specific section.

### Assumption C: Admin can freely remove every safety item

- **Counter-evidence:** Federal periodic standards and state/customer rules may require minimum checks. Admin may not know whether a template is being treated as a regulated form.
- **Downside:** A customized form is mistaken for compliant annual certification.
- **Sensitivity:** Critical where customers use regulated inspections.
- **Hedge:** Weekly presets remain plainly non-periodic. V1 exposes no annual/FMCSA Periodic option. The future periodic phase uses separate protected profiles with locked applicable minimum groups, qualification enforcement, required report fields, fourteen-month retention, and automatic demotion to Custom inspection when protections no longer hold.
- **Early warning:** Customer renames a template “DOT Annual,” removes brake/coupling items, or requests a compliance certificate.

### Assumption D: immutable template version alone preserves historical evidence

- **Counter-evidence:** Rendering code, field bindings, translations, and CSS can change after the inspection.
- **Downside:** Reprinting an old inspection produces a materially different document.
- **Sensitivity:** High.
- **Hedge:** Snapshot definition, display strings, family schema version, renderer version, resolved unit/company data, PDF hash, and immutable completed archive.
- **Early warning:** A historical snapshot needs current template lookup to render.

### Assumption E: every inspection in service history improves fleet visibility

- **Counter-evidence:** Daily or frequent passed inspections can overwhelm repairs and external service orders.
- **Downside:** Service history becomes noisy and operators stop using it.
- **Sensitivity:** High at fleet scale.
- **Hedge:** Materialize completed records only, label record kind, compact passed inspections, add filters, and emphasize defects/linked workorders.
- **Early warning:** More than 80% of first history page is routine passed inspections or users repeatedly filter them out.

### Assumption F: physical signatures provide enough durable proof

- **Counter-evidence:** Paper can be lost, signed after the recorded completion time, or differ from the archived unsigned snapshot.
- **Downside:** The application proves checklist completion and printing, not who physically signed the retained paper.
- **Sensitivity:** Medium for routine operations; critical if sold as legal signature evidence.
- **Hedge:** State this boundary, archive the exact pre-signature PDF, include inspection ID/revision, and design a future signed-scan attachment with hash and retention policy.
- **Early warning:** Customers ask the app to prove signature identity or retrieve the signed paper.

### Assumption G: manual unit creation is a harmless fallback

- **Counter-evidence:** Unit number, VIN, and plate can be mistyped or reused across companies. Duplicate assets split service history permanently.
- **Downside:** Inspections and workorders appear on different timelines for the same physical unit.
- **Sensitivity:** Critical for future fleet management.
- **Hedge:** Exact company scope, normalized duplicate checks, VIN preference, explicit ambiguity resolution, merge tooling planned before fleet rollout, and no text-only inspection.
- **Early warning:** Same normalized VIN/plate or company/unit number appears on multiple active assets.

### Assumption H: create-workorder-from-defect is a simple shortcut

- **Counter-evidence:** Current one-active-workorder-per-asset policy, assignment rules, serialized-parts invariants, and location permissions still apply.
- **Downside:** Duplicate active work, silent finding loss, or bypassed workorder authorization.
- **Sensitivity:** Critical.
- **Hedge:** Use canonical workorder service transaction, explicit existing-workorder link choice, idempotency key/request hash, reciprocal link constraints, and no policy bypass.
- **Early warning:** Inspection code writes directly to `operational_workorders` or treats a `409` as success.

### Assumption I: online autosave is sufficient in a shop

- **Counter-evidence:** Mechanics may inspect outside, inside metal buildings, or near trailers with unstable connectivity.
- **Downside:** Completed rows disappear or stale tabs overwrite newer data.
- **Sensitivity:** High for adoption.
- **Hedge:** Visible save state, retry queue, draft persistence, expected-version conflict UI, explicit unsynced warning, and completion blocked until server confirms all responses. True offline completion remains a later capability.
- **Early warning:** Repeated retry rate, abandoned in-progress inspections, or support reports of lost checklist work.

### Assumption J: a template can be arbitrarily large and still print well

- **Counter-evidence:** User-defined labels and notes can overflow pages; huge templates slow rendering and become unusable on phones.
- **Downside:** Clipped safety items, blank pages, browser hangs, or unusable printed signatures.
- **Sensitivity:** High.
- **Hedge:** Server limits for blocks/depth/text, pagination-aware renderer, page-break controls, print preview warnings, maximum-payload tests, and publish blocking on invalid layout.
- **Early warning:** Preview page count or render time crosses defined thresholds, or content clips in supported viewport/print tests.

### Assumption K: the same queue structure fits every role

- **Counter-evidence:** Mechanics need one personal task queue, while Office users supervise domain-wide work and read-only users only search slips.
- **Downside:** A universal mixed queue hides Office status, burdens read-only users, and makes mechanics switch destinations unnecessarily.
- **Sensitivity:** High.
- **Hedge:** One shared row/list implementation with three projections: mechanic personal tasks, Full Office/Admin Inspection mode, and read-only Inspection mode. Office changes the existing workspace in place rather than adding a destination or mixing domains in one list.
- **Early warning:** Mechanics repeatedly filter by type, Office cannot isolate requested inspections, or guards encounter assignment/create controls.

### Assumption L: one linear checklist remains usable at maximum size

- **Counter-evidence:** A 100-item form can create excessive scrolling and weak location awareness even without accordion complexity.
- **Downside:** Mechanics skip rows, lose their place, or mark the wrong component.
- **Sensitivity:** Critical for completion accuracy.
- **Hedge:** Sticky progress, section jump, Next unchecked, ordinary headings, optional collapse only for completed sections, restored scroll/section state, and maximum-content usability tests.
- **Early warning:** Backtracking is common, completion blockers contain many scattered unanswered items, or users rely on browser find.

### Assumption M: tri-state controls are fast enough on a phone in shop conditions

- **Counter-evidence:** Gloves, glare, one-handed use, and similar adjacent options increase mistaps. N/A may be chosen as a shortcut.
- **Downside:** Incorrect inspection evidence or slower entry than paper.
- **Sensitivity:** Critical.
- **Hedge:** 44px targets, persistent row label/legend, high-contrast selected state with text, immediate reversible feedback, template-level N/A restrictions, and field testing on supported phones.
- **Early warning:** Rapid corrections between Pass and Issue, unexplained N/A concentration, or missed taps in moderated tests.

### Assumption N: autosave without a Save button feels trustworthy

- **Counter-evidence:** Intermittent connectivity and invisible background failures make users doubt whether answers persisted.
- **Downside:** Repeated taps, abandoned work, duplicate updates, or premature completion attempts.
- **Sensitivity:** High.
- **Hedge:** Persistent Saving/Saved/Save failed state, local retry queue, explicit unsynced count, non-destructive conflict resolution, and server-confirmed completion gate.
- **Early warning:** Users pause after every answer to look for confirmation, refresh to verify data, or ask for a manual Save button.

### Assumption O: workorder creation mid-inspection will not derail the inspection

- **Counter-evidence:** Switching domains can lose draft state, scroll position, or task context, especially on phone.
- **Downside:** Findings are duplicated, omitted, or left without disposition.
- **Sensitivity:** Critical.
- **Hedge:** Contextual sheet/dialog, canonical workorder service, preserved inspection state and focus, explicit return path, and linked-number confirmation beside the originating finding.
- **Early warning:** Users open a second tab, take paper notes before creating workorders, or abandon inspections after linkage.

### Assumption P: live preview improves template editing

- **Counter-evidence:** A permanent split consumes space and competes with the editor on ordinary laptops and at zoom.
- **Downside:** Both panes become cramped, scroll ownership is unclear, and Admins stop using preview.
- **Sensitivity:** Medium.
- **Hedge:** Split view only when both panes meet minimum useful widths; otherwise explicit Edit/Preview modes with one scroll owner and preserved editor position.
- **Early warning:** Horizontal scrolling, frequent browser zoom changes, or users close/hide preview immediately.

### Assumption Q: a minimalist template builder still communicates publishing risk

- **Counter-evidence:** Hiding details can obscure removed checks, changed assignments, validation problems, and immutable-version consequences.
- **Downside:** Admin publishes an incomplete checklist or unintentionally changes a location's default.
- **Sensitivity:** Critical.
- **Hedge:** Quiet editor during drafting, then a mandatory concise publish review showing changed sections, blockers, assignment impact, and version outcome.
- **Early warning:** Immediate archive/re-publish corrections, support requests to identify who changed a checklist, or location surprises after publish.

### Assumption R: drag-and-drop is enough for template ordering

- **Counter-evidence:** Dragging is unreliable for keyboard users, touch precision, long lists, and assistive technology.
- **Downside:** Some Admins cannot perform a core builder task.
- **Sensitivity:** High.
- **Hedge:** Keep drag as an enhancement; expose labelled Move up/Move down actions, announce the new position, and preserve focus after reorder.
- **Early warning:** Keyboard testing cannot reorder, touch users repeatedly drop in the wrong section, or focus resets to the page top.

### Assumption S: minimal headers still communicate enough operational context

- **Counter-evidence:** Removing metadata can hide the wrong unit, company, location, assignee, or inspection state.
- **Downside:** Work is recorded against the wrong asset or performed at the wrong shop.
- **Sensitivity:** Critical.
- **Hedge:** Always keep unit number, object type/number, status, location, assignee, progress, save state, and next action visible or one compact disclosure away; remove decorative and duplicate metadata first.
- **Early warning:** Users reopen unit details to confirm identity or cannot state the inspection status and next action within five seconds.

### Assumption T: hiding a module in the UI prevents unauthorized access

- **Counter-evidence:** An Office actor can retain bookmarked workorder routes, call APIs directly, or reuse cached responses after Workorders is turned Off.
- **Downside:** High-impact cross-module information disclosure or unauthorized mutation.
- **Sensitivity:** Critical.
- **Hedge:** Server-side module checks on every list/detail/preview/print/mutation request, actor-scoped private caching, immediate request-time revocation, non-leaking not-found responses, and negative route/API tests.
- **Early warning:** A hidden navigation destination still returns `200`, cached rows remain after revocation, or authorization exists only in React conditions.

### Assumption U: the full inspection detail response is safe for read-only users

- **Counter-evidence:** Inspection detail can reference workorders, internal notes, customer data, parts, pricing, or links that the actor cannot otherwise open.
- **Downside:** Workorders Off becomes cosmetic and confidential operational data leaks through Inspection.
- **Sensitivity:** Critical.
- **Hedge:** Dedicated read-only projection allowlist, neutral linked-workorder indicator, serialized-response contract tests, print authorization, and no reuse of a privileged full-detail payload.
- **Early warning:** Read-only JSON contains workorder IDs/URLs, labor, parts, pricing, chat, customer-private notes, or Admin-only fields.

### Assumption V: Inspection mode will remain fast as history grows

- **Counter-evidence:** Joining assets, mechanics, findings, templates, responses, and archives per row can create N+1 queries and large payloads.
- **Downside:** Search and queue navigation become slow at the yard exactly when operators need quick confirmation.
- **Sensitivity:** High.
- **Hedge:** Summary-only cursor query, bounded query count, scoped composite indexes chosen from measured plans, lazy detail/PDF loading, and production-like p95 load tests.
- **Early warning:** Query count grows with page size, list payload includes checklists/PDFs, p95 exceeds budget, or database scans grow with total tenant history.

### Assumption W: unrestricted unit search is harmless

- **Counter-evidence:** Each keystroke can trigger broad scans; adversarial searches can enumerate assets or exhaust database capacity.
- **Downside:** Slow dashboard, denial of service, or cross-location identity leakage.
- **Sensitivity:** High.
- **Hedge:** Debounce and cancel stale requests, bounded normalized input, tenant/location predicate before search matching, cursor limits, rate limits, and indexed exact/prefix paths measured with representative data.
- **Early warning:** Superseded requests continue running, `%`-style searches cause sequential scans, or unauthorized unit numbers change result counts.

### Assumption X: an in-place Workorders/Inspections switch will remain clear

- **Counter-evidence:** Reusing one page can still confuse users if the product mode, status-tab meaning, or restored filters are not obvious.
- **Downside:** A user searches the wrong domain, misreads counts, or loses their place when switching.
- **Sensitivity:** Medium.
- **Hedge:** One clearly labelled header selector, no mixed records, mode-specific text tabs, separate URL-backed filter/scroll state, one shared Create action, and return to the originating mode after detail/create work.
- **Early warning:** Users search the wrong mode, mistake Workorder counts for Inspection counts, or use browser history to recover filters.

### Assumption Y: read-only users can confirm inspection completion from a compact row

- **Counter-evidence:** “Completed” alone can hide Issues found, Out of service, an old completion date, or the wrong truck/trailer.
- **Downside:** Guard or dispatch treats an unsuitable or unrelated slip as acceptable.
- **Sensitivity:** Critical for operational interpretation.
- **Hedge:** Always show exact unit identity, truck/trailer, inspection number, completed date, mechanic, and text result in the row and slip header. Never label the record “Ready” or make a load-release decision.
- **Early warning:** Users must open every slip to learn result/date or confuse Completed with Passed in usability testing.

### Assumption Z: module switching and interrupted checklist work preserve user confidence

- **Counter-evidence:** Refresh, back navigation, workorder linkage, or switching Office destinations can reset filters, scroll, checklist position, or unsynced answers.
- **Downside:** Rework, skipped checks, and distrust of the application.
- **Sensitivity:** High.
- **Hedge:** URL-backed per-mode state, restored scroll/focus, durable server-confirmed checklist progress, visible save status, leave warnings for unsynced changes, and role-specific interruption tests.
- **Early warning:** Users take screenshots before leaving, reopen multiple tabs to preserve state, or report repeated checklist answers after returning.

### Assumption AA: building annual/FMCSA Periodic support in V1 will save time later

- **Counter-evidence:** Periodic inspections add applicability rules, inspector qualification evidence, regulated report fields, retention, certification-safe wording, and a larger test surface that weekly shop checks do not need.
- **Downside:** A simple weekly release is delayed, users see choices they do not need, and incomplete compliance behavior may be mistaken for a certified annual inspection.
- **Sensitivity:** Critical to scope, safety, and release confidence.
- **Hedge:** Preserve typed extension points and the future requirements in this plan, but add no periodic UI, API choice, seed, database workflow, or release dependency until that phase is separately authorized.
- **Early warning:** Periodic profile fields appear in V1 migrations, create forms, template presets, role tests, or required release gates.

## 14. Release gates

Do not release until:

1. Product owner approves the three-section, twelve-item Weekly Truck and Weekly Trailer defaults and confirms they can be completed in approximately five minutes without an issue.
2. Create shows only **Workorder** and **Inspection**; the weekly inspection flow contains no annual/FMCSA Periodic option or certification claim.
3. Template family registry and tenant/RBAC boundaries pass negative tests.
4. Published-version immutability and historical print replay pass.
5. Existing active-workorder link behavior passes browser and transaction tests.
6. Service history remains usable under simulated high inspection volume.
7. Maximum template print and phone layouts have rendered evidence.
8. Off and Read only module modes pass deep-link, direct-API, cross-company, cross-location, guessed-ID, print, cache, and permission-revocation negative tests.
9. Read-only response allowlists prove that no workorder-only or Admin-only fields cross the inspection boundary.
10. Production-like inspection-list/search/detail tests meet the provisional latency, bounded-query, pagination, and payload budgets with reviewed query plans.
11. A small pilot covering inspection-only Mechanic, Office with both modules, read-only guard/dispatch, and Admin completes each role's primary path without navigation coaching or lost state.
12. The long-checklist and intermittent-connectivity scenarios meet the UI acceptance checks, including recovery from save failure and stale-version conflict.
13. Migration is rehearsed on representative PostgreSQL data with compatibility defaults and rollback documented.
14. Local checks, Git delivery, staging health, and authenticated staging workflows are reported as separate evidence layers.
15. Annual/FMCSA Periodic presets are not seeded, visible, selectable, or required for V1; their future protected-profile requirements remain documented and separately gated.

## 15. Future annual/FMCSA Periodic boundary

Annual/FMCSA Periodic inspections are not part of the weekly release. Their later implementation requires a separately approved scope covering protected federal minimums, vehicle applicability, qualified-inspector evidence, required report fields, regulated retention, certification-safe print output, migrations, authorization tests, and independent release gates. Weekly records must never be relabelled or treated as periodic certifications.

## 16. Future workorder template builder boundary

The later workorder builder should enter through the Templates catalog, but must preserve workorder domain ownership:

- Workorder fields remain typed and server-authorized.
- Parts, serialized identity, labor, assignments, completion, Odoo export, and print archives remain canonical domain services.
- Template controls order, labels, visibility, optional text, safe layout blocks, and allowed field presentation—not lifecycle or permissions.
- Existing `location_workorder_templates` values receive an explicit mapping into published workorder template versions.
- During transition, dual-read compares old and new projections; writes remain single-owner.
- Cutover requires preview/PDF parity for representative locations and a rollback path.

This boundary makes the Templates workspace extensible without turning template configuration into a second source of business logic.
