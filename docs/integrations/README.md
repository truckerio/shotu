# Integrations

This folder is the entry point for developers connecting external systems to
Workorder Generator. It contains the contracts that external services may rely
on. Internal browser routes and implementation details are documented
separately in the source tree.

## Start here

| Need | Read |
| --- | --- |
| Implement an Odoo connector | [Odoo Integration API](./ODOO_INTEGRATION_API.md) |
| Generate a client or validate requests | [Odoo OpenAPI 3.1 contract](./ODOO_INTEGRATION_TARGET.openapi.yaml) |
| Share a formatted handoff with an Odoo developer | [Odoo Integration API Guide](./Odoo%20Integration%20API%20Guide.docx) |
| Understand backend ownership or add a provider | [Backend integration guide](../../src/server/integrations/README.md) |
| Understand repository-wide boundaries | [Architecture](../ARCHITECTURE.md) |

## Integration surfaces

There are two deliberately separate integration surfaces:

- **Machine-to-machine APIs** use company-scoped bearer tokens. Odoo uses the
  versioned `/api/integrations/odoo/v1` service API.
- **Admin integration management** uses an authenticated human session and the
  Admin **Settings > Integrations** page. It owns provider connection state and
  machine-client issuance or revocation.

Do not build an external connector against browser cookies, Admin routes, or
`/api/surveillance/*`. Those are first-party user-interface contracts and may
change with the application.

## Current integrations

| Integration | Direction | Primary purpose | Contract status |
| --- | --- | --- | --- |
| Odoo | Bidirectional | Create or reconcile service orders; import parts master and mapped-location inventory | External service API plus Admin-managed Odoo.sh adapter |
| Samsara | Inbound assets | Synchronize trucks and trailers into PostgreSQL for local search | Admin-managed provider integration |
| NHTSA vPIC | On-demand lookup | Decode VIN data | Internal provider adapter |

## Adding another integration

1. Decide whether the integration needs a public machine API, an outbound
   provider adapter, or both.
2. Reuse authentication, encrypted credentials, jobs, audit, outbox, and
   idempotency infrastructure from `src/server/integrations/core/`.
3. Put provider-specific code in `src/server/integrations/<provider>/`; do not
   add provider rules to the shared core.
4. Keep browser administration under
   `frontend/src/features/admin/integrations/` and capability-check every
   company-scoped action on the server.
5. Add a versioned external contract under this folder before asking another
   team to integrate with it.
6. Cover tenant isolation, secret redaction, retries, idempotency, revocation,
   failure recovery, and migration health in tests.
7. Update this index, the backend integration guide, and
   `docs/ARCHITECTURE.md` in the same change.

## Contract ownership

The Markdown guide explains behavior for people. The OpenAPI file is the
machine-readable request and response contract. When behavior changes, update
the implementation, tests, Markdown, OpenAPI, and formatted handoff together.
Never document an internal route as supported merely because it currently
exists.

## Odoo.sh location ownership

Odoo stock-location names are not treated as application identity. An Admin
connects Odoo.sh in **Settings > Integrations**, refreshes Odoo internal
locations, and explicitly maps each immutable Odoo location ID to an active app
location. New Odoo locations remain **Unmatched** until reviewed; irrelevant
locations can be marked **Ignored**. Parts master data may be refreshed
company-wide, but location inventory is imported only for confirmed mappings.

The Admin connection and mapping routes are first-party browser contracts and
are intentionally excluded from the external Odoo OpenAPI document. The
versioned `/api/integrations/odoo/v1` API remains the supported contract for an
external Odoo connector that reads completed workorders and writes results.
