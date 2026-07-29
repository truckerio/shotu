import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL("../../db/migrations/003_location_admin.sql", import.meta.url);
const locationEventsMigrationUrl = new URL("../../db/migrations/032_admin_user_location_events.sql", import.meta.url);
const invitationBatchesMigrationUrl = new URL("../../db/migrations/033_invitation_batches.sql", import.meta.url);
const invitationRoleContractMigrationUrl = new URL("../../db/migrations/036_invitation_role_contract.sql", import.meta.url);
const passwordResetRequestsMigrationUrl = new URL("../../db/migrations/037_admin_password_reset_requests.sql", import.meta.url);

test("location admin migration preserves one location identity and owned settings", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /location_merge_map/);
  assert.match(sql, /locations_company_name_uidx/);
  assert.match(sql, /create table if not exists location_workorder_templates/);
  assert.match(sql, /location_id uuid not null unique references locations\(id\) on delete cascade/);
  assert.match(sql, /create table if not exists user_invitations/);
  assert.match(sql, /token_hash text not null unique/);
});

test("multi-location invitations have a durable batch identity", async () => {
  const sql = await readFile(invitationBatchesMigrationUrl, "utf8");
  assert.match(sql, /add column if not exists batch_id uuid/);
  assert.match(sql, /user_invitations_batch_status_idx/);
});

test("invitation roles match every authenticated company role", async () => {
  const sql = await readFile(invitationRoleContractMigrationUrl, "utf8");
  assert.match(sql, /drop constraint if exists user_invitations_role_check/);
  assert.match(sql, /role in \('mechanic', 'office', 'surveillance', 'admin'\)/);
  assert.match(sql, /not valid/);
  assert.match(sql, /validate constraint user_invitations_role_check/);
});

test("admin location assignment has a dedicated audit event", async () => {
  const sql = await readFile(locationEventsMigrationUrl, "utf8");
  assert.match(sql, /locations_updated/);
  assert.match(sql, /admin_user_events_action_check/);
});

test("admin password-reset email requests have a distinct audit event", async () => {
  const sql = await readFile(passwordResetRequestsMigrationUrl, "utf8");
  assert.match(sql, /password_reset_requested/);
  assert.match(sql, /admin_user_events_action_check/);
  assert.match(sql, /does not prove/i);
});
