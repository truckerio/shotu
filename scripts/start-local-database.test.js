import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  databaseErrorCodes,
  isLoopbackDatabaseHost,
  parseDatabaseTarget,
  shouldAttemptLocalStart,
} from "./start-local-database.js";

test("parses the configured PostgreSQL target without exposing credentials", () => {
  assert.deepEqual(
    parseDatabaseTarget("postgresql+asyncpg://user:secret@localhost:5433/workorder_generator"),
    { host: "localhost", port: 5433, database: "workorder_generator" },
  );
});

test("limits automatic startup to loopback hosts", () => {
  assert.equal(isLoopbackDatabaseHost("localhost"), true);
  assert.equal(isLoopbackDatabaseHost("127.0.0.1"), true);
  assert.equal(isLoopbackDatabaseHost("::1"), true);
  assert.equal(isLoopbackDatabaseHost(parseDatabaseTarget("postgres://u:p@[::1]:5433/db").host), true);
  assert.equal(isLoopbackDatabaseHost("database.internal"), false);
});

test("finds refused connections nested in AggregateError", () => {
  const error = new AggregateError([
    Object.assign(new Error("refused"), { code: "ECONNREFUSED" }),
  ]);
  assert.deepEqual([...databaseErrorCodes(error)], ["ECONNREFUSED"]);
  assert.equal(
    shouldAttemptLocalStart({ host: "localhost" }, error),
    true,
  );
  assert.equal(
    shouldAttemptLocalStart({ host: "database.internal" }, error),
    false,
  );
});

test("local start command runs database preflight and never initializes data", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const source = await readFile(new URL("./start-local-database.js", import.meta.url), "utf8");
  assert.equal(
    packageJson.scripts["start:local"],
    "npm run db:start:local && node --env-file=.env server.js",
  );
  assert.equal(
    packageJson.scripts["db:start:local"],
    "node --env-file=.env scripts/start-local-database.js",
  );
  assert.doesNotMatch(source, /\binitdb\b/);
  assert.match(source, /PG_VERSION/);
  assert.match(source, /Automatic startup is limited to a refused loopback connection/);
});
