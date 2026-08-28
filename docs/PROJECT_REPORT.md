# Owl 2.0 - Engineering Project Report

## What This Project Is

Owl is a multi-user shop workflow app for creating, assigning, repairing,
reviewing, printing, integrating, and closing truck/trailer workorders.

The app is built for four roles:

- Admin: manages locations, users, templates, settings, and integrations.
- Office/Manager: creates workorders, assigns mechanics, reviews work, handles parts, and closes workorders.
- Mechanic: sees assigned/open/active jobs, joins work, creates workorders, records repair progress, requests parts, chats with office, and finishes work.
- Surveillance: reviews completed/closed workorders and tracks Odoo entry/backlog.
- Office: can also review encrypted invoice-extraction drafts; receipt creation
  remains a separate explicit inventory operation.

GitHub: [truckerio/shotu](https://github.com/truckerio/shotu)

## How It Works

Postgres is the source of truth.

Main flow:

1. Admin creates locations, templates, users, and integration settings.
2. Office or mechanic creates a workorder.
3. Workorder enters operational queue.
4. Mechanic accepts or joins work.
5. Mechanic records diagnosis, repair, used parts, chat, and photos.
6. Office reviews details, parts, and timeline.
7. Completed work moves to Surveillance/Odoo flow.
8. Workorder preview/print uses the location template.

Samsara integration:

- Backend syncs Samsara trucks/trailers into Postgres.
- UI searches local cached assets instead of calling Samsara per keystroke.
- Selecting a unit fills VIN, mileage, license, type, model, company/owner, and location when available.
- Admin Settings owns integration status and actions.

## Tech Stack

Frontend:

- React 19
- Vite
- React Aria Components
- Untitled UI icons
- Plain CSS organized by feature/component

Backend:

- Node.js 22+
- Native HTTP server
- PostgreSQL via `pg`
- Zod for validation
- Better Auth for login/session/auth tables

Database:

- PostgreSQL
- SQL migrations in `src/server/db/migrations`
- Repository layer in `src/server/db/repositories`

Deployment:

- Railway
- Dockerfile
- Railway pre-deploy runs migrations
- App starts with `npm start`

Testing:

- Node test runner
- Playwright for browser checks
- `npm run verify` for structure, backend tests, unit tests, syntax check, and production build

## Main Commands

Install:

```bash
npm install
```

Run locally:

```bash
npm start
```

Run migrations:

```bash
npm run db:migrate
```

Check database:

```bash
npm run db:check
```

Full verification:

```bash
npm run verify
```

Production build:

```bash
npm run build
```

## Environment

Required core env:

- `DATABASE_URL`
- `BETTER_AUTH_SECRET`
- `BETTER_AUTH_URL`
- `AUTH_TRUSTED_ORIGINS`

Useful integration env:

- `SAMSARA_API_TOKEN` for token fallback
- Samsara OAuth env values for production OAuth flow
- `HERE_BROWSER_API_KEY` or map provider config when enabled
- `WORKORDER_STORAGE_DIR` for durable uploads/chat media/printed files

Use `.env.example` as the starter template. Do not commit real secrets.

## Folder Ownership

Frontend:

- `frontend/src/app/routes` - role routing and URL state.
- `frontend/src/app/routes/RoleRouter.jsx` - route coordinator only; feature
  controllers, detail loading, capabilities, navigation, and workspace
  composition have separate owners in the same folder.
- `frontend/src/features/auth` - login/session gate.
- `frontend/src/features/create-workorder` - shared Admin, Manager, and Mechanic create workorder page shell.
- `frontend/src/features/generator` - shared create form content and print/preview primitives.
- `frontend/src/features/workorder-detail` - shared workorder detail page behavior.
- `frontend/src/features/mechanic` - mechanic home and mechanic-specific work/progress UI.
- `frontend/src/features/office` - office queue/home UI.
- `frontend/src/features/inventory` - shared Office/Admin local-inventory
  workspace, opening-count intake, scan surface, and exact-unit workflows.
- `frontend/src/features/admin` - admin locations/users/templates/settings/integrations.
- `frontend/src/features/surveillance` - completed/Odoo review flow.
- `frontend/src/features/workorder-modules` - V2.0 frontend module filtering
  for create/detail/queue surfaces.
- `frontend/src/components/workorders` - shared workorder UI components.
- `frontend/src/components/forms` - shared operational form pieces.
- `frontend/src/components/layout` - shared page/workspace headers.
- `frontend/src/lib` - API helpers, maps, timing, route helpers.

Backend:

- `src/server/routes` - API route handlers.
- `src/server/modules` - role/domain service logic.
- `src/server/db/repositories` - SQL/database access.
- `src/server/db/migrations` - schema changes.
- `src/server/auth` - session actor, permissions, authorization.
- `src/server/integrations` - external providers like Samsara and VIN.
- `src/server/integrations/odoo` - Odoo machine API, Admin-managed Odoo.sh
  connection, product/service-history import, outbound vehicle/warehouse/labor
  mapping, draft service-order creation, and inventory synchronization.
- `src/server/modules/invoice-extraction` - encrypted invoice source handling,
  durable worker jobs, provider adapters, reviewed drafts, correction history,
  and governed learning.
- `src/server/modules/inventory` - atomic local invoice receipt posting,
  append-only movements, current balances, serialized units, label batches,
  opening-count imports, QR resolution, and exact workorder-unit lifecycle.
- `src/server/services` - cross-domain services.
- `src/server/print` - print/PDF behavior.
- `src/server/security` - origin/rate-limit/security checks.

## Core Data Model

Important tables/areas:

- Users/auth: Better Auth tables plus app user profiles and memberships.
- Companies/locations: company-scoped yards/shops and assigned users.
- Templates: location-specific workorder print/template settings.
- Assets: cached Samsara vehicle/trailer records.
- Workorders: one operational workorder truth.
- Mechanic assignments: primary and support mechanics on a workorder.
- Parts: mechanic requests, office review, usage, and feedback.
- Chat/media: workorder conversation and attachments.
- Timeline/activity: who changed what and when.
- Drafts: unfinished create-workorder records before operational submission.

Lifecycle:

```text
open -> accepted/in_progress -> mechanic_done -> closed -> odoo_entered
```

Attention signals are separate from lifecycle:

- parts request
- office help
- missing info
- overdue
- unread activity

## Important Rules For Engineers

- Do not create a second workorder truth.
- Office, mechanic, admin, and surveillance must read the same backend workorder record.
- Shared workorder UI belongs in `features/workorder-detail` or `components/workorders`.
- Shared create-workorder UI belongs in `features/create-workorder`; role differences should be passed as capabilities.
- V2.0 module access starts from `shared/workorder-modules.js`. Effective access
  resolves location user, company user, location role, company role, then the
  built-in safe default. Each frontend module owns its manifest, renderer
  adapter, controller adapter, and tests under `features/workorder-modules/`.
  Do not create separate role pages for the same workorder task.
- Role-only behavior belongs inside its role folder.
- Do not call Samsara on every search keystroke; sync first, search Postgres.
- Do not expose provider tokens to the browser.
- Do not bypass server-side actor/session authorization with browser-supplied user IDs.
- Keep migrations backward-compatible for Railway deploys.
- Run `npm run verify` before pushing important backend or shared UI changes.

## Current Product Capabilities

- Login/session with role-based access.
- Admin locations, users, templates, settings, and Samsara integration UI.
- Admin-managed Odoo connection, immutable location mapping, parts-master and
  service-history refresh, outbound vehicle/warehouse/labor setup, draft
  service-order creation, created-order tracking/linking, and mapped-location
  inventory synchronization.
- Admin Operations includes the Odoo backlog; workorder Odoo entry uses the
  same configurable detail module as Surveillance instead of a duplicate Admin
  workspace.
- Office operational queue with filters.
- Create workorder with preview/template.
- Draft saving for office/admin create flow.
- Mechanic queue with assigned, open, active, waiting, and finished work.
- Multiple mechanics can work on one active workorder.
- Primary/support mechanic assignments.
- Mechanic can create workorders.
- Shared workorder detail page with tabs/sections.
- Chat between mechanic and office.
- Parts request workflow.
- Workorder timeline/activity log.
- Samsara asset lookup and autofill.
- Satellite asset location card.
- Print/preview workorder template.
- Surveillance completed/Odoo flow, including readiness blockers, explicit
  draft Odoo service-order creation, and stored created-order tracking.
- Office invoice extraction/review with encrypted source retention,
  confidence/evidence, optimistic review, and explicit learning opt-in.
- Local inventory vertical: a reviewed invoice can become one idempotent,
  operator-attested complete-delivery receipt without Odoo; it records receipt
  lineage, append-only movements, current local balances, serialized units for
  discrete quantities, and durable encrypted QR label batches. Office/Admin
  use the shared Inventory workspace; mechanics resolve, issue, install, or
  return exact units under company/location/workorder scope. A bounded,
  attested opening-count import supports exact master-part matches. This is not
  a general warehouse workflow: partial/damaged receipts, transfers,
  purchasing, general cycle counts, valuation, warranty, and cores remain out
  of scope.

## Good First Files To Read

- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/DATABASE.md`
- `docs/FRONTEND_OWNERSHIP.md`
- `docs/ENGINEERING_RISK_REGISTER.md`
- `docs/PERFORMANCE_BASELINE.md`
- `docs/QA_ACCOUNTS.md`
- `server.js`
- `frontend/src/app/routes/RoleRouter.jsx`
- `frontend/src/features/workorder-detail/WorkorderDetailPage.jsx`
- `src/server/routes/mechanic.routes.js`
- `src/server/routes/office.routes.js`
- `src/server/routes/admin.routes.js`
- `src/server/db/repositories/operational-workorders.repo.js`

## Verification Baseline

Historical verification results are not a release guarantee for the current
checkout. Run `npm run verify` against the exact revision, then run the
additional shared-route/layout checks in `README.md` when applicable. Keep
production evidence separate from local test evidence. The inventory living
record contains the released receipt slice’s specific evidence and remaining
production gaps; `docs/PERFORMANCE_BASELINE.md` contains performance evidence.
