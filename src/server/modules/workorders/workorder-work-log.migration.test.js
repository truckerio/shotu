import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(new URL("../../db/migrations/201_workorder_work_log.sql", import.meta.url), "utf8");

test("work-log migration separates operational state and preserves minute-based immutable labor history", () => {
  assert.match(sql, /add column activity_status[\s\S]*add column activity_version/);
  assert.match(sql, /status = 'in_progress' then 'active' else 'ready'/);
  assert.match(sql, /create table workorder_labor_entries[\s\S]*minutes integer not null/);
  assert.match(sql, /create table workorder_labor_entry_revisions/);
  assert.match(sql, /workorder_labor_entry_revisions_immutable/);
  assert.doesNotMatch(sql, /set\s+form_data\s*=/);
});
