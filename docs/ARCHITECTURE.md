# Architecture

This repository is a modular monolith: one deployable Node service, one React application, and one PostgreSQL database. Keep boundaries obvious and avoid adding infrastructure until the workload requires it.

Frontend feature ownership and extension rules are defined in
[`FRONTEND_OWNERSHIP.md`](./FRONTEND_OWNERSHIP.md). Controlled role-test account
provisioning is documented in [`QA_ACCOUNTS.md`](./QA_ACCOUNTS.md). Cleanup
progress and remaining structural controls are tracked in
[`ENGINEERING_RISK_REGISTER.md`](./ENGINEERING_RISK_REGISTER.md). Repeatable
Chino-scale release measurements are defined in
[`PERFORMANCE_BASELINE.md`](./PERFORMANCE_BASELINE.md).

## Request Flow

```text
React feature -> /api route -> domain service -> repository -> PostgreSQL
                                   |
                                   +-> external integration
```

- Routes own HTTP parsing, authorization calls, and response codes.
- Domain services own workflow rules and transactions spanning repositories.
- Repositories own SQL and database projections.
- Integrations own provider-specific requests and response mapping.
- The authenticated server actor owns role, company, and location scope. Browser payloads never choose an actor.

## Folder Map

```text
frontend/src/
  app/                  Application composition, role routing, and URL state
  components/           Shared UI used by multiple roles
    forms/              Shared text-entry policy, narratives, and proofreading UI
    preview/            The single shared preview implementation
    ui/                 Small UI primitives
    workorders/         Shared detail, chat, queue, timeline, and parts UI
  features/             Role or workflow-owned UI
    admin/              Operations, locations, users, templates, and invitations
    auth/               Session gate and login
    create-workorder/   Shared admin, office, and mechanic create-workorder page shell
    generator/          Physical workorder generator UI
    mechanic/           Mechanic workspace and active-work progress autosave
    office/             Office workspace
    surveillance/       Closed-workorder/Odoo workflow
    workorder-drafts/   Office/admin unfinished-creation queue
  lib/                  Browser API and date utilities

docs/
  integrations/         External integration guides and machine-readable API contracts

shared/
  units-of-measure.js   Canonical quantity units, symbols, precision, conversion rules
  workorder-template.js Browser/server-safe workorder rendering

src/server/
  auth/                 Better Auth adapter, actor context, permissions, access rules
  config/               Validated environment configuration
  db/
    migrations/         Immutable ordered schema changes
    repositories/       SQL grouped by owned table or aggregate
    seeds/              Explicit non-production bootstrap data
  integrations/         Shared integration platform and provider-owned adapters
    core/                Machine clients, credentials, encryption, jobs, and provider registry
    odoo/                Company-scoped Odoo service API and result persistence
    samsara/             Samsara OAuth, connection status, asset sync, and provider adapter
    vin/                 VIN decoding provider client
  modules/              Business workflows grouped by domain
  routes/               Thin HTTP route families
  services/             Small cross-domain application services

server.js               Composition root plus contained legacy print/share endpoints
```

`server.js` contains the remaining physical print/share composition endpoints. Do not add new domain workflows there. New APIs belong under `src/server/routes` and new UI styling belongs with its feature.

## API Ownership

| Route family | Owner |
| --- | --- |
| `/api/auth/*`, `/api/me` | `src/server/auth/` |
| `/api/admin/*`, `/api/invitations/*` | `routes/admin.routes.js` and `modules/admin/` |
| `/api/office/*` | `routes/office.routes.js` and `modules/office/` |
| `/api/mechanic/*` | `routes/mechanic.routes.js` and `modules/mechanic/` |
| `/api/surveillance/*` | `routes/surveillance.routes.js` and `modules/surveillance/` |
| `/api/vehicles/*` | `routes/vehicles.routes.js` and `services/vehicles.service.js` |
| `/api/integrations/clients`, `/api/integrations/clients/:id/revoke` | `routes/integrations.routes.js` and `integrations/core/` |
| `/api/integrations/odoo/v1/*` | `integrations/odoo/` with authentication and scopes from `integrations/core/` |
| `/api/integrations/samsara/*` | `routes/integrations.routes.js` and `integrations/samsara/` via the core provider registry |
| `/api/parts-helper/*` | `routes/parts-helper.routes.js` and `modules/parts-helper/` |
| `/api/proofreading/*` | `routes/proofreading.routes.js` and the provider boundary in `modules/proofreading/` |
| `/api/workorder-drafts/*` | `routes/workorder-drafts.routes.js`, `modules/workorders/workorder-drafts.service.js`, and `repositories/workorder-drafts.repo.js` |
| Physical batch print/share | `server.js` (legacy local workflow only) |

