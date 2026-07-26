# PostgreSQL Backup And Restore Verification

This procedure proves that a PostgreSQL backup can be restored and that the
restored database matches a consistent source snapshot. It is verification, not
a substitute for scheduled backups, encrypted retention, or an incident
recovery plan.

The tool is intentionally destructive only to a separately supplied disposable
restore database. It never creates or drops a database and never accepts a
database URL on the command line.

## Safety Contract

- `DATABASE_URL` is the read-only source of the backup.
- `RESTORE_DATABASE_URL` must point to a separate disposable database.
- `--confirm-disposable` is mandatory.
- The source and target are compared by URL identity and by PostgreSQL server,
  port, and current database before the target is touched.
- Credentials are passed to PostgreSQL tools through their process environment,
  not command arguments, and are redacted from errors.
- The source dump and verification counts share an exported PostgreSQL snapshot.
- The target `public` schema is erased before restore.
- By default, the target `public` schema is erased again after verification.
- `--keep-target` retains the restored target for manual inspection.
- Temporary dump archives are removed on success and failure.

Never set `RESTORE_DATABASE_URL` to production, a staging database containing
useful data, or any database that is not safe to erase.

## Prerequisites

Install PostgreSQL client tools compatible with the source server. Both
`pg_dump` and `pg_restore` are required.

On Apple Silicon Homebrew installations with versioned PostgreSQL:

```bash
export PG_BIN_DIR="$(brew --prefix postgresql@16)/bin"
```

The source and restore users require:

- source: connect and read access to all application schemas/tables;
- target: connect plus permission to drop and recreate the `public` schema.

Create the disposable database separately. The tool deliberately does not
create it because database creation usually needs broader server privileges.

```bash
createdb --host localhost --port 5433 --username postgres workorder_restore_check
```

Store its URL outside shell history:

```bash
read -s "RESTORE_DATABASE_URL?Disposable restore database URL: "
export RESTORE_DATABASE_URL
echo
```

## Non-Destructive Preflight

The dry run connects to both databases and checks binaries and database
identity. It does not dump, restore, or erase data.

```bash
RESTORE_DATABASE_URL="$RESTORE_DATABASE_URL" \
node --env-file=.env scripts/database/backup-restore.js \
  --confirm-disposable \
  --dry-run
```

Expected result:

```text
Configuration valid: source and disposable target are separate databases.
Dry run passed. Found <repository migration count> repository migrations; no data was changed.
```

## Full Verification

```bash
RESTORE_DATABASE_URL="$RESTORE_DATABASE_URL" \
node --env-file=.env scripts/database/backup-restore.js \
  --confirm-disposable
```

The verification fails unless:

1. the source and target contain the exact repository migration names and
   SHA-256 checksums;
2. key tenant, identity, asset, workorder, assignment, parts, chat, and draft
   table row counts match the dump snapshot;
3. all final support views exist and their row counts match:
   `v_user_access_scope`, `v_user_primary_role`,
   `v_workorder_assignment_roster`, `v_workorder_operations`,
   `v_inventory_availability`, and `v_odoo_backlog`.

The final line confirms that the disposable target was cleaned.

## Keep The Restored Target

Use this only when an engineer needs to inspect the restored data:

```bash
RESTORE_DATABASE_URL="$RESTORE_DATABASE_URL" \
node --env-file=.env scripts/database/backup-restore.js \
  --confirm-disposable \
  --keep-target
```

The operator is responsible for dropping or cleaning the target afterward:

```bash
dropdb --host localhost --port 5433 --username postgres workorder_restore_check
```

## Custom Environment Names

For secret managers that use different variable names:

```bash
node scripts/database/backup-restore.js \
  --source-env BACKUP_SOURCE_DATABASE_URL \
  --target-env BACKUP_RESTORE_DATABASE_URL \
  --confirm-disposable
```

Only environment variable names are accepted. Raw URLs are rejected as command
arguments to reduce shell-history and process-list exposure.

## Unit Tests

These tests do not connect to PostgreSQL and do not change data:

```bash
node --test scripts/database/backup-restore.test.js
```

They cover CLI safety, URL normalization, same-database rejection, credential
redaction, and manifest mismatch detection.

## Operational Frequency

- Run after material schema changes and before a high-risk release.
- Run at least monthly against the current production backup source using an
  isolated restore database.
- Record timestamp, source environment, backup duration, restore duration,
  verification result, and operator. Never record database URLs or credentials.
- Alert if scheduled backups exist but a restore has not been verified within
  the expected interval.

## Failure Handling

If verification fails:

1. do not treat the backup as recoverable;
2. retain the target only when investigation is required, using
   `--keep-target`;
3. inspect the credential-redacted error and PostgreSQL server logs;
4. correct client-version, permission, migration-parity, or storage issues;
5. repeat the full verification;
6. escalate if the latest backup cannot be restored.
