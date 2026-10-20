import pg from "pg";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const PREFIX = "workorder_pricing_test_";

function checkedUrl(value) {
  if (!value) throw new Error("DATABASE_URL is required.");
  const url = new URL(value.replace(/^postgresql\+asyncpg:/, "postgresql:"));
  if (!LOOPBACK.has(url.hostname) || !/^postgres(?:ql)?:$/.test(url.protocol)) {
    throw new Error("Workorder pricing integration requires loopback PostgreSQL.");
  }
  return url;
}

function quoted(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function run(args, environment) {
  const result = spawnSync(process.execPath, args, { env: environment, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Pricing integration command failed with ${result.status}.`);
}

const source = checkedUrl(process.env.DATABASE_URL);
const databaseName = `${PREFIX}${randomUUID().replaceAll("-", "")}`;
const legacyDatabaseName = `${PREFIX}${randomUUID().replaceAll("-", "")}`;
const safeName = (value) => /^workorder_pricing_test_[a-f0-9]{32}$/.test(value);
if (!safeName(databaseName) || !safeName(legacyDatabaseName)) throw new Error("Invalid disposable database name.");
const adminUrl = new URL(source.href); adminUrl.pathname = "/postgres"; adminUrl.search = "";
const disposableUrl = new URL(source.href); disposableUrl.pathname = `/${databaseName}`; disposableUrl.search = "";
const legacyUrl = new URL(source.href); legacyUrl.pathname = `/${legacyDatabaseName}`; legacyUrl.search = "";
const admin = new pg.Client({ connectionString: adminUrl.href });

await admin.connect();
let created = false;
let legacyCreated = false;
try {
  await admin.query(`create database ${quoted(databaseName)}`);
  created = true;
  const environment = { ...process.env, DATABASE_URL: disposableUrl.href, RUN_POSTGRES_INTEGRATION: "1" };
  run(["src/server/db/migrate.js"], environment);
  run(["src/server/db/migrate.js"], environment);
  run(["--test", "src/server/modules/workorders/workorder-create-pricing.integration.test.js"], environment);

  await admin.query(`create database ${quoted(legacyDatabaseName)}`);
  legacyCreated = true;
  const legacyEnvironment = {
    ...process.env,
    DATABASE_URL: legacyUrl.href,
    LEGACY_SNAPSHOT_ID: randomUUID(),
  };
  run(["scripts/qa/workorder-pricing-legacy-migration.js", "prepare"], legacyEnvironment);
  run(["src/server/db/migrate.js"], legacyEnvironment);
  run(["scripts/qa/workorder-pricing-legacy-migration.js", "verify"], legacyEnvironment);
} finally {
  try {
    if (legacyCreated) {
      if (!safeName(legacyDatabaseName)) throw new Error("Refusing unsafe legacy database removal.");
      await admin.query(`drop database if exists ${quoted(legacyDatabaseName)} with (force)`);
    }
    if (created) {
      if (!safeName(databaseName)) throw new Error("Refusing unsafe database removal.");
      await admin.query(`drop database if exists ${quoted(databaseName)} with (force)`);
    }
  } finally {
    await admin.end();
  }
}