Office and mechanic views read and update the same `operational_workorders` record. Role-specific UI changes presentation and allowed commands, not data ownership.

### Shared Workorder Detail Surface

`components/workorders/WorkorderDetailSurface.jsx` is the only owner of the
workorder-detail frame. It composes `WorkorderDetailLayout`,
`WorkorderObjectSummary`, and `WorkorderSectionNav`, and provides the one
supporting-pane slot used by responsive preview and chat docks. Office,
mechanic, and surveillance detail pages render that surface instead of
recreating the header, summary, navigation, or two-pane frame. Shared frame
changes therefore ship to every role together.

Role features extend the surface through explicit content and action slots:

- `WorkorderDetailPage.jsx` owns the office/mechanic chat, editable work forms,
  parts workflow, completion controls, and its shared section definitions.
- `features/surveillance/workspace/SurveillanceDetailPage.jsx` owns the
  surveillance detail composition, while `SurveillanceOdooPanel.jsx` owns Odoo
  entry and missing-information requests. `SurveillanceWorkspace.jsx` remains
  a small queue/detail switch.
- Slots receive already-authorized commands and rendered role content. The
  surface must not infer permissions or contain Odoo, mechanic, or office
  workflow rules.
- A role may add a section through the surface's section/content inputs. It may
  not directly import or compose `WorkorderDetailLayout`,
  `WorkorderObjectSummary`, or `WorkorderSectionNav`.

Preview and activity also have one implementation each. Role content passed to
the surface uses
`components/preview/PreviewPane.jsx`,
`components/workorders/CompactWorkorderPreview.jsx`, and
`components/workorders/WorkorderTimeline.jsx`; role folders must not create
alternate preview panes or timeline renderers. Source-contract tests under
`features/workorder-detail/` enforce these ownership boundaries.

### Proofreading Boundary

`components/forms/NarrativeField.jsx` is the shared narrative owner for every
role. It composes the common text-entry policy, highlights normalized issues,
applies range-safe corrections through real input events, and provides the
keyboard/mobile suggestion experience. Feature screens pass controlled values
and normal form callbacks; they do not call a proofreading vendor directly.

```text
NarrativeField -> routes/proofreading.routes.js
                         |-> modules/proofreading/proofreading.service.js
                         |     |-> providers/wproofreader.provider.js
                         |     `-> providers/openai-context.provider.js (optional)
                         `-> proofreading-dictionaries.service.js
                                      `-> proofreading-dictionaries.repo.js -> PostgreSQL
