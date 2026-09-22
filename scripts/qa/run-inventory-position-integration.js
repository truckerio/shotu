import pg from "pg";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";

const target = new URL(process.env.DATABASE_URL);
if (!["localhost", "127.0.0.1", "[::1]"].includes(target.hostname)) throw new Error("Local PostgreSQL is required.");
target.pathname = "/postgres";
const admin = new pg.Client({ connectionString: target.href });
await admin.connect();
const databaseName = `position_test_${randomUUID().replaceAll("-", "")}`;
try {
  await admin.query(`create database ${databaseName}`);
  target.pathname = `/${databaseName}`;
  process.env.DATABASE_URL = target.href;
  const { migrate } = await import("../../src/server/db/migrate.js");
  const { closePool } = await import("../../src/server/db/pool.js");
  try { await migrate(); } finally { await closePool(); }
  const result = spawnSync(process.execPath, ["--test", "src/server/modules/inventory/inventory-positions.integration.test.js"], {
    env: { ...process.env, RUN_POSTGRES_INTEGRATION: "1" }, stdio: "inherit",
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  await admin.query(`drop database if exists ${databaseName} with (force)`);
  await admin.end();
}
