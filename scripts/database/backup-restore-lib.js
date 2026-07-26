import { access, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import pg from "pg";

export const DEFAULT_SOURCE_ENV = "DATABASE_URL";
export const DEFAULT_TARGET_ENV = "RESTORE_DATABASE_URL";

export const KEY_TABLES = Object.freeze([
  "companies",
  "locations",
  "user_profiles",
  "user_company_memberships",
  "user_location_memberships",
  "assets",
  "operational_workorders",
  "workorder_mechanic_assignments",
  "workorder_part_requests",
  "chat_messages",
  "workorder_drafts",
]);

export const SUPPORT_VIEWS = Object.freeze([
  "v_user_access_scope",
  "v_user_primary_role",
  "v_workorder_assignment_roster",
  "v_workorder_operations",
  "v_inventory_availability",
  "v_odoo_backlog",
]);

const HELP = `Usage:
  RESTORE_DATABASE_URL=... node --env-file=.env scripts/database/backup-restore.js --confirm-disposable [options]

Options:
  --confirm-disposable  Required acknowledgement that the target may be erased.
  --keep-target         Keep the restored target database after verification.
  --dry-run             Check configuration, binaries, and database identities only.
  --source-env NAME     Source URL environment variable (default: DATABASE_URL).
  --target-env NAME     Target URL environment variable (default: RESTORE_DATABASE_URL).
  --pg-bin-dir PATH     Directory containing pg_dump and pg_restore.
  --help                Show this help.

Raw database URLs are intentionally not accepted as CLI arguments.`;

export function parseArgs(argv) {
  const options = {
    confirmDisposable: false,
    keepTarget: false,
    dryRun: false,
    sourceEnv: DEFAULT_SOURCE_ENV,
    targetEnv: DEFAULT_TARGET_ENV,
    pgBinDir: process.env.PG_BIN_DIR || "",
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--confirm-disposable") options.confirmDisposable = true;
    else if (argument === "--keep-target") options.keepTarget = true;
    else if (argument === "--dry-run") options.dryRun = true;
    else if (argument === "--help" || argument === "-h") options.help = true;
    else if (argument === "--source-env") options.sourceEnv = requiredValue(argv, ++index, argument);
    else if (argument === "--target-env") options.targetEnv = requiredValue(argv, ++index, argument);
    else if (argument === "--pg-bin-dir") options.pgBinDir = requiredValue(argv, ++index, argument);
    else throw new Error(`Unknown option: ${argument}`);
  }

  validateEnvName(options.sourceEnv, "--source-env");
  validateEnvName(options.targetEnv, "--target-env");
  return options;
}

function requiredValue(argv, index, option) {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`${option} requires a value.`);
  return value;
}

function validateEnvName(value, option) {
  if (!/^[A-Z_][A-Z0-9_]*$/i.test(value)) {
    throw new Error(`${option} must be an environment variable name.`);
  }
}

export function helpText() {
  return HELP;
}

export function normalizePostgresUrl(rawUrl, label = "Database") {
  if (!rawUrl) throw new Error(`${label} URL is missing.`);
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`${label} URL is invalid.`);
  }
  if (!["postgres:", "postgresql:", "postgresql+asyncpg:"].includes(parsed.protocol)) {
    throw new Error(`${label} URL must use PostgreSQL.`);
  }
  if (!parsed.pathname || parsed.pathname === "/") {
    throw new Error(`${label} URL must name a database.`);
  }
  if (parsed.protocol === "postgresql+asyncpg:") parsed.protocol = "postgresql:";
  return parsed.toString();
}

export function connectionFingerprint(rawUrl) {
  const parsed = new URL(normalizePostgresUrl(rawUrl));
  return [
    parsed.hostname.toLowerCase(),
    parsed.port || "5432",
    decodeURIComponent(parsed.pathname.slice(1)),
  ].join("|");
}

