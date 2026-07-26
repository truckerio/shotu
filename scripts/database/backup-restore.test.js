import test from "node:test";
import assert from "node:assert/strict";
import {
  assertSeparateDatabaseIdentities,
  assertSeparateUrls,
  connectionFingerprint,
  libpqEnvironment,
  normalizePostgresUrl,
  parseArgs,
  redactSensitiveText,
  verifyManifest,
} from "./backup-restore-lib.js";

test("CLI requires environment variable names instead of accepting database URLs", () => {
  assert.deepEqual(parseArgs(["--confirm-disposable", "--keep-target", "--dry-run"]), {
    confirmDisposable: true,
    keepTarget: true,
    dryRun: true,
    sourceEnv: "DATABASE_URL",
    targetEnv: "RESTORE_DATABASE_URL",
    pgBinDir: "",
    help: false,
  });
  assert.throws(
    () => parseArgs(["--source-env", "postgresql://secret@host/db"]),
    /environment variable name/,
  );
  assert.throws(() => parseArgs(["--target-url", "secret"]), /Unknown option/);
});

test("PostgreSQL URLs normalize without exposing credentials", () => {
  const raw = "postgresql+asyncpg://user:p%40ss@localhost:5433/source?sslmode=require";
  assert.match(normalizePostgresUrl(raw), /^postgresql:\/\/user:p%40ss@localhost:5433\/source/);
  const environment = libpqEnvironment(raw, { PATH: "/bin" });
  assert.equal(environment.PGHOST, "localhost");
  assert.equal(environment.PGPORT, "5433");
  assert.equal(environment.PGDATABASE, "source");
  assert.equal(environment.PGUSER, "user");
  assert.equal(environment.PGPASSWORD, "p@ss");
  assert.equal(environment.PGSSLMODE, "require");
  assert.equal(environment.PATH, "/bin");
});

test("same source and target are rejected by URL and server identity", () => {
  const source = "postgresql://user:one@localhost:5432/workorders";
  const same = "postgresql://other:two@localhost/workorders";
  assert.equal(connectionFingerprint(source), connectionFingerprint(same));
  assert.throws(() => assertSeparateUrls(source, same), /same URL identity/);

  assert.throws(
    () => assertSeparateDatabaseIdentities(
      { database: "workorders", serverAddress: "127.0.0.1", serverHost: "localhost", port: 5432 },
      { database: "workorders", serverAddress: "127.0.0.1", serverHost: "127.0.0.1", port: 5432 },
    ),
    /same PostgreSQL database/,
  );
});

test("credential redaction covers URLs, explicit secrets, and libpq fragments", () => {
  const url = "postgresql://user:super-secret@db.example/workorders";
  const output = redactSensitiveText(
    `failed ${url} password=super-secret pwd=other`,
    [url, "super-secret"],
  );
  assert.doesNotMatch(output, /super-secret|pwd=other/);
  assert.match(output, /\[REDACTED\]/);
});

test("manifest verification checks migration checksums and restored counts", () => {
  const repository = [{ name: "001_initial_schema.sql", checksum: "abc" }];
  const source = {
    migrations: repository,
    tableCounts: { companies: 2 },
    viewCounts: { v_workorder_operations: 4 },
  };
  const healthy = verifyManifest({
    source,
    restored: {
      migrations: repository,
      tableCounts: { companies: 2 },
      viewCounts: { v_workorder_operations: 4 },
    },
    repository,
  });
  assert.equal(healthy.healthy, true);

  const broken = verifyManifest({
    source,
    restored: {
      migrations: [{ name: "001_initial_schema.sql", checksum: "modified" }],
      tableCounts: { companies: 1 },
      viewCounts: { v_workorder_operations: 3 },
    },
    repository,
  });
  assert.equal(broken.healthy, false);
  assert.match(broken.failures.join(" "), /checksum differs/);
  assert.match(broken.failures.join(" "), /count/);
});

