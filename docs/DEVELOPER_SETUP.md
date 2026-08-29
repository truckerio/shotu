# Developer Setup

Use this guide after receiving the source archive. It describes how to start a
local instance and how each integration is configured. Never commit `.env` or
paste its values into tickets, chat, pull requests, screenshots, or logs.

## What The Handoff Contains

- Source, migrations, documentation, and current uncommitted work are in the
  developer handoff archive.
- `.env.example` is the non-secret configuration template.
- A separately named handoff archive may include the current `.env`. Treat it
  as sensitive: it is a starting point, not evidence that every provider is
  configured or production-safe.
- `node_modules`, Git history, generated files, uploads, and database data are
  intentionally not transferred. Install dependencies and create or restore a
  database locally.

## Prerequisites

- Node.js 22 or later.
- PostgreSQL reachable through `DATABASE_URL`.
- Docker Desktop only when using local invoice OCR.
- Access to the team secret manager for missing credentials. Do not invent
  production values or copy credentials between environments.

## First Local Start

From the repository root:

```bash
cp .env.example .env
# Set DATABASE_URL and any required local/provider configuration in .env.
npm run setup:local
npm run db:migrate:local
ADMIN_EMAIL=owner@example.com \
ADMIN_USERNAME=owner \
ADMIN_NAME="Operations Owner" \
ADMIN_PASSWORD="use-a-strong-unique-password" \
COMPANY_NAME="Example Company" \
COMPANY_SLUG=example-company \
LOCATION_NAME="Example Shop" \
npm run db:create-admin
npm run start:local
```

After the first setup, normal local startup is only:

```bash
npm run start:local
```

`start:local` first verifies `DATABASE_URL`. When that URL targets a stopped
loopback PostgreSQL instance, it starts the existing Homebrew PostgreSQL 16
data directory on the configured port, waits for an authenticated database
connection, and then starts the app. It never initializes or replaces database
data. For another local PostgreSQL installation, set both
`LOCAL_POSTGRES_PG_CTL` and `LOCAL_POSTGRES_DATA_DIR`; remote databases must
already be reachable.

`npm run setup:local` performs a clean lockfile install and builds the current
frontend. It never creates or overwrites `.env`. Run it again after dependency
or lockfile changes; use `npm run build` after frontend-only changes. Database
migration remains a separate command so dependency setup cannot modify
whichever database is configured in `.env`.

Open `http://localhost:4173`. Confirm process and database readiness in a
second terminal:

```bash
curl --fail http://localhost:4173/health/live
curl --fail http://localhost:4173/health/ready
```

`npm run db:create-admin` is idempotent. The npm `start` and `db:migrate`
scripts expect environment variables to be injected by their runtime (as
Railway does); use `start:local` and `db:migrate:local` when running with a
local `.env` file. Remove `ADMIN_PASSWORD` after the
bootstrap succeeds. Use `npm run db:seed-demo-users` only for disposable local
data; never run it against shared or production data.

## Configuration Matrix

