# Workorder Module Platform V2

## Metadata

- **Author:** Codex
- **Date:** 2026-08-09
- **Status:** Implemented and verified locally
- **Reviewers:** Product owner

## Context

V2 replaces the former mixture of reusable sections and role-specific rendering with one canonical module contract. Frontend manifests, server authorization, routes, protected projections, and Admin policy controls now resolve the same registered module identifiers and effective access rules.

V2 keeps the application as a modular monolith. Developers own and register tested modules; administrators configure which registered modules each role or named user can use. Configuration never loads arbitrary code. Company and location boundaries, workorder access, assignment rules, and lifecycle rules remain authoritative regardless of module access.

## Functional Requirements

- FR-1: The system MUST maintain one canonical registry for stable module identifiers, supported pages, valid access modes, declared actions, and safe defaults.
- FR-2: The system MUST support `hidden`, `read`, and `write` access for registered modules. Create-required validation MUST be configured separately from access.
- FR-3: Effective access MUST resolve in this order: user location exception, user company exception, location role override, company role override, built-in safe default.
- FR-4: A module grant MUST NOT bypass company membership, location/workorder access, mechanic assignment, or lifecycle requirements.
- FR-5: Every protected module read and mutation MUST be authorized by the server against the same canonical module and action contract.
- FR-6: Hidden modules MUST be absent from navigation, direct-route resolution, supporting panes, controllers, protected response data, and mutation APIs.
- FR-7: Read-only modules MUST render values without editable controls, autosave, uploads, or mutation requests.
- FR-8: Write access MUST enable only actions explicitly declared by that module.
- FR-9: Admin MUST be able to configure company role defaults, location role overrides, and named-user exceptions from one Modules page.
- FR-9a: Admin MAY grant Edit for any role or named user when the registered module declares write capability; legacy role defaults MUST NOT become a configuration ceiling.
- FR-10: The Modules page MUST display effective access and the rule source without exposing technical implementation terms to normal users.
- FR-11: Detail and Create pages MUST compose registered modules through shared hosts rather than role-specific module implementations.
- FR-12: Queue, kiosk, and Surveillance pages MAY retain role-specific navigation and workflow chrome, but MUST reuse shared module renderers.
- FR-13: Existing saved policy keys and role behavior MUST remain compatible during migration.
- FR-14: Permission mutations MUST emit one structured administrative audit-event payload. Audit storage and presentation remain owned by the auditing feature.
- FR-15: Each frontend module MUST own its renderer, controller adapter, applicability, tests, navigation icon, and presentation metadata under `frontend/src/features/workorder-modules/<module-id>/`.
- FR-16: Admin MUST use Operations → Odoo backlog for Odoo queue discovery and the shared Odoo detail module for workorder processing. Admin MUST NOT expose a duplicate Odoo-entry workspace.

## Non-Functional Requirements

- NFR-1: Unknown modules, pages, access modes, and actions MUST fail closed.
- NFR-2: A workorder request SHOULD resolve matching policy rules in one indexed repository call and memoize decisions for that request.
- NFR-3: Revocations MUST apply on the next request; process-memory permission caching is out of scope for the first release.
- NFR-4: Policy writes MUST use optimistic concurrency and return `409` for a stale policy version.
- NFR-5: Module configuration MUST remain keyboard accessible, usable at 200% zoom, and have zero horizontal page overflow at 390px, 430px, 1280px, and 1920px.
- NFR-6: Existing lifecycle, autosave, print, fullscreen preview, kiosk, office, and Surveillance workflows MUST remain behaviorally compatible unless an explicit module setting changes them.
- NFR-7: Focused contract tests, PostgreSQL integration tests, `npm run verify`, and the production build MUST pass before obsolete code is removed.

## Acceptance Criteria

### AC-1: Canonical parity (FR-1, FR-2, FR-13)

Given existing role defaults and saved aliases, when the canonical resolver replaces the duplicate registries, then every role receives the same effective access as before migration and access uses hidden, read, or write with create-required validation stored separately.

### AC-2: Resolution precedence (FR-3)

Given company Office Odoo access is read, a location overrides Office to write, and one Office user is hidden, when each actor opens the same eligible workorder, then the company user receives read, the location user receives write, and the named user receives hidden.

### AC-3: Resource boundaries (FR-4, FR-5)

Given a mechanic has Odoo write but lacks access to the workorder location, when the mechanic calls an Odoo action, then the resource remains unavailable and no provider mutation occurs.

### AC-4: Hidden module (FR-6)

Given Parts is hidden, when a user opens or directly links to the Parts section, then Parts navigation, protected data, controller requests, and actions are absent and the route falls back safely.

### AC-5: Read-only module (FR-7)

Given Unit is read-only, when the module renders, then values are visible but no field mutation or autosave request can occur and the server rejects direct update attempts.

### AC-6: Declared actions (FR-8)

Given Team is writable but `remove` is not declared for the actor, when Team renders, then assignment actions remain available but removal is absent and rejected by the server.

### AC-7: Admin configuration (FR-9, FR-10)

Given an Admin manages a module, when role, location, and user settings are changed or reset, then the page shows Off/View/Edit, effective access, source, and inheritance restoration without editing another permission screen.

### AC-8: Shared role rendering (FR-11, FR-12)

Given Admin and Surveillance can open the same Odoo-eligible workorder, when each opens its detail page, then both use the same Odoo module renderer and controller while Surveillance retains its queue controls.

### AC-9: Independent module ownership (FR-15)

Given a test fixture module is registered, when the app builds its detail navigation, then the module appears without adding a role page or hardcoded route allowlist.

### AC-10: Audit seam (FR-14)

