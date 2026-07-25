import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL("../db/migrations/002_auth_foundation.sql", import.meta.url);

test("auth migration matches Better Auth mappings and domain identity links", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  for (const table of ["auth_user", "auth_session", "auth_account", "auth_verification"]) {
    assert.match(sql, new RegExp(`create table if not exists ${table} \\(`));
  }

  assert.match(sql, /display_username text/);
  assert.doesNotMatch(sql, /displayUsername/);
  assert.match(sql, /foreign key \(auth_user_id\) references auth_user\(id\) on delete restrict/);
  assert.match(sql, /create table if not exists user_company_memberships/);
  assert.match(sql, /primary key \(user_id, company_id\)/);
  assert.match(sql, /role text not null check \(role in \('mechanic', 'office', 'surveillance', 'admin'\)\)/);
});