| Area | Required for | Variables / setup | Notes |
|---|---|---|---|
| Database | Every real app run | `DATABASE_URL`, optional `DB_POOL_MAX` | PostgreSQL is application truth. Run migrations before starting app work. |
| Authentication | Production | `BETTER_AUTH_SECRET` (32+ chars), HTTPS `BETTER_AUTH_URL`, matching `AUTH_TRUSTED_ORIGINS`, optional trusted proxy header | Local development has a development-only fallback secret, but it is not valid for production. |
| Persistent files | Production uploads, chat media, PDFs | `WORKORDER_STORAGE_DIR` on mounted persistent storage | Process-local storage disappears during replacement/redeploy. |
| Email | Invitations and password recovery | `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM_NAME`, `MAIL_FROM_EMAIL` | Sender must be accepted by the SMTP provider. |
| Samsara | Asset sync/search | Prefer OAuth variables below; temporary fallback: `SAMSARA_API_TOKEN`, `SAMSARA_API_BASE_URL` | Browser search reads PostgreSQL cache; it does not call Samsara per keystroke. |
| Provider credential encryption | Samsara OAuth and Admin-managed provider credentials | `INTEGRATION_ENCRYPTION_KEY` (32 bytes, base64 or 64 hex chars), `INTEGRATION_ENCRYPTION_KEY_VERSION` | Required before credentials can be stored. Rotation changes version only through a planned key-rotation procedure. |
| Odoo | Odoo master-data sync, history, and draft service orders | Configure Odoo URL, database, integration-user login, and API key in **Admin → Settings → Integrations → Odoo.sh** | Odoo is optional compatibility/integration software for local-inventory workflows. App production does not imply Odoo production. |
| Invoice extraction | Invoice review and durable background extraction | Optional explicit remote policy plus `INVOICE_EXTRACTION_OPENAI_API_KEY`; optional `INVOICE_OCR_*`; `INVOICE_DOCUMENT_ENCRYPTION_KEY`, version/keyring, retention; optional global-layout HMAC version/keyring and worker settings | Document encryption is required in production before upload. Remote processing and global contribution default off. |
| Local inventory security | Encrypted opening-count workbooks, labels, and exact-unit scan/issue/install/return | `INVENTORY_COUNT_FILE_ENCRYPTION_KEY`, version, historical keyring, retention; `INVENTORY_QR_SIGNING_KEY` | Workbook key may fall back to current invoice-document key. QR key is required before serialized identities are created. |
| Maps | Map cards | `NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_API_KEY` and/or `NEXT_PUBLIC_HERE_API_KEY` | Browser keys must be restricted to approved origins. |
| Proofreading | Optional narrative checking | `WPROOFREADER_SERVICE_ID` and optional explicit deep/context settings | Keep disabled until provider, privacy, and release gates are satisfied. |

## Samsara

OAuth is the normal setup. In the Samsara developer dashboard, create an OAuth
app and register this exact callback URL for the target environment:

```text
https://<app-host>/api/integrations/samsara/oauth/callback
```

Set these server-only variables:

```text
SAMSARA_OAUTH_CLIENT_ID=
SAMSARA_OAUTH_CLIENT_SECRET=
SAMSARA_OAUTH_REDIRECT_URI=https://<app-host>/api/integrations/samsara/oauth/callback
INTEGRATION_ENCRYPTION_KEY=
INTEGRATION_ENCRYPTION_KEY_VERSION=v1
```

Then sign in as an Admin and connect Samsara through **Settings →
Integrations**. The server encrypts stored OAuth credentials; do not place an
OAuth refresh token in browser code. `SAMSARA_API_TOKEN` is a limited fallback
for the initial default company, not a replacement for company-scoped OAuth.

## Odoo

The developer needs an Odoo account with the permissions described in the
[Odoo integration guide](integrations/ODOO_INTEGRATION_API.md), plus the exact
URL, database name, login, and API key for the intended environment. Configure
those values through the Admin Odoo.sh integration card, not by hardcoding them
in `.env` or source.

After connection:

1. Test the connection from **Admin → Settings → Integrations**.
2. Refresh Odoo internal locations and explicitly map each one to an active app
   location; leave unrelated locations ignored or unmatched.
3. Refresh parts/inventory and service history as needed.
4. Configure outbound vehicle, warehouse, and labor-product mappings before
   attempting a draft service order.
5. Use an approved Odoo staging database for first end-to-end validation.

Draft service-order creation is explicit and draft-only. It must not confirm an
order, invoice, collect payment, create purchase orders, or move stock. See
[the outbound service-order specification](ODOO_OUTBOUND_SERVICE_ORDER_SPEC.md)
and [the integrations index](integrations/README.md).

## Invoice Extraction And Receipts

Invoice source files are encrypted. In production, set a unique
`INVOICE_DOCUMENT_ENCRYPTION_KEY` and key version before enabling upload; set a
retention period with `INVOICE_DOCUMENT_RETENTION_DAYS`. The optional local OCR
service starts with:

```bash
npm run invoice-ocr:up
```

Use `INVOICE_OCR_BASE_URL`, `INVOICE_OCR_TOKEN`, and timeout/concurrency values
only when that service is intentionally available. Remote invoice transmission
is disabled by default and does not inherit the shared `OPENAI_API_KEY`. To opt
in, set `INVOICE_EXTRACTION_REMOTE_ENABLED=true` and provide a dedicated,
server-only `INVOICE_EXTRACTION_OPENAI_API_KEY`; enabling the policy without
that key fails the run instead of silently using a local-only path. The default approved endpoint
is `https://api.openai.com/v1`; a different endpoint must still use HTTPS and
also requires `INVOICE_EXTRACTION_ALLOW_CUSTOM_OPENAI_BASE_URL=true`. Provider
redirects are rejected, response bodies are bounded by
`INVOICE_EXTRACTION_MAX_PROVIDER_RESPONSE_BYTES`, and provider storage remains
disabled. Extraction and review do not move inventory.

