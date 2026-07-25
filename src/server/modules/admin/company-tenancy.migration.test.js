import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL("../../db/migrations/007_company_tenancy.sql", import.meta.url);

test("company tenancy migration creates a UUID tenant root and scopes core domains", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  assert.match(sql, /create table if not exists companies/i);
  assert.match(sql, /00000000-0000-0000-0000-000000000001/);
  assert.match(sql, /company_legacy_keys/i);
  assert.match(sql, /add column if not exists company_uuid uuid/i);
  assert.match(sql, /sync_legacy_company_scope/i);
  assert.match(sql, /references companies\(id\)/i);
  assert.match(sql, /assets_company_provider_uidx/i);
  assert.match(sql, /integration_accounts_company_provider_uidx/i);
  assert.match(sql, /integration_account_id uuid/i);
  assert.doesNotMatch(sql, /alter column company_id type uuid/i);
  assert.doesNotMatch(sql, /drop column if exists organization_id/i);
});
