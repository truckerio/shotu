# Workorder Module Platform V2 traceability

This file is the implementation ledger for `WORKORDER_MODULE_PLATFORM_V2.md`. It does not redefine product behavior. A requirement is marked complete only after its focused test, PostgreSQL proof where applicable, full verification, and live UI check pass.

| Requirement | Primary owner | Required proof | Status |
| --- | --- | --- | --- |
| FR-1, FR-2, FR-13 | `shared/workorder-modules.js` | Registry/default/alias parity tests | Complete; canonical catalog and compatibility aliases pass |
| FR-3, NFR-4 | Admin policy repository and migrations | PostgreSQL precedence and stale-version integration | Complete; company/location/user precedence, cleanup, tenant rejection, and both optimistic conflicts pass in PostgreSQL |
| FR-4, FR-5, FR-8 | Workorder module authorization and runtime routes | HTTP denial/allowance tests across roles and lifecycle | Complete; canonical and compatibility routes delegate through the guarded runtime registry |
| FR-6, FR-7 | Module-shaped API presenters and frontend module host | Hidden payload absence and read-only no-mutation tests | Complete; protected projections, action filtering, and read-only render gates pass |
| FR-9, FR-10 | `frontend/src/features/admin/modules/` | Company/location/user save-reset and accessibility tests | Complete; one Modules editor, reversible live save/reset, source labels, and focused accessibility contracts pass |
| FR-11, FR-12, FR-15 | `frontend/src/features/workorder-modules/` | Shared-host ownership and fixture-module routing tests | Complete; Create/detail hosts and role surfaces use registered module owners |
| FR-16 | Admin Operations and shared Odoo module | Legacy redirect, queue selection, and live detail proof | Complete; duplicate Admin Odoo workspace removed, legacy links select Odoo backlog, and eligible/ineligible detail states use the shared module |
| FR-14 | `src/server/modules/admin/module-policy-audit.js` plus structured event emitter | Exactly-one structured permission event test | Complete; one correlated event after success and none on no-op/conflict; durable audit storage remains intentionally out of scope |
| NFR-1, NFR-2, NFR-3 | Shared resolver and request authorization context | Fail-closed, one-load, next-request revocation tests | Complete; unknown capabilities fail closed and policy decisions remain request-scoped |
| NFR-5, NFR-6 | Shared responsive surfaces | Keyboard, 200% zoom, 390/430/1280/1920 and workflow parity | Complete; native keyboard controls and heading focus pass, 200%-equivalent 960px reflow passes, and live 390/430/1280/1920 pages have zero horizontal overflow |
| NFR-7 | Repository verification | Focused, PostgreSQL, `npm run verify`, build, diff check | Complete; PostgreSQL proof, 856/856 unit tests, full verify, production build, strict spec validation, and diff check pass |

## Slice gates

1. Canonical policy and storage must pass before runtime routes are migrated.
2. Runtime read/write authorization must pass before frontend compatibility paths are removed.
3. Shared module renderers must pass role parity before role-specific renderers are deleted.
4. Administrative policy changes must emit through the existing audit seam before the V2 slice is complete.
5. Legacy aliases, compatibility routes, and storage remain only at the documented migration boundary; they delegate to canonical owners and can be removed in a separately deployed production migration after downstream clients are confirmed migrated.