export function assertSeparateUrls(sourceUrl, targetUrl) {
  if (connectionFingerprint(sourceUrl) === connectionFingerprint(targetUrl)) {
    throw new Error("Source and restore target resolve to the same URL identity.");
  }
}

export function assertSeparateDatabaseIdentities(source, target) {
  const sourceAddress = source.serverAddress || source.serverHost;
  const targetAddress = target.serverAddress || target.serverHost;
  if (
    source.database === target.database
    && source.port === target.port
    && sourceAddress === targetAddress
  ) {
    throw new Error("Source and restore target are the same PostgreSQL database.");
  }
}

export function libpqEnvironment(rawUrl, baseEnvironment = process.env) {
  const parsed = new URL(normalizePostgresUrl(rawUrl));
  const environment = {
    ...baseEnvironment,
    PGHOST: decodeURIComponent(parsed.hostname),
    PGPORT: parsed.port || "5432",
    PGDATABASE: decodeURIComponent(parsed.pathname.slice(1)),
    PGUSER: decodeURIComponent(parsed.username),
    PGPASSWORD: decodeURIComponent(parsed.password),
    PGCONNECT_TIMEOUT: "10",
  };

  const sslMode = parsed.searchParams.get("sslmode");
  const sslRootCert = parsed.searchParams.get("sslrootcert");
  const sslCert = parsed.searchParams.get("sslcert");
  const sslKey = parsed.searchParams.get("sslkey");
  if (sslMode) environment.PGSSLMODE = sslMode;
  if (sslRootCert) environment.PGSSLROOTCERT = sslRootCert;
  if (sslCert) environment.PGSSLCERT = sslCert;
  if (sslKey) environment.PGSSLKEY = sslKey;
  return environment;
}

export function redactSensitiveText(value, secrets = []) {
  let redacted = String(value ?? "");
  for (const secret of secrets.filter(Boolean)) {
    redacted = redacted.split(secret).join("[REDACTED]");
    try {
      redacted = redacted.split(decodeURIComponent(secret)).join("[REDACTED]");
    } catch {
      // The value may not be URI encoded.
    }
  }
  redacted = redacted.replace(
    /(?:postgres(?:ql)?(?:\+asyncpg)?:\/\/)([^@\s]+)@/gi,
    "postgresql://[REDACTED]@",
  );
  redacted = redacted.replace(/\b(password|pass|pwd)=([^\s]+)/gi, "$1=[REDACTED]");
  return redacted;
}

export async function resolvePgBinaries(pgBinDir = "") {
  const dumpCandidates = binaryCandidates("pg_dump", pgBinDir);
  const restoreCandidates = binaryCandidates("pg_restore", pgBinDir);
  return {
    pgDump: await firstExecutable(dumpCandidates, "pg_dump"),
    pgRestore: await firstExecutable(restoreCandidates, "pg_restore"),
  };
}

function binaryCandidates(name, pgBinDir) {
  const candidates = [];
  if (pgBinDir) candidates.push(join(pgBinDir, name));
  candidates.push(name);
  return candidates;
}

async function firstExecutable(candidates, displayName) {
  for (const candidate of candidates) {
    if (!candidate.includes("/")) return candidate;
    try {
      await access(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // Continue to the next candidate.
    }
  }
  throw new Error(`${displayName} was not found. Set PG_BIN_DIR or add PostgreSQL client tools to PATH.`);
}

export function runCommand(command, args, { env, secrets = [] } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      reject(new Error(`${basename(command)} could not start: ${redactSensitiveText(error.message, secrets)}`));
    });
    child.on("close", (code, signal) => {
      if (code === 0) return resolve();
      const detail = redactSensitiveText(stderr.trim(), secrets);
      reject(new Error(
        `${basename(command)} failed${signal ? ` (${signal})` : ` (exit ${code})`}${detail ? `: ${detail}` : "."}`,
      ));
    });
  });
}

