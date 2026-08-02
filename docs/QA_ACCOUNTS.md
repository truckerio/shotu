# Controlled QA Accounts

`scripts/qa/manage-qa-accounts.js` manages one deterministic login for each
application role: admin, office, mechanic, and surveillance. It is intended for
local and dedicated staging databases. It is not an application startup seed.

The command reuses Better Auth for credential creation and password hashing.
It links the identities to the existing operational profile, company membership,
and location membership tables. Passwords are accepted only through
`QA_ACCOUNT_PASSWORD` and are never included in command output.

## Required configuration

Set these values in the command environment without committing them:

```sh
export DATABASE_URL='postgresql://...'
export BETTER_AUTH_SECRET='at-least-32-characters'
export BETTER_AUTH_URL='http://localhost:4173'
export QA_TARGET_ENVIRONMENT='local' # local, staging, or production
export QA_COMPANY_SLUG='default'
export QA_LOCATION_NAME='Chino Yard'
export QA_ACCOUNT_NAMESPACE='qa'     # optional; defaults to qa
export QA_ACCOUNT_PASSWORD='use-a-secret-with-at-least-12-characters'
```

The deterministic default identities are `qa.admin`, `qa.office`,
`qa.mechanic`, and `qa.surveillance`, with corresponding `@qa.invalid` email
addresses. A namespace creates another isolated set, for example
`release_7.mechanic` (hyphens are converted to underscores for Better Auth
usernames while the email retains the original namespace).

## Commands

Inspect the target and intended identities without writing:

```sh
node --env-file-if-exists=.env scripts/qa/manage-qa-accounts.js plan --target=local
```

Create missing identities or reconcile existing role and location memberships.
Running `apply` repeatedly is safe. It does not change existing passwords:

```sh
node --env-file-if-exists=.env scripts/qa/manage-qa-accounts.js apply --target=local
```

Set the same current `QA_ACCOUNT_PASSWORD` on all four identities and revoke all
of their sessions:

```sh
node --env-file-if-exists=.env scripts/qa/manage-qa-accounts.js reset --target=local
```

Remove login access and deactivate memberships while preserving operational
profiles needed by historical workorders and audit events:

```sh
node --env-file-if-exists=.env scripts/qa/manage-qa-accounts.js cleanup --target=local
```

`apply`, `reset`, and `cleanup` stop on identity conflicts instead of taking
ownership of an email, username, profile, or multi-company user unexpectedly.

## Production lock

Production use is intentionally difficult and should normally be avoided. A
production runtime cannot be mislabeled as staging. Every production command,
including `plan`, requires all of the following:

1. `--target=production`
2. `--allow-production`
3. `--confirm-production=PROVISION_QA_ACCOUNTS_IN_PRODUCTION`
4. `QA_PRODUCTION_CONFIRMATION=I_ACCEPT_REAL_PRODUCTION_USER_WRITES`
5. `--confirm-database-host=<exact host parsed from DATABASE_URL>`

No command should be run against production during routine regression testing.
Use a Railway staging environment with an isolated PostgreSQL database instead.

## Verification

```sh
node --test scripts/qa/*.test.js
```

After provisioning staging, sign in once as every role, verify `/api/me`, and
run the role smoke test matrix. Use `reset` before a test cycle when credentials
must be known, then `cleanup` when the environment is no longer needed.
