# Workorder Generator

Multi-user workorder application for office, mechanic, surveillance, and admin workflows, with Samsara asset lookup and a physical batch-print generator.

PostgreSQL is the operational source of truth. Better Auth owns credentials and sessions; application tables own roles, company/location scope, workorders, and audit history.

## Structure

```text
frontend/       React/Vite UI, split into app/components/features/lib
shared/         Shared workorder HTML/PDF template renderer
src/server/     Auth, API routes, domain modules, Postgres, Samsara, VIN decode
server.js       HTTP server plus legacy print/workorder routes
templates/      Workorder background assets
```

See `docs/ARCHITECTURE.md` and `src/server/db/README.md` before adding new tables or route families.

## Run

```bash
npm install
npm run db:migrate
npm run db:create-admin
npm run db:seed-demo-users
npm run build
npm start
```

Open:

```text
http://localhost:4173
```

## Environment

Samsara vehicle lookup uses Postgres as the base store. The app syncs vehicles from Samsara into Postgres, then mechanics search the local database while filling the workorder.

```text
DATABASE_URL=postgres://user:password@localhost:5432/workorders
BETTER_AUTH_SECRET=generate_at_least_32_random_characters
BETTER_AUTH_URL=http://localhost:4173
AUTH_TRUSTED_ORIGINS=http://localhost:4173
AUTH_IP_ADDRESS_HEADERS=x-real-ip
SAMSARA_API_TOKEN=your_samsara_token
SAMSARA_API_BASE_URL=https://api.samsara.com
SAMSARA_OAUTH_CLIENT_ID=your_samsara_oauth_app_id
SAMSARA_OAUTH_CLIENT_SECRET=your_samsara_oauth_app_secret
SAMSARA_OAUTH_REDIRECT_URI=https://junior01.up.railway.app/api/integrations/samsara/oauth/callback
SAMSARA_SYNC_INTERVAL_MINUTES=30
SAMSARA_SYNC_ON_STARTUP=true
NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_API_KEY=
NEXT_PUBLIC_HERE_API_KEY=
```

OAuth is preferred for Samsara. In the Samsara dashboard, create an OAuth 2.0 app and set the redirect URL to:

```text
https://junior01.up.railway.app/api/integrations/samsara/oauth/callback
```

The browser never receives the OAuth client secret, access token, refresh token, or fallback API token.

## Authentication

Better Auth owns credentials and database-backed sessions. `user_profiles` owns operational contact identity; company and location memberships own role and access.

- Public signup is disabled.
- Mechanics sign in with a username and password.
- Office, surveillance, and admin users may use username or email.
- The server resolves the request actor from the session. Browser payloads must never choose a user or role.
- Production requires `BETTER_AUTH_SECRET`, an HTTPS `BETTER_AUTH_URL`, and matching `AUTH_TRUSTED_ORIGINS`. Railway deployments use its trusted `x-real-ip` header by default; override `AUTH_IP_ADDRESS_HEADERS` only when the deployment proxy supplies a different trusted client-IP header.
- Railway runs `npm run db:migrate` as a pre-deploy command before the application starts.

Create the first production administrator with environment variables instead of
editing auth tables:

```text
ADMIN_EMAIL=owner@example.com
ADMIN_USERNAME=owner
ADMIN_NAME=Operations Owner
ADMIN_PASSWORD=use-a-strong-unique-password
COMPANY_NAME=Pro Tec Repair
COMPANY_SLUG=pro-tec-repair
LOCATION_NAME=Chino Yard
```

Run `npm run db:create-admin` once, verify login, and then remove
`ADMIN_PASSWORD` from the service variables. The command is idempotent and
delegates password hashing to Better Auth.

After OAuth is connected, Samsara sync runs automatically when the server starts, immediately after login, and then every `SAMSARA_SYNC_INTERVAL_MINUTES`. The UI keeps a manual `Sync now` button only for troubleshooting.

## Checks

```bash
npm run verify
```

`verify` checks architectural boundaries, runs the unit suites, validates server syntax, and builds the frontend.

## Samsara Flow

1. Office/admin clicks `Sync Samsara` in the Vehicle section.
2. Backend fetches trucks and trailers from Samsara and stores normalized asset records in Postgres.
3. Mechanic types a unit, truck name, VIN, or plate.
4. App searches Postgres and shows matching assets.
5. Selecting an asset fills unit, type, company/owner, license, mileage, model, VIN, and location when Samsara has it.

The API route remains `/api/vehicles/*` because that is the UI language, but the table is `assets` because it stores trucks and trailers.

## Flow

1. Enter company name, serial prefix, next serial number, digits, and count.
2. Click `Find` and choose a system printer, or leave `Save PDF only`.
3. Click `Generate & Print`.
4. The preview shows the first and last page when printing multiple copies.

The legacy physical batch-print workflow allocates serials before printing and writes them to:

```text
data/serial-ledger.json
```

Generated PDFs are saved under:

```text
printed-workorders/
```

The printed PDF uses `templates/workorder-template.jpg`, generated from the original workorder PDF, as the page background. The app overlays only the serial number in the original `Invoice No:` area.

Uploaded written workorders are saved under:

```text
uploaded-workorders/
```

Share packages are saved under:

```text
share-packages/
```

## Duplicate Rule

Serials are unique per company. If a user tries to set a company's next number lower than already issued numbers, the backend ignores the lower number and continues from the real next available serial.

If printing fails after serial allocation, those serials stay consumed. That avoids duplicates, which is more important for tracking than filling every number.

## Share Log

The app prepares a folder containing uploaded workorders plus `manifest.csv` and `manifest.json`. It opens an email draft with the package path and logs:

- recipient
- created/uploaded date range
- serial numbers included
- prepared email time
- package path

Real automatic email sending needs SMTP, Gmail, or Microsoft credentials. Without that, the app logs the share as `prepared`.

## Printer Support

- macOS/Linux: discovers printers with `lpstat` and prints with `lp`.
- Windows: discovers printers with PowerShell `Get-Printer` and attempts `PrintTo`.

Windows silent PDF printing depends on the installed PDF viewer. If Windows printing is unreliable, install a PDF viewer that supports command-line printing, then wire that command into `server.js`.
