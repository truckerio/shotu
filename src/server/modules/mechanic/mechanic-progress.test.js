import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { mechanicProgressSchema } from "./mechanic-progress.schemas.js";

test("mechanic progress requires an optimistic version and normalizes editable fields", () => {
  const result = mechanicProgressSchema.parse({
    diagnosis: "  Found leak. ",
    workPerformed: " Replaced hose. ",
    laborHours: "2.50",
    expectedVersion: 3,
    recordActivity: true,
  });
  assert.deepEqual(result, {
    diagnosis: "Found leak.",
    workPerformed: "Replaced hose.",
    laborHours: "2.5",
    expectedVersion: 3,
    recordActivity: true,
  });
  assert.throws(() => mechanicProgressSchema.parse({ diagnosis: "x", expectedVersion: 0 }));
  assert.throws(() => mechanicProgressSchema.parse({ diagnosis: "x" }));
  assert.throws(() => mechanicProgressSchema.parse({ diagnosis: "x", laborHours: "1.234", expectedVersion: 1 }));
  assert.equal(mechanicProgressSchema.parse({ diagnosis: "x", expectedVersion: 1 }).laborHours, undefined);
  assert.deepEqual(mechanicProgressSchema.parse({ concern: "  Inspect brakes  ", expectedVersion: 3 }), {
    concern: "Inspect brakes", expectedVersion: 3, recordActivity: false,
  });
  assert.equal(mechanicProgressSchema.safeParse({ concern: "", expectedVersion: 3 }).success, false);
});

test("progress migration adds a positive per-workorder version token", async () => {
  const migration = await readFile(
    new URL("../../db/migrations/022_workorder_progress_version.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /add column if not exists progress_version integer not null default 1/i);
  assert.match(migration, /progress_version > 0/i);
});

test("progress repository is assignment-scoped and emits one grouped activity event", async () => {
  const source = await readFile(
    new URL("../../db/repositories/workorder-progress.repo.js", import.meta.url),
    "utf8",
  );
  assert.match(source, /assignment\.mechanic_user_id = \$2/);
  assert.match(source, /work_details_updated/);
  assert.match(source, /progress_version = progress_version \+ \$6/);
  assert.match(source, /form_data = \$9::jsonb/);
  assert.match(source, /laborHours === undefined \? before\.laborHours/);
  assert.doesNotMatch(source, /current_mechanic_id/);
});

test("each changed Concern emits a standalone plain-text event without joining pending work details", async () => {
  const source = await readFile(new URL("../../db/repositories/workorder-progress.repo.js", import.meta.url), "utf8");
  assert.match(source, /const concernChanged = changes\.some\(\(\{ field \}\) => field === "concern"\)/);
  assert.match(source, /current\.progress_pending_fields\.map\(String\)\.filter\(\(field\) => field !== "concern"\)/);
  assert.match(source, /if \(concernChanged\) \{[\s\S]*'concern', 'Concern'[\s\S]*before\.concern, next\.concern, mechanicUserId/);
  assert.doesNotMatch(source, /fieldsChanged: pendingFields,\s*concern:/);
});
