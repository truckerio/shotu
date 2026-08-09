import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { mechanicAllowedActions } from "../mechanic/mechanic.service.js";

const migrationUrl = new URL("../../db/migrations/024_location_workorder_policies.sql", import.meta.url);
const moduleAccessMigrationUrl = new URL("../../db/migrations/049_workorder_module_access_policy.sql", import.meta.url);
const companyModuleAccessMigrationUrl = new URL("../../db/migrations/050_company_workorder_module_policy.sql", import.meta.url);
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
  assert.match(source, /moduleAccess: normalizeModuleAccessMap\(\)/);
  assert.match(source, /userModuleAccess: normalizeUserModuleAccessMap\(\)/);
  assert.match(source, /coalesce\(policy\.mechanic_can_record_parts, false\)/);
  assert.match(source, /coalesce\(policy\.module_access, '\{\}'::jsonb\)/);
  assert.match(source, /coalesce\(policy\.user_module_access, '\{\}'::jsonb\)/);
  assert.match(source, /from operational_workorders workorder/);
});

test("V2 module access policy stays on the existing location policy row", async () => {
  const sql = await readFile(moduleAccessMigrationUrl, "utf8");
  assert.match(sql, /alter table location_workorder_policies/i);
  assert.match(sql, /add column if not exists module_access jsonb not null default '\{\}'::jsonb/i);
  assert.match(sql, /add column if not exists user_module_access jsonb not null default '\{\}'::jsonb/i);
  assert.match(sql, /V2 workorder module access overrides by role and surface/i);
  assert.match(sql, /V2 workorder module access overrides by named user/i);
});

test("company module defaults are sparse, tenant-owned, and additive", async () => {
  const sql = await readFile(companyModuleAccessMigrationUrl, "utf8");
  assert.match(sql, /create table if not exists company_workorder_module_policies/i);
  assert.match(sql, /company_id uuid primary key references companies\(id\) on delete cascade/i);
  assert.match(sql, /module_access jsonb not null default '\{\}'::jsonb/i);
  assert.match(sql, /user_module_access jsonb not null default '\{\}'::jsonb/i);
  assert.match(sql, /version bigint not null default 1/i);
  assert.match(sql, /updated_by_user_id uuid references user_profiles\(id\) on delete set null/i);
  assert.match(sql, /jsonb_typeof\(module_access\) = 'object'/i);
  const repository = await readFile(repositoryUrl, "utf8");
  assert.match(repository, /normalizeModuleAccessOverrides\(moduleAccess\)/);
  assert.match(repository, /normalizeUserModuleAccessMap\(userModuleAccess\)/);
  assert.match(repository, /company_workorder_module_policies\.version = \$5::bigint/);
  assert.match(repository, /\$5::bigint = 0[\s\S]*not exists/);
  assert.match(repository, /WORKORDER_MODULE_POLICY_CONFLICT/);
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
