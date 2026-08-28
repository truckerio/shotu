import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import pg from "pg";

const DEFAULT_CONNECT_TIMEOUT_MS = 1_500;
const DEFAULT_START_TIMEOUT_MS = 15_000;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function parseDatabaseTarget(connectionString) {
  if (!connectionString) throw new Error("DATABASE_URL is required for local startup.");
  const parsed = new URL(connectionString);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 5432),
    database: parsed.pathname.replace(/^\//, "") || "postgres",
  };
}

export function isLoopbackDatabaseHost(host) {
  return LOOPBACK_HOSTS.has(String(host || "").toLowerCase());
}

export function databaseErrorCodes(error, codes = new Set()) {
  if (!error || typeof error !== "object") return codes;
  if (error.code) codes.add(error.code);
  if (error.cause) databaseErrorCodes(error.cause, codes);
  if (Array.isArray(error.errors)) {
    for (const nested of error.errors) databaseErrorCodes(nested, codes);
  }
  return codes;
}

export function shouldAttemptLocalStart(target, error) {
  return isLoopbackDatabaseHost(target.host) && databaseErrorCodes(error).has("ECONNREFUSED");
}

async function probeDatabase(connectionString, timeoutMillis = DEFAULT_CONNECT_TIMEOUT_MS) {
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: timeoutMillis });
  try {
    await client.connect();
    await client.query("select 1");
  } finally {
    await client.end().catch(() => {});
  }
}

function run(command, args) {
  return spawnSync(command, args, { encoding: "utf8" });
}

function brewPrefix(formula) {
  const result = run("brew", formula ? ["--prefix", formula] : ["--prefix"]);
  return result.status === 0 ? result.stdout.trim() : "";
}

export function resolvePostgresInstallation(environment = process.env) {
  const configuredPgCtl = environment.LOCAL_POSTGRES_PG_CTL?.trim();
  const configuredDataDir = environment.LOCAL_POSTGRES_DATA_DIR?.trim();
  if (configuredPgCtl || configuredDataDir) {
    if (!configuredPgCtl || !configuredDataDir) {
      throw new Error("Set both LOCAL_POSTGRES_PG_CTL and LOCAL_POSTGRES_DATA_DIR.");
    }
    return { pgCtl: configuredPgCtl, dataDir: configuredDataDir };
  }

  const formula = environment.LOCAL_POSTGRES_HOMEBREW_FORMULA?.trim() || "postgresql@16";
  const formulaPrefix = brewPrefix(formula);
  const homebrewPrefix = brewPrefix("");
  if (!formulaPrefix || !homebrewPrefix) return null;
  return {
    pgCtl: join(formulaPrefix, "bin", "pg_ctl"),
    dataDir: join(homebrewPrefix, "var", formula),
  };
}

function validateInstallation(installation) {
  if (!installation) {
    throw new Error(
      "PostgreSQL is not running and Homebrew PostgreSQL 16 was not found. "
      + "Install it or set LOCAL_POSTGRES_PG_CTL and LOCAL_POSTGRES_DATA_DIR.",
    );
  }
  if (!existsSync(installation.pgCtl)) {
    throw new Error(`PostgreSQL control binary was not found at ${installation.pgCtl}.`);
  }
  if (!existsSync(join(installation.dataDir, "PG_VERSION"))) {
    throw new Error(
      `Existing PostgreSQL data was not found at ${installation.dataDir}. `
      + "Local startup will not initialize or replace a database.",
    );
  }
}

async function waitForDatabase(connectionString, timeoutMillis = DEFAULT_START_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMillis;
  let lastError;
  while (Date.now() < deadline) {
    try {
      await probeDatabase(connectionString);
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw lastError || new Error("PostgreSQL did not become ready.");
}

export async function ensureLocalDatabase({
  connectionString = process.env.DATABASE_URL,
  environment = process.env,
} = {}) {
  const target = parseDatabaseTarget(connectionString);
  try {
    await probeDatabase(connectionString);
    console.log(`Local PostgreSQL ready at ${target.host}:${target.port}/${target.database}.`);
    return { started: false, target };
  } catch (error) {
    if (!shouldAttemptLocalStart(target, error)) {
      const codes = [...databaseErrorCodes(error)].join(", ") || "unknown error";
      throw new Error(
        `Database connection failed at ${target.host}:${target.port}/${target.database} (${codes}). `
        + "Automatic startup is limited to a refused loopback connection.",
      );
    }
  }

  const installation = resolvePostgresInstallation(environment);
  validateInstallation(installation);
  const logPath = environment.LOCAL_POSTGRES_LOG?.trim()
    || join(installation.dataDir, "server.log");
  const result = run(installation.pgCtl, [
    "-D",
    installation.dataDir,
    "-l",
    logPath,
    "-o",
    `-p ${target.port}`,
    "start",
  ]);
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "pg_ctl failed").trim();
    throw new Error(`Could not start local PostgreSQL: ${detail}`);
  }

  await waitForDatabase(connectionString);
  console.log(`Local PostgreSQL started at ${target.host}:${target.port}/${target.database}.`);
  return { started: true, target };
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  ensureLocalDatabase().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
