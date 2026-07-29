# Server integrations

This directory owns external-system boundaries. Keep provider-specific protocols here and reuse the company-scoped primitives in `core/` instead of creating separate credential, job, mapping, idempotency, or audit systems.

## Directory map

```text
integrations/
├── core/       Shared integration security and delivery infrastructure
├── odoo/       Odoo workorder service API and transactional result handling
├── samsara/    Samsara OAuth, API client, asset mapping, sync, and job adapter
└── vin/        NHTSA vPIC VIN enrichment client used by asset sync
```

### `core/`

`core/` is provider-neutral. It owns:

- machine-client tokens, hashing, scopes, and company isolation;
- encrypted provider credentials;
- the provider registry and durable job worker;
- retries, mappings, idempotency records, webhook inbox, outbox, and audit events;
- consistent integration error types.

Do not put provider URLs, payload fields, or business-specific transformations in `core/`. Do not store raw secrets or invent provider-specific copies of its tables.

### Provider folders

- `samsara/` is a registered provider adapter. Administrators manage its connection through browser routes in `src/server/routes/integrations.routes.js`; the app session, `integration:admin` permission, same-origin checks, and company access apply. Its adapter registers capabilities and background job handlers with `core/integration-provider.registry.js`.
- `odoo/` exposes the versioned machine-to-machine API under `/api/integrations/odoo/v1`. These requests bypass browser-session authentication and instead resolve a Bearer token through `core/integration-auth.js`, enforce client scopes, and derive the company from that integration client. The route is registered directly in `server.js` before the browser same-origin boundary.
- `vin/` currently contains a stateless NHTSA vPIC enrichment client used by Samsara sync. It is not a registered provider, has no credentials or routes, and should remain a utility until it needs an independently managed connection or job lifecycle.

## Ownership rules

- Put external transport, authentication handshakes, provider payload mapping, and provider orchestration in `integrations/<provider>/`.
- Keep application business rules in the owning module or service. Provider code should call those owners rather than duplicate workorder, asset, user, or location logic.
- Browser-managed setup and operations belong in `src/server/routes/integrations.routes.js` and require the normal app authorization policy.
- External service endpoints belong in a versioned provider route such as `<provider>/<provider>.routes.js`. Register the service path and machine authentication explicitly in `server.js` and `core/integration-auth.js`; never rely on the browser-session bypass in `auth/policy.js` as authentication.
- Every query and durable record must be company-scoped. A service request must take company identity from the authenticated integration client, not from a caller-supplied query or body field.
- Return sanitized status and errors. Never expose tokens, encrypted credential fields, OAuth state, raw provider payloads, or internal database errors.
- Use the registry for providers that have capabilities or background jobs. Import the adapter from each process that consumes the registry, including the worker.

## Adding a new integration

1. Create `integrations/<provider>/` with narrowly named files such as `<provider>.client.js`, `.mapper.js`, `.service.js`, `.schemas.js`, `.routes.js`, and `.adapter.js` as needed.
2. Reuse `core/` for credentials, machine clients, jobs, mappings, idempotency, audit, inbox, and outbox behavior. Add a new core primitive only when it is provider-neutral.
3. Choose the authentication boundary: browser session plus `integration:admin` for setup routes, or scoped machine Bearer tokens for external service routes. Keep the two boundaries separate.
4. Register browser routes in `src/server/routes/integrations.routes.js`; register service routes in `server.js` before same-origin enforcement. Register adapters wherever the provider registry or worker needs them.
5. Validate all request and provider payloads at the boundary. Normalize them into internal contracts before calling application owners.
6. If storage changes are required, add the next `NNN_snake_case.sql` file in `src/server/db/migrations/`. Applied migrations are checksum-verified and must never be edited.
7. Add adjacent unit tests for schemas, mapping, authentication/scopes, adapter registration, retries, tenant isolation, and secret redaction. Add a migration contract test for new durable primitives and an integration test for transactional workflows.
8. Document external endpoints in `docs/integrations/`, then run `npm run db:check` and `npm run verify`.

For the current Odoo contract, start with `docs/integrations/ODOO_INTEGRATION_API.md` and `docs/integrations/ODOO_INTEGRATION_TARGET.openapi.yaml`.
