import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL("../../db/migrations/003_location_admin.sql", import.meta.url);

test("location admin migration preserves one location identity and owned settings", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /location_merge_map/);
  assert.match(sql, /locations_company_name_uidx/);
  assert.match(sql, /create table if not exists location_workorder_templates/);
  assert.match(sql, /location_id uuid not null unique references locations\(id\) on delete cascade/);
  assert.match(sql, /create table if not exists user_invitations/);
  assert.match(sql, /token_hash text not null unique/);
});
