import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { mechanicAllowedActions } from "../mechanic/mechanic.service.js";

const migrationUrl = new URL("../../db/migrations/024_location_workorder_policies.sql", import.meta.url);
const repositoryUrl = new URL("../../db/repositories/workorder-policies.repo.js", import.meta.url);

test("location policy migration is restrictive for new locations and preserves existing behavior", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /mechanic_can_record_parts boolean not null default false/);
  assert.match(sql, /select[\s\S]*location\.id[\s\S]*location\.company_id[\s\S]*true[\s\S]*from locations location/i);
  assert.match(sql, /foreign key \(company_id, location_id\)[\s\S]*references locations\(company_id, id\)/i);
});

test("missing workorder policies resolve to denied in repository queries", async () => {
  const source = await readFile(repositoryUrl, "utf8");
  assert.match(source, /mechanicCanRecordParts: false/);
  assert.match(source, /coalesce\(policy\.mechanic_can_record_parts, false\)/);
  assert.match(source, /from operational_workorders workorder/);
});

test("mechanic parts permission is independent from chat and notes", () => {
  const workorder = { status: "in_progress", mechanicIds: ["mechanic-1"] };
  const denied = mechanicAllowedActions(workorder, "mechanic-1", {
    mechanicCanRecordParts: false,
  });
  assert.equal(denied.saveNotes, true);
  assert.equal(denied.sendMessage, true);
  assert.equal(denied.requestParts, true);
  assert.equal(denied.recordUsedParts, false);

  const allowed = mechanicAllowedActions(workorder, "mechanic-1", {
    mechanicCanRecordParts: true,
  });
  assert.equal(allowed.recordUsedParts, true);
});
