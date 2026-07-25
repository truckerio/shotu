# Architecture

This repository is a modular monolith: one deployable Node service, one React application, and one PostgreSQL database. Keep boundaries obvious and avoid adding infrastructure until the workload requires it.

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
  app/                  Application composition and the legacy generator container
  components/           Shared UI used by multiple roles
    preview/            The single shared preview implementation
    ui/                 Small UI primitives
    workorders/         Shared detail, chat, queue, timeline, and parts UI
  features/             Role or workflow-owned UI
    admin/              Locations, templates, and invitations
    auth/               Session gate and login
    generator/          Physical workorder generator UI
    mechanic/           Mechanic workspace
    office/             Office workspace
    surveillance/       Closed-workorder/Odoo workflow
  lib/                  Browser API and date utilities

shared/
  workorder-template.js Browser/server-safe workorder rendering

src/server/
  auth/                 Better Auth adapter, actor context, permissions, access rules
  config/               Validated environment configuration
  db/
    migrations/         Immutable ordered schema changes
    repositories/       SQL grouped by owned table or aggregate
    seeds/              Explicit non-production bootstrap data
  integrations/         Samsara and VIN provider adapters
  modules/              Business workflows grouped by domain
  routes/               Thin HTTP route families
  services/             Small cross-domain application services

server.js               Composition root plus contained legacy print/share endpoints
```

`server.js` and `frontend/src/styles.css` contain the original physical generator implementation. Do not add new domain workflows there. New APIs belong under `src/server/routes` and new UI styling belongs with its feature.

## API Ownership

| Route family | Owner |
| --- | --- |
| `/api/auth/*`, `/api/me` | `src/server/auth/` |
| `/api/admin/*`, `/api/invitations/*` | `routes/admin.routes.js` and `modules/admin/` |
| `/api/office/*` | `routes/office.routes.js` and `modules/office/` |
| `/api/mechanic/*` | `routes/mechanic.routes.js` and `modules/mechanic/` |
| `/api/surveillance/*` | `routes/surveillance.routes.js` and `modules/surveillance/` |
| `/api/vehicles/*` | `routes/vehicles.routes.js` and `services/vehicles.service.js` |
| `/api/integrations/samsara/*` | `routes/integrations.routes.js` and `integrations/samsara/` |
| `/api/parts-helper/*` | `routes/parts-helper.routes.js` and `modules/parts-helper/` |
| Physical batch print/share | `server.js` (legacy local workflow only) |

Office and mechanic views read and update the same `operational_workorders` record. Role-specific UI changes presentation and allowed commands, not data ownership.

### Operations Projection

`modules/workorders/workorder-operations.service.js` is the single authorized list/query boundary for cross-location workorder operations. It derives scope exclusively from the authenticated request context:

- admin: all locations in an authorized company;
- office: assigned company and locations;
- mechanic: assigned work plus unassigned available work;
- surveillance: completed work only.

The projection is paginated and filterable and includes canonical lifecycle, attention reasons, location, asset, mechanic, last activity, age, time in status, and per-user unread state. Admin consumes it through `/api/admin/operations/summary` and `/api/admin/operations/workorders`.

Lifecycle and attention are intentionally separate. Lifecycle is one of `open`, `accepted`, `in_progress`, `mechanic_done`, `closed`, or `odoo_entered`. Parts, office help, missing information, and overdue work are attention reasons; they never create or replace a workorder record.

## Adding A Feature

1. Add or change the PostgreSQL schema in a new ordered migration.
2. Put SQL in the repository that owns the affected table.
3. Put workflow and authorization-sensitive decisions in a domain service.
4. Mount a thin route and map it in the permission policy.
5. Add feature-local UI and focused tests, then run `npm run verify`.

Do not create a second workorder, user, location, template, or asset table for a new screen. Extend the current owner unless the data has a genuinely different lifecycle.

## Deployment

Railway builds the Dockerfile, runs `npm run db:migrate` before deployment, and starts `npm start`. PostgreSQL and durable object storage are production dependencies; local print/upload directories are not suitable as distributed storage across replicas.
