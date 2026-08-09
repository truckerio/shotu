import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { mechanicAllowedActions } from "../mechanic/mechanic.service.js";

const migrationUrl = new URL("../../db/migrations/024_location_workorder_policies.sql", import.meta.url);
const normalizedMigrationUrl = new URL("../../db/migrations/051_normalized_workorder_module_access.sql", import.meta.url);
const projectionRemovalMigrationUrl = new URL("../../db/migrations/054_remove_module_policy_compatibility_projections.sql", import.meta.url);
const repositoryUrl = new URL("../../db/repositories/workorder-policies.repo.js", import.meta.url);
const normalizedRepositoryUrl = new URL("../../db/repositories/module-access-rules.repo.js", import.meta.url);

test("location policy migration is restrictive for new locations and preserves existing behavior", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /mechanic_can_record_parts boolean not null default false/);
  assert.match(sql, /select[\s\S]*location\.id[\s\S]*location\.company_id[\s\S]*true[\s\S]*from locations location/i);
  assert.match(sql, /foreign key \(company_id, location_id\)[\s\S]*references locations\(company_id, id\)/i);
});

test("missing workorder policies resolve to denied in repository queries", async () => {
  const source = await readFile(repositoryUrl, "utf8");
  assert.match(source, /mechanicCanRecordParts: false/);
  assert.match(source, /moduleAccess: normalizeModuleAccessMap\(\)/);
  assert.match(source, /userModuleAccess: \{\}/);
  assert.match(source, /coalesce\(policy\.mechanic_can_record_parts, false\)/);
  assert.match(source, /from operational_workorders workorder/);
  assert.doesNotMatch(source, /policy\.module_access|policy\.user_module_access/);
});

test("V2 module access policy is normalized by scope and subject", async () => {
  const sql = await readFile(normalizedMigrationUrl, "utf8");
  assert.match(sql, /create table if not exists workorder_module_policy_scopes/i);
  assert.match(sql, /create table if not exists workorder_module_access_rules/i);
  assert.match(sql, /subject_type text not null check/i);
  assert.match(sql, /required boolean not null default false/i);
});

test("compatibility JSON projections are backfilled and removed", async () => {
  const sql = await readFile(projectionRemovalMigrationUrl, "utf8");
  assert.match(sql, /insert into workorder_module_access_rules/i);
  assert.match(sql, /drop column if exists module_access/i);
  assert.match(sql, /drop column if exists user_module_access/i);
  assert.match(sql, /drop table if exists company_workorder_module_policies/i);
  const repository = await readFile(normalizedRepositoryUrl, "utf8");
  assert.match(repository, /insert into workorder_module_policy_scopes/i);
  assert.match(repository, /delete from workorder_module_access_rules where scope_id = \$1/i);
  assert.match(repository, /WORKORDER_MODULE_POLICY_CONFLICT/);
  assert.doesNotMatch(repository, /company_workorder_module_policies|module_access, user_module_access/);
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