Cross-company layout learning is separately default-off. Configure a dedicated
`INVOICE_GLOBAL_LAYOUT_HMAC_KEY_VERSION` and JSON version-to-key map in
`INVOICE_GLOBAL_LAYOUT_HMAC_KEYS`; each key must contain at least 32 bytes of
secret material. A company admin must then enable the policy through
`/api/admin/companies/:companyId/invoice-global-learning`, and a reviewer must
separately approve structural contribution on the reviewed document. Global
artifacts contain only a code-reviewed fixed geometry grammar and HMACs of an
allowlisted generic label vocabulary; unsupported geometry stays tenant-local
until a new grammar is reviewed and released in code. Policy withdrawal synchronously
quarantines affected artifacts and queues deterministic rebuilds; the server
runs that rebuild worker automatically. Never use document-encryption keys as
layout-HMAC keys.

A reviewed invoice can later start a separate, explicit local receipt. The
operator must attest that the full delivery was received undamaged; only then
does the server atomically post the receipt, append stock movements, update
local location balances, create exact units for discrete quantities, and create
a durable label batch. Odoo is not required. Mismatch, partial, or damaged
deliveries stop without posting; those workflows are not implemented. The
Inventory workspace also accepts a bounded opening-count spreadsheet: review
and resolve rows first, then physically attest before applying eligible exact
matches. It is not a general cycle-count feature. Both workflows require
`INVENTORY_QR_SIGNING_KEY` when they create serialized units. Read the
[inventory living record](INVENTORY_ODOO_LIVING_RECORD.md) before changing or
operating this workflow.

Opening-count workbooks use `INVENTORY_COUNT_FILE_ENCRYPTION_KEY` and its version
when configured; otherwise they use current invoice-document key and version.
During rotation, retain old version-to-key mappings in
`INVENTORY_COUNT_FILE_ENCRYPTION_KEYS` or `INVOICE_DOCUMENT_ENCRYPTION_KEYS` as a
JSON object until all evidence encrypted with those versions expires. Never
remove historical key material while retained rows still reference its version.
Invoice source decryption selects the key by the row's stored `key_version` and
fails closed when that version is missing or the authenticated ciphertext does
not verify.

The app starts the invoice-extraction worker with the server. Defaults are two
concurrent lanes, two attempts per job, and a 1-second poll. Tune only with
`INVOICE_EXTRACTION_WORKER_CONCURRENCY` (1–4),
`INVOICE_EXTRACTION_WORKER_MAX_ATTEMPTS` (1–5), and
`INVOICE_EXTRACTION_WORKER_POLL_MS` (minimum 500). Jobs remain durable in the
integration job tables; changing a process setting does not repair a failed
provider configuration.

## Validation

Before opening a pull request:

```bash
npm run verify
node --env-file=.env scripts/check-database.js
git diff --check
```

Run provider and role workflows only against disposable local or approved
staging data. `npm run test:role-workflow` creates application workorders and
must not run against production. The complete release procedure is in
[operations/production-gate.md](operations/production-gate.md).

## Troubleshooting Order

1. Confirm `.env` contains the required variables for the feature being used;
   do not print them.
2. Confirm `node --env-file=.env src/server/db/migrate.js` and
   `/health/ready` succeed.
3. Verify Admin provider status in **Settings → Integrations**.
4. Check sanitized server logs and integration status; never add temporary
   logging that prints passwords, tokens, invoice sources, or provider bodies.
5. Recheck the provider target. Workorder and Odoo environments are separate.

## Canonical References

- [README](../README.md): repository commands and application overview.
- [Architecture](ARCHITECTURE.md): ownership and request boundaries.
- [Database architecture](DATABASE.md): schema and migration rules.
- [Integration index](integrations/README.md): Odoo and provider contracts.
- [QA accounts](QA_ACCOUNTS.md): safe role-workflow setup.
- [Production gate](operations/production-gate.md): deploy checklist.