export async function repositoryMigrations(migrationsDirectory) {
  const directoryPath = migrationsDirectory instanceof URL
    ? fileURLToPath(migrationsDirectory)
    : migrationsDirectory;
  const names = (await readdir(directoryPath))
    .filter((name) => /^\d{3}_[a-z0-9_]+\.sql$/.test(name))
    .sort();
  return Promise.all(names.map(async (name) => ({
    name,
    checksum: createHash("sha256")
      .update(await readFile(join(directoryPath, name)))
      .digest("hex"),
  })));
}

export async function databaseIdentity(client, rawUrl) {
  const parsed = new URL(normalizePostgresUrl(rawUrl));
  const result = await client.query(`
    select
      current_database() as database,
      coalesce(inet_server_addr()::text, '') as server_address,
      inet_server_port()::int as port
  `);
  return {
    database: result.rows[0].database,
    serverAddress: result.rows[0].server_address,
    serverHost: parsed.hostname.toLowerCase(),
    port: result.rows[0].port,
  };
}

export async function collectManifest(client) {
  const migrations = await client.query(
    "select name, checksum from schema_migrations order by name",
  );
  const tableCounts = {};
  for (const table of KEY_TABLES) {
    tableCounts[table] = await relationCount(client, table);
  }
  const viewCounts = {};
  for (const view of SUPPORT_VIEWS) {
    viewCounts[view] = await relationCount(client, view);
  }
  return {
    migrations: migrations.rows,
    tableCounts,
    viewCounts,
  };
}

async function relationCount(client, relation) {
  if (![...KEY_TABLES, ...SUPPORT_VIEWS].includes(relation)) {
    throw new Error(`Unsupported verification relation: ${relation}`);
  }
  const result = await client.query(`select count(*)::int as count from "${relation}"`);
  return Number(result.rows[0].count);
}

export function verifyManifest({ source, restored, repository }) {
  const failures = [];
  const expectedMigrationMap = new Map(repository.map((entry) => [entry.name, entry.checksum]));
  const sourceMigrationMap = new Map(source.migrations.map((entry) => [entry.name, entry.checksum]));
  const restoredMigrationMap = new Map(restored.migrations.map((entry) => [entry.name, entry.checksum]));

  compareMigrationMap("source", sourceMigrationMap, expectedMigrationMap, failures);
  compareMigrationMap("restored target", restoredMigrationMap, expectedMigrationMap, failures);
  compareCounts("table", source.tableCounts, restored.tableCounts, failures);
  compareCounts("support view", source.viewCounts, restored.viewCounts, failures);

  return {
    healthy: failures.length === 0,
    failures,
    migrations: {
      expected: repository.length,
      source: source.migrations.length,
      restored: restored.migrations.length,
    },
    tableCounts: restored.tableCounts,
    supportViewCounts: restored.viewCounts,
  };
}

function compareMigrationMap(label, actual, expected, failures) {
  if (actual.size !== expected.size) {
    failures.push(`${label} migration count ${actual.size} does not match repository ${expected.size}`);
  }
  for (const [name, checksum] of expected) {
    if (!actual.has(name)) failures.push(`${label} is missing migration ${name}`);
    else if (actual.get(name) !== checksum) failures.push(`${label} migration checksum differs for ${name}`);
  }
  for (const name of actual.keys()) {
    if (!expected.has(name)) failures.push(`${label} has unknown migration ${name}`);
  }
}

function compareCounts(label, sourceCounts, restoredCounts, failures) {
  for (const [name, count] of Object.entries(sourceCounts)) {
    if (!(name in restoredCounts)) failures.push(`restored ${label} ${name} is missing`);
    else if (restoredCounts[name] !== count) {
      failures.push(`restored ${label} ${name} count ${restoredCounts[name]} does not match source snapshot ${count}`);
    }
  }
}

