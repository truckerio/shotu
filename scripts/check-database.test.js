import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { compareMigrationLedger } from "./check-database.js";

test("migration check compares names and rejects unknown or changed applied SQL", () => {
  const repository = [
    { name: "001_initial_schema.sql", checksum: "current-1" },
    { name: "002_auth_foundation.sql", checksum: "current-2" },
  ];
  const applied = [
    { name: "001_initial_schema.sql", checksum: "changed-1" },
    { name: "999_local_experiment.sql", checksum: "unknown" },
  ];
  assert.deepEqual(compareMigrationLedger(repository, applied), {
    unknownApplied: [applied[1]],
    missingApplied: [repository[1]],
    checksumMismatch: [{ name: repository[0].name, appliedChecksum: "changed-1", repositoryChecksum: "current-1" }],
  });
});

test("only reviewed historical checksums retain migration compatibility", () => {
  const repository = [{ name: "096_product_module_access.sql", checksum: "current" }];
  const reviewed = [{ name: repository[0].name, checksum: "4c5959024dbb01939c3c12a83a343b08050c5de7cf5f8c4c0da952adfd069382" }];
  assert.deepEqual(compareMigrationLedger(repository, reviewed).checksumMismatch, []);
  const unknown = [{ name: "196_no_stock_tracking.sql", checksum: "a278d40ef3b375affb04756c68f0b0b31e8f5f830dc896b3e1f645fdea13f377" }];
  assert.equal(compareMigrationLedger([{ name: unknown[0].name, checksum: "different" }], unknown).checksumMismatch.length, 1);
});

test("verified no-stock revision compatibility is bound to both exact checksums", () => {
  const name = "196_no_stock_tracking.sql";
  const historical = "a278d40ef3b375affb04756c68f0b0b31e8f5f830dc896b3e1f645fdea13f377";
  const current = "2c6bc3588406c5046278c10ec781d1cd99d07e2c763ea0a52d422bb7b1cde69d";
  const compare = (migrationName, appliedChecksum, repositoryChecksum) => compareMigrationLedger(
    [{ name: migrationName, checksum: repositoryChecksum }],
    [{ name: migrationName, checksum: appliedChecksum }],
  ).checksumMismatch;

  assert.deepEqual(compare(name, historical, current), []);
  assert.deepEqual(compare(name, current, current), []);
  assert.equal(compare(name, "unreviewed-checksum", current).length, 1);
  assert.equal(compare(name, historical, "modified-current-sql").length, 1);
  assert.equal(compare("197_no_stock_workorder_prices.sql", historical, current).length, 1);
});

test("profile check separates linked login orphans from historical unlinked profiles", async () => {
  const source = await readFile(new URL("./check-database.js", import.meta.url), "utf8");
  assert.match(source, /profile\.auth_user_id is not null[\s\S]*?as active_profiles_without_company/);
  assert.match(source, /profile\.auth_user_id is null[\s\S]*?as historical_profiles_without_company/);
  assert.match(source, /if \(report\.active_profiles_without_company\) failures\.push/);
  assert.doesNotMatch(source, /if \(report\.historical_profiles_without_company\) failures\.push/);
});
