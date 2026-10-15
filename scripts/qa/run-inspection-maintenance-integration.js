import pg from "pg";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const DATABASE_PREFIX = "inspection_maintenance_test_";

function checkedDatabaseUrl(value) {
  if (!value) throw new Error("DATABASE_URL is required.");
  const configured = new URL(value);
  const url = configured.protocol === "postgresql+asyncpg:"
    ? new URL(value.replace(/^postgresql\+asyncpg:/, "postgresql:"))
    : configured;
  if (!LOOPBACK_HOSTS.has(url.hostname)) {
    throw new Error("Inspection maintenance integration only runs against loopback PostgreSQL.");
  }
  if (!/^postgres(?:ql)?:$/.test(url.protocol)) {
    throw new Error("Inspection maintenance integration requires a PostgreSQL DATABASE_URL.");
  }
  return url;
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function runNode(args, environment) {
  const result = spawnSync(process.execPath, args, { env: environment, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Command failed (${result.status ?? "unknown"}): node ${args.join(" ")}`);
  }
}

function browserScriptFromArgs(args) {
  if (args.length === 0) return null;
  if (args.length !== 2 || args[0] !== "--browser-script") {
    throw new Error("Usage: node scripts/qa/run-inspection-maintenance-integration.js [--browser-script scripts/qa/<script>.js]");
  }
  const qaDirectory = resolve(process.cwd(), "scripts/qa");
  const candidate = resolve(process.cwd(), args[1]);
  const fromQa = relative(qaDirectory, candidate);
  if (!candidate.endsWith(".js") || fromQa === "" || fromQa === ".." || fromQa.startsWith(`..${sep}`) || !existsSync(candidate)) {
    throw new Error("The optional browser script must be an existing JavaScript file under scripts/qa.");
  }
  return candidate;
}

const source = checkedDatabaseUrl(process.env.DATABASE_URL);
const browserScript = browserScriptFromArgs(process.argv.slice(2));
const databaseName = `${DATABASE_PREFIX}${randomUUID().replaceAll("-", "")}`;
if (!new RegExp(`^${DATABASE_PREFIX}[a-f0-9]{32}$`).test(databaseName)) {
  throw new Error("Refusing an invalid disposable database name.");
}

const adminUrl = new URL(source.href);
adminUrl.pathname = "/postgres";
adminUrl.search = "";
const disposableUrl = new URL(source.href);
disposableUrl.pathname = `/${databaseName}`;
disposableUrl.search = "";
const admin = new pg.Client({ connectionString: adminUrl.href });

await admin.connect();
let created = false;
try {
  await admin.query(`create database ${quoteIdentifier(databaseName)}`);
  created = true;
  const environment = {
    ...process.env,
    DATABASE_URL: disposableUrl.href,
    RUN_INSPECTION_MAINTENANCE_INTEGRATION: "1",
  };

  // A new Node process is intentional: migrate() caches success in-process.
  // Running the ledger twice from fresh processes proves applied checksums replay cleanly.
  runNode(["src/server/db/migrate.js"], environment);
  runNode(["src/server/db/migrate.js"], environment);
  runNode(["--test", "scripts/qa/inspection-maintenance.integration.test.js"], environment);
  if (browserScript) runNode([browserScript], environment);
} finally {
  try {
    if (created) {
      if (!new RegExp(`^${DATABASE_PREFIX}[a-f0-9]{32}$`).test(databaseName)) {
        throw new Error("Refusing to remove a database outside the disposable test namespace.");
      }
      await admin.query(`drop database if exists ${quoteIdentifier(databaseName)} with (force)`);
    }
  } finally {
    await admin.end();
  }
}