```

The check path is layered. A fast WProofreader check runs after a typing
debounce and retains spelling plus only range-safe, single-token grammar.
Broad grammar spans receive one bounded spelling-only lexical recovery pass.
After blur, deep mode may add WProofreader AI and an optional high-confidence
OpenAI contextual pass. Context findings are suggestions only. Every adapter
returns the same issue contract, validates exact offsets, accepts abort signals,
and fails open so provider availability never controls workorder persistence.

Personal and company dictionary rows in PostgreSQL are application truth.
Provider word lists are bounded request-time optimizations, not an identity or
authorization boundary. The authenticated actor may manage personal terms;
company terms require an authorized admin. See [`docs/PROOFREADING.md`](PROOFREADING.md)
for contracts and replacement rules.

Proofreading cache, in-flight coalescing, concurrency, and rate-limit state are
currently process-local. This is appropriate for the single-replica deployment.
Move coordination to a shared store before horizontal application scaling to
avoid multiplied provider traffic and independent limits.

### Integration Platform

`src/server/integrations/core/` owns shared provider infrastructure; each provider
keeps its transport and mapping logic in its own directory. Browser-session
administration creates and revokes company-scoped machine clients through
`/api/integrations/clients`. External Odoo workers authenticate with those
clients and call only `/api/integrations/odoo/v1/*`.

Start with [`docs/integrations/README.md`](integrations/README.md). The external
Odoo contract is available as both the
[`developer guide`](integrations/ODOO_INTEGRATION_API.md) and
[`OpenAPI 3.1 specification`](integrations/ODOO_INTEGRATION_TARGET.openapi.yaml).

### Create Workorder

`frontend/src/features/create-workorder/` owns the create-workorder page for
Admin, Manager/office, and Mechanic. It intentionally reuses the shared
workorder-detail layout primitives so create and detail screens do not drift:

- `CreateWorkorderPage.jsx` composes the shared split layout, preview, keyboard
  handling, and section state.
- `CreateWorkorderShell.jsx` owns the create header, summary strip, section
  navigation, draft indicator, preview toggle, and mobile dock.
- `CreateWorkorderForm.jsx` remains the shared operational form content.
- `useCreateLocationController.js` owns location/template loading, retry state,
  selected-location reconciliation, and the location-scoped mechanic list.
- `useWorkorderDraftLifecycle.js` owns draft persistence and restoration;
  `useVehicleLookupController.js` owns asset lookup and location refresh.
- `useWorkorderPrintController.js` owns browser printing, archived PDF state,
  and print-status feedback.
- `RoleRouter.jsx` supplies authenticated actor scope and coordinates the
  extracted route controllers. `RoleWorkspaceOutlet.jsx` owns page composition;
  command, form, detail-route, view-model, and lifecycle modules own their
  respective behavior.

`RoleRouter.jsx` is a coordinator, not a feature owner. Keep it below 500 lines.
Route navigation, role capabilities, detail loading, create commands, form
commands, lifecycle effects, and workspace composition each have the dedicated
owners listed in [`FRONTEND_OWNERSHIP.md`](./FRONTEND_OWNERSHIP.md). A new route
behavior belongs in one of those owners rather than another conditional block
in the coordinator.

Role differences must stay capability-driven: Admin and Manager can assign
mechanics and use the draft lifecycle; Mechanic create omits Assignment,
self-assigns the current mechanic on submit, and creates the real workorder
directly. Location changes must update the create summary strip, template fields,
draft payload, and assignment mechanic list from the same selected location.

### Quantity And Inventory Units

`shared/units-of-measure.js` is the application contract for unit codes,
categories, symbols, precision, and universal conversions. PostgreSQL owns
durable quantities and product-specific packaging conversions. All role
surfaces, print output, timeline output, and integrations consume the shared
contract instead of defining their own unit lists.

Measured quantities use decimal-safe values. Count and packaging units remain
whole numbers. Cases, boxes, jugs, drums, and cylinders never receive a global
conversion factor because their contents depend on the product. See
`docs/UNITS_OF_MEASURE.md`.

### User Lifecycle

Better Auth owns passwords, account bans, and session revocation. `user_profiles` owns operational contact identity. Company and location memberships own role and access. Admin user-management routes authorize the target location and every company membership before changing either layer.

- Creating or resending an invitation attempts SMTP delivery after the durable
  invitation is saved. The API returns a safe delivery status and the Admin UI
  always retains the one-time invitation link as a fallback when SMTP is
  unavailable. Invitation email failure never rolls back or hides the pending
  invitation.
- Self-service password change requires the current password and preserves only
  the current session. Forgotten-password recovery uses Better Auth verification
  storage for a single-use 15-minute token, SMTP only transports the reset link,
  and a completed recovery revokes every existing session.
- Recovery requests return the same public response for known and unknown email
  addresses. Phone recovery is not an auth source until phone ownership is
  stored and verified.
- Deactivation bans the login and deactivates all operational memberships.
- Activation restores the selected company/location membership and unbans the login.
- Deletion removes the login and contact data but keeps a tombstoned `user_profiles` row so historical workorder, chat, and audit references remain valid.
- Admin user management sends the existing 15-minute recovery email instead of
  asking an administrator to choose another person's password. Delivery requests
  are recorded as `password_reset_requested`; a delivered link does not prove
  that the password was changed.
- `admin_user_events` records password-reset requests, legacy direct resets,
  activation, deactivation, and deletion. An admin cannot deactivate, delete,
  or reset their own account through user management.

Direct Better Auth admin transport routes are not public API. The application exposes tenant-checked commands under `/api/admin/locations/:locationId/users/:userId`.

### Operations Projection

`modules/workorders/workorder-operations.service.js` is the single authorized list/query boundary for cross-location workorder operations. It derives scope exclusively from the authenticated request context:

- admin: all locations in an authorized company;
- office: assigned company and locations;
- mechanic: assigned work plus unassigned available work;
- surveillance: completed work only.

The projection is paginated and filterable and includes canonical lifecycle, attention reasons, location, asset, mechanic, last activity, age, time in status, and per-user unread state. Admin consumes it through `/api/admin/operations/summary` and `/api/admin/operations/workorders`.

Lifecycle and attention are intentionally separate. Lifecycle is one of `open`, `accepted`, `in_progress`, `mechanic_done`, `closed`, `odoo_entered`, or `cancelled`. Parts, office help, missing information, and overdue work are attention reasons; they never create or replace a workorder record.

The handoff reuses the existing mechanic Work done command. An assigned mechanic's first open or accept records the canonical start; Work done records the current completion time. A Manager may approve, return with a revision note, or cancel with a reason. Return preserves Activity history and opens `revision_requested` attention. Surveillance remains read-only and can request missing information on closed work; a Manager may then correct administrative fields without overwriting mechanic-authored evidence.

### Drafts And Mechanic Progress

Creation drafts and mechanic progress have different lifecycles and must not be
combined:

- A `workorder_drafts` row is an unfinished office/admin creation. It has no
  serial and is not visible in mechanic queues. Office sees drafts in assigned
  locations; admin sees authorized-company drafts and must explicitly take
  ownership before editing another user's draft.
- Submitting a draft creates exactly one `operational_workorders` row and
  reserves its serial inside the submit transaction. Repeating the submit is
  idempotent.
- Mechanic diagnosis and work performed are fields on the real assigned
  workorder. `repositories/workorder-progress.repo.js` updates them with an
  optimistic `progress_version`; it never creates a draft workorder.
- Browser autosave may write frequently, but the operator timeline receives one
  grouped `work_details_updated` event per editing burst. Access/open events
  remain append-only audit records and are not shown as operator activity.

The frontend reflects the same ownership:

- `features/workorder-drafts/` owns the office/admin drafts queue.
- `components/drafts/useDraftForm.js` owns create-form persistence.
- `features/create-workorder/` owns the shared create page; it does not own
  operational workorder truth after submit.
- `features/mechanic/progress/` owns assigned-work autosave and local recovery.
- `app/routes/RoleRouter.jsx` composes these features and coordinates the
  dedicated role/URL navigation owner.

## Adding A Feature

1. Add or change the PostgreSQL schema in a new ordered migration.
2. Put SQL in the repository that owns the affected table.
3. Put workflow and authorization-sensitive decisions in a domain service.
4. Mount a thin route and map it in the permission policy.
5. Add feature-local UI and focused tests, then run `npm run verify`.

Do not create a second workorder, user, location, template, or asset table for a new screen. Extend the current owner unless the data has a genuinely different lifecycle.

## Release Verification

The release gates intentionally cover different failure classes:

```sh
npm run verify
node scripts/visual/css-ownership-viewport.js
npm run test:role-workflow
npm run performance:baseline:db
npm run performance:baseline:http
npm run performance:baseline:mobile
```

- `npm run verify` owns structure, focused contracts, server syntax, and the
  production frontend build.
- The viewport harness owns layout containment at phone, tablet, 1080px, and
  1920 x 1080. It is required after changing shared layout or CSS ownership.
- The role workflow owns runtime composition and authorization across Admin,
  Office, Mechanic, and Surveillance. It signs roles in sequentially so a test
  does not manufacture login-rate-limit failures through simultaneous password
  attempts.
- Performance gates own local/staging evidence at Chino-scale volume. They are
  not substitutes for production latency, pool, CPU, memory, and error-rate
  telemetry.

A successful build cannot detect every missing runtime identifier in a lazily
executed route. Shared route extraction therefore requires both focused tests
and the complete browser workflow before release.

Blank print batches and operational workorder creation both reserve serials through
`repositories/serial-counters.repo.js`. Browser input and the local print ledger
must never allocate or override a business serial.

## Deployment

Railway builds the Dockerfile, runs `npm run db:migrate` before deployment, and starts `npm start`. PostgreSQL is the operational source of truth. Generated PDFs, uploads, share packages, and chat media must use `WORKORDER_STORAGE_DIR` on a mounted persistent volume; process-local storage is not durable across deployments. A single attached volume supports the current one-replica deployment. Move files to object storage before horizontally scaling the web service.