export async function resetPublicSchema(client) {
  await client.query("begin");
  try {
    await client.query("drop schema if exists public cascade");
    await client.query("create schema public");
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

export async function runBackupRestoreVerification({
  sourceUrl,
  targetUrl,
  options,
  migrationsDirectory,
  logger = console,
}) {
  if (!options.confirmDisposable) {
    throw new Error("--confirm-disposable is required because the restore target public schema will be erased.");
  }
  assertSeparateUrls(sourceUrl, targetUrl);

  const binaries = await resolvePgBinaries(options.pgBinDir);
  await Promise.all([
    runCommand(binaries.pgDump, ["--version"]),
    runCommand(binaries.pgRestore, ["--version"]),
  ]);
  const sourceClient = new pg.Client({ connectionString: normalizePostgresUrl(sourceUrl) });
  const targetClient = new pg.Client({ connectionString: normalizePostgresUrl(targetUrl) });
  const repository = await repositoryMigrations(migrationsDirectory);
  const secrets = [sourceUrl, targetUrl, new URL(normalizePostgresUrl(sourceUrl)).password, new URL(normalizePostgresUrl(targetUrl)).password];
  let tempDirectory;
  let targetTouched = false;
  let verification;

  try {
    await sourceClient.connect();
    await targetClient.connect();
    const [sourceIdentity, targetIdentity] = await Promise.all([
      databaseIdentity(sourceClient, sourceUrl),
      databaseIdentity(targetClient, targetUrl),
    ]);
    assertSeparateDatabaseIdentities(sourceIdentity, targetIdentity);
    logger.log("Configuration valid: source and disposable target are separate databases.");

    if (options.dryRun) {
      logger.log(`Dry run passed. Found ${repository.length} repository migrations; no data was changed.`);
      return { healthy: true, dryRun: true, migrations: repository.length };
    }

    tempDirectory = await mkdtemp(join(tmpdir(), "workorder-db-restore-"));
    const archivePath = join(tempDirectory, "backup.dump");

    await sourceClient.query("begin isolation level repeatable read read only");
    let sourceManifest;
    try {
      const snapshotResult = await sourceClient.query("select pg_export_snapshot() as snapshot");
      sourceManifest = await collectManifest(sourceClient);
      await runCommand(
        binaries.pgDump,
        [
          "--format=custom",
          "--no-owner",
          "--no-acl",
          `--snapshot=${snapshotResult.rows[0].snapshot}`,
          `--file=${archivePath}`,
        ],
        { env: libpqEnvironment(sourceUrl), secrets },
      );
      await sourceClient.query("commit");
    } catch (error) {
      await sourceClient.query("rollback");
      throw error;
    }
    logger.log("Backup created from a consistent source snapshot.");

    targetTouched = true;
    await resetPublicSchema(targetClient);
    await runCommand(
      binaries.pgRestore,
      [
        "--exit-on-error",
        "--clean",
        "--if-exists",
        "--no-owner",
        "--no-acl",
        `--dbname=${libpqEnvironment(targetUrl).PGDATABASE}`,
        archivePath,
      ],
      { env: libpqEnvironment(targetUrl), secrets },
    );
    const restoredManifest = await collectManifest(targetClient);
    verification = verifyManifest({
      source: sourceManifest,
      restored: restoredManifest,
      repository,
    });
    if (!verification.healthy) {
      throw new Error(`Restore verification failed: ${verification.failures.join("; ")}`);
    }
    logger.log(JSON.stringify(verification));
    logger.log("Backup and restore verification passed.");
    return verification;
  } finally {
    if (targetTouched && !options.keepTarget) {
      try {
        await resetPublicSchema(targetClient);
        logger.log("Disposable restore target was cleaned.");
      } catch (error) {
        logger.error(`WARNING: restore target cleanup failed: ${redactSensitiveText(error.message, secrets)}`);
      }
    } else if (targetTouched && options.keepTarget) {
      logger.log("Restored target retained because --keep-target was supplied.");
    }
    await Promise.allSettled([sourceClient.end(), targetClient.end()]);
    if (tempDirectory) await rm(tempDirectory, { recursive: true, force: true });
  }
}
