import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrations = new URL("../../db/migrations/", import.meta.url);
const repositories = new URL("../../db/repositories/", import.meta.url);

async function migration(name) {
  return readFile(new URL(name, migrations), "utf8");
}

test("final company contract removes text aliases and global provider identity", async () => {
  const sql = await migration("014_company_contract.sql");
  assert.match(sql, /drop table company_legacy_keys/i);
  assert.match(sql, /rename column company_uuid to company_id/i);
  assert.match(sql, /drop constraint if exists integration_accounts_provider_key/i);
  assert.match(sql, /drop index if exists assets_provider_uid_idx/i);
  assert.match(sql, /drop column if exists organization_id/i);
});

test("operational profiles own contact data while memberships own access", async () => {
  const sql = await migration("015_user_profiles_contract.sql");
  assert.match(sql, /alter table app_users rename to user_profiles/i);
  assert.match(sql, /rename column name to display_name/i);
  assert.match(sql, /rename column email to contact_email/i);
  assert.match(sql, /drop column role/i);
  assert.match(sql, /drop column location_id/i);
});

test("mechanic assignment table is the only workorder mechanic truth", async () => {
  const migrationSql = await migration("016_mechanic_assignment_contract.sql");
  const repository = await readFile(new URL("operational-workorders.repo.js", repositories), "utf8");
  assert.match(migrationSql, /drop column current_mechanic_id/i);
  assert.doesNotMatch(repository, /wo\.current_mechanic_id/i);
  assert.doesNotMatch(repository, /set current_mechanic_id/i);
  assert.match(repository, /workorder_mechanic_assignments/i);
});

test("runtime repositories use final tenant and profile names", async () => {
  const files = [
    "assets.repo.js",
    "auth-users.repo.js",
    "integrations.repo.js",
    "invitations.repo.js",
    "locations.repo.js",
    "operational-workorders.repo.js",
    "part-requests.repo.js",
    "users.repo.js",
  ];
  const runtime = (await Promise.all(files.map((name) => readFile(new URL(name, repositories), "utf8")))).join("\n");
  assert.doesNotMatch(runtime, /company_uuid/i);
  assert.doesNotMatch(runtime, /company_legacy_keys/i);
  assert.doesNotMatch(runtime, /\bapp_users\b/i);
});

test("constraint names use the final company_id vocabulary", async () => {
  const sql = await migration("018_constraint_name_cleanup.sql");
  assert.match(sql, /rename constraint assets_company_uuid_fkey to assets_company_id_fkey/i);
  assert.match(sql, /rename constraint operational_workorders_company_uuid_fkey to operational_workorders_company_id_fkey/i);
  assert.match(sql, /rename constraint user_location_memberships_company_uuid_fkey to user_location_memberships_company_id_fkey/i);
});
