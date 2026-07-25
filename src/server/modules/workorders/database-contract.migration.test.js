import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { updateOfficeWorkorderSchema } from "./workorder.schemas.js";

const migrationRoot = new URL("../../db/migrations/", import.meta.url);
const repositoryUrl = new URL("../../db/repositories/operational-workorders.repo.js", import.meta.url);

async function migration(name) {
  return readFile(new URL(name, migrationRoot), "utf8");
}

test("operational support views expose workflow truth without secret tables", async () => {
  const sql = await migration("009_operational_database_views.sql");
  assert.match(sql, /create or replace view v_user_access_scope/i);
  assert.match(sql, /create or replace view v_workorder_assignment_roster/i);
  assert.match(sql, /create or replace view v_workorder_operations/i);
  assert.match(sql, /create or replace view v_inventory_availability/i);
  assert.match(sql, /create or replace view v_odoo_backlog/i);
  assert.doesNotMatch(sql, /auth_account|auth_session|access_token|refresh_token/i);
});

test("cancelled is canonical while queue labels remain compatibility-only", async () => {
  const sql = await migration("009_operational_database_views.sql");
  assert.match(sql, /'odoo_entered', 'cancelled'/i);
  assert.match(sql, /new\.status not in \('waiting_office', 'parts_requested'\)/i);
  assert.doesNotMatch(sql, /new\.status not in \('waiting_office', 'parts_requested', 'cancelled'\)/i);
});

test("workorders require an owned location and company-scoped serial", async () => {
  const locationSql = await migration("010_workorder_location_integrity.sql");
  const serialSql = await migration("011_company_workorder_serials.sql");
  assert.match(locationSql, /alter column location_id set not null/i);
  assert.match(serialSql, /on operational_workorders\(company_uuid, serial\)/i);
});

test("public OAuth callback state identifies one connection", async () => {
  const sql = await migration("012_integration_oauth_state.sql");
  assert.match(sql, /unique index.*integration_accounts_oauth_state_uidx/is);
  assert.match(sql, /where oauth_state is not null/i);
});

test("an allocated workorder cannot be moved to another company", async () => {
  const parsed = updateOfficeWorkorderSchema.parse({
    companyId: "11111111-1111-4111-8111-111111111111",
    concern: "Inspect air leak.",
  });
  const repository = await readFile(repositoryUrl, "utf8");

  assert.equal(parsed.companyId, undefined);
  assert.doesNotMatch(repository, /set company_uuid = coalesce/i);
});
