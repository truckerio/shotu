import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  DEFAULT_TEMPORARY_KIOSK_PIN,
  PRODUCTION_CONFIRMATION,
  resetCommandMode,
} from "../../../../scripts/kiosk/reset-mechanic-pins.js";

const repositoryUrl = new URL("../../db/repositories/kiosk.repo.js", import.meta.url);

test("bulk kiosk PIN reset requires an explicit production confirmation", () => {
  assert.equal(DEFAULT_TEMPORARY_KIOSK_PIN, "0000");
  assert.equal(resetCommandMode([], "production"), "dry-run");
  assert.throws(
    () => resetCommandMode(["--apply"], "production"),
    /Pass --confirm=/,
  );
  assert.throws(
    () => resetCommandMode([
      "--apply",
      `--confirm=${PRODUCTION_CONFIRMATION}`,
    ], "development"),
    /only run in the production environment/,
  );
  assert.equal(resetCommandMode([
    "--apply",
    `--confirm=${PRODUCTION_CONFIRMATION}`,
  ], "production"), "apply");
});

test("bulk kiosk PIN reset scopes active mechanics and preserves audit and lockout reset", async () => {
  const source = await readFile(repositoryUrl, "utf8");
  assert.match(source, /company_membership\.role = 'mechanic'/);
  assert.match(source, /company_membership\.active/);
  assert.match(source, /location_membership\.active/);
  assert.match(source, /location\.active/);
  assert.match(source, /requires_change = true/);
  assert.match(source, /bulk_temporary_pin/);
  assert.match(source, /delete from kiosk_unlock_failures/);
  assert.doesNotMatch(source, /["']0000["']/);
});