Given one permission change is submitted, when it succeeds, then exactly one administrative audit payload containing actor, scope, subject, module, page, before, after, request ID, and timestamp is emitted.

### AC-11: Concurrent editing (NFR-4)

Given two admins edit the same policy version, when the first succeeds and the second submits the stale version, then the second receives `409` without overwriting the first.

### AC-12: Verification (NFR-5, NFR-7)

Given the supported viewport and accessibility matrix, when verification runs, then there is no horizontal overflow and all focused, PostgreSQL, full verification, and build gates pass.

### AC-13: Admin Odoo ownership (FR-15, FR-16)

Given an Admin needs to process Odoo work, when they open Operations, then the Odoo backlog identifies eligible workorders and the shared workorder Odoo module owns the detail workflow. Legacy Admin Odoo-entry links redirect to that backlog.

## Edge Cases

- EC-1: A stored legacy alias resolves to its canonical module during compatibility reads and is written canonically on the next update.
- EC-2: Odoo is unavailable for the current lifecycle; configured users still see the module and its safe unavailable explanation, while readiness and mutation requests remain disabled until lifecycle eligibility.
- EC-3: A user belongs to multiple locations; a location exception applies only inside that location.
- EC-4: A user or location is removed; associated rules are removed or disabled transactionally without broadening access.
- EC-5: Policy data is missing or malformed; built-in safe defaults apply and invalid entries do not broaden access.
- EC-6: No configurable modules are visible; the fixed workorder identity shell and an explicit no-access state remain usable.
- EC-7: A role-specific compatibility route is called; it delegates to the same shared authorization service and returns the same result as the canonical module endpoint.
- EC-8: Background polling reads access state; it does not create administrative audit events.

## API Contracts

```ts
type ModuleAccess = "hidden" | "read" | "write";
type ModulePage = "queue" | "create" | "detail";

interface ResolvedModuleAccess {
  moduleId: string;
  page: ModulePage;
  access: ModuleAccess;
  actions: Record<string, boolean>;
  source: "built_in" | "company_role" | "location_role" | "company_user" | "location_user";
}

interface ModulePolicyPatch {
  moduleAccess: Record<string, Record<ModulePage, Record<string, ModuleAccess | "required">>>;
  userModuleAccess: Record<string, Record<ModulePage, Record<string, ModuleAccess | "required">>>;
  expectedVersion?: number;
  mechanicCanRecordParts?: boolean;
}
```

Administrative contracts:

```http
GET   /api/admin/module-access?companyId=:companyId&locationId=<optional>
GET   /api/admin/module-access/users/:userId?companyId=:companyId&locationId=<optional>
PATCH /api/admin/module-access/roles/:role
PATCH /api/admin/module-access/users/:userId

GET   /api/admin/module-catalog
GET   /api/admin/companies/:companyId/module-policy
PATCH /api/admin/companies/:companyId/module-policy
GET   /api/admin/locations/:locationId/workorder-policy
PATCH /api/admin/locations/:locationId/workorder-policy
```

The rule-level `/module-access` routes are canonical external adapters and
store create-required as a separate boolean. The Modules UI uses the bulk
company/location policy endpoints so one explicit Save remains one atomic
policy mutation. Both company and location PATCH use `expectedVersion` and
return `409` with `WORKORDER_MODULE_POLICY_CONFLICT` when stale. See
`docs/api/WORKORDER_MODULE_ADMIN_API.md` for exact request and response shapes.

The product presents create-required as a separate checkbox. Normalized rules
store it separately; compatibility JSON projections may encode the same state
as `"required"` while legacy clients migrate.

Canonical runtime contracts:

```http
GET   /api/workorders/:id/modules/:moduleId
PATCH /api/workorders/:id/modules/:moduleId
POST  /api/workorders/:id/modules/:moduleId/actions/:action
```

Every runtime route MUST use an explicit registry allowlist mapping the module/action to a schema and service handler. Compatibility routes MAY remain temporarily but MUST delegate to the same guarded service.

## Data Models

| Entity | Required fields | Constraints |
| --- | --- | --- |
| Company module policy | company id, sparse role access JSON, sparse user access JSON, version, updated by, timestamps | one row per company; optimistic version |
| Location workorder policy | location id, company id, mechanic-parts rule, sparse role access JSON, sparse user access JSON, version, updated by, timestamps | one row per location; optimistic version |
| Normalized module policy scope | scope type, company, optional location, version, updated by, timestamps | unique company scope and unique location scope |
| Normalized module rule | scope, role/user subject, page, module, access, required | unique per scope, subject, page, and module; required stored separately |
| Resolved access | module id, page, access, actions, source | returned only for the current actor at runtime |
| Audit event payload | actor, scope, target, module, page, before, after, request id, timestamp | emitted once after a successful policy mutation |

Migrations 049 and 050 add the compatibility location/company sparse maps.
Migration 051 adds normalized policy scopes and rules with a separate required
flag. Migration 052 adds optimistic versioning to location compatibility
policies, and migration 053 enforces normalized subject integrity. Canonical
writes project to compatibility storage during the migration window; legacy
columns are not removed before production verification.

## Out of Scope

- OS-1: Runtime-loaded JavaScript plugins or a third-party module marketplace.
- OS-2: Allowing module access to bypass tenant, location, assignment, or lifecycle authorization.
- OS-3: Replacing kiosk, role queues, or role-specific home-screen navigation.
- OS-4: Redesigning Odoo provider payloads, part inventory behavior, printing, or workorder lifecycle semantics.
- OS-5: Implementing the auditing feature's event table, retention, export, or audit UI in this slice.
- OS-6: Removing legacy compatibility storage or routes before migration parity and production verification.
