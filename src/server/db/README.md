# PostgreSQL Ownership

PostgreSQL is the source of truth for users, access scope, locations, templates, assets, operational workorders, chat, parts, integrations, and authentication sessions.

## Table Owners

| Data | Repository or module |
| --- | --- |
| `assets` | `repositories/assets.repo.js` |
| `integration_accounts`, `integration_sync_runs` | `repositories/integrations.repo.js` |
| `locations` | `repositories/locations.repo.js` |
| `location_workorder_templates` | `repositories/templates.repo.js` |
| `user_invitations` | `repositories/invitations.repo.js` |
| `app_users` | `repositories/users.repo.js` |
| `auth_user` lookup/linking | `repositories/auth-users.repo.js` |
| Better Auth sessions, accounts, verification | `auth/` and Better Auth |
| Company and location memberships | `auth/` request context and authorization |
| Workorders, serial counters, status/assignment/field/access events | `repositories/operational-workorders.repo.js` |
| Attention state/events, read state, user workorder preferences | `repositories/workorder-attention.repo.js` |
| Chat messages and attachments | `repositories/chat.repo.js` |
| Catalog, inventory, requests, allocations, request events | `repositories/part-requests.repo.js` and `modules/parts/` |
| Odoo entry state | `modules/surveillance/` through the workorder repository |

Repositories are grouped by ownership, not by screen. Admin, office, and mechanic services compose the same repositories instead of maintaining role-specific copies of data.

## Schema Rules

- `migrations/001_initial_schema.sql` is the immutable baseline for an empty database.
- Every production change uses a new immutable `NNN_snake_case.sql` file under `migrations/`.
- Never edit an applied migration. The runner records and validates its SHA-256 checksum.
- Seed data is explicit under `seeds/`; run `npm run db:seed-demo-users` only in local/demo environments.
- Every company/location-scoped query receives scope from the authenticated request actor.
- Provider payloads may remain in `raw_provider_data`, while searchable/form-ready values use typed columns.
- Generated PDFs are output artifacts, not source-of-truth workorder records.
- `operational_workorders.status` is canonical lifecycle only: `open`, `accepted`, `in_progress`, `mechanic_done`, `closed`, or `odoo_entered`.
- Parts, office help, missing information, and overdue are attention reasons. Parts/missing/overdue may be derived from their owning records; persisted attention changes are audited in `workorder_attention_events`.
- `workorder_read_state` is per user and workorder. It must never be stored as a global boolean on the workorder.
- `workorder_access_events` is append-only. Explicit detail opens are recorded there; background polling must not create access events.

## Migration Runtime

`npm run db:migrate` takes a PostgreSQL advisory transaction lock, verifies applied migration checksums, and applies pending migrations in one transaction. Railway runs it as `preDeployCommand`, so multiple application replicas never race the schema update.

## Local Commands

```bash
npm run db:migrate
npm run db:create-admin
npm run db:seed-demo-users
npm run verify
```

`db:create-admin` is idempotent and uses Better Auth to create the credential. It links the login to the operational admin profile, company membership, and location membership. Do not insert password hashes with SQL.
