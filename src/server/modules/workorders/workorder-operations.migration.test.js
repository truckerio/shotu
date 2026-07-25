import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL("../../db/migrations/004_workorder_operations.sql", import.meta.url);
const repositoryUrl = new URL("../../db/repositories/operational-workorders.repo.js", import.meta.url);

test("operations migration separates canonical lifecycle from auditable attention", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /create table if not exists workorder_attention_state/);
  assert.match(sql, /create table if not exists workorder_attention_events/);
  assert.match(sql, /create table if not exists workorder_read_state/);
  assert.match(sql, /create table if not exists user_workorder_preferences/);
  assert.match(sql, /'open', 'accepted', 'in_progress', 'mechanic_done', 'closed', 'odoo_entered'/);
  assert.match(sql, /normalize_workorder_lifecycle_status/);
});

test("operations projection derives each supported attention reason", async () => {
  const source = await readFile(repositoryUrl, "utf8");
  for (const reason of ["parts", "office_help", "missing_info", "overdue"]) {
    assert.match(source, new RegExp(`['\"]${reason}['\"]`));
  }
  assert.match(source, /workorder_part_requests/);
  assert.match(source, /count\(\*\) over\(\)/);
  assert.match(source, /order by \$\{sort\} \$\{direction\}/);
});
