import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("migration 198 validates the complete deferral policy and trailer boundary", async () => {
  const sql=await readFile(new URL("../../db/migrations/198_inspection_maintenance_deferrals.sql",import.meta.url),"utf8");
  assert.match(sql,/policy \?& array\['nextVisit','dueDate','dueMiles','baselineMiles','additionalMiles','earlyMiles'\]/);
  assert.match(sql,/to_char\(to_date\(due_date,'YYYY-MM-DD'\),'YYYY-MM-DD'\) <> due_date/);
  assert.match(sql,/additional_miles <= 0[\s\S]*due_miles <> baseline_miles \+ additional_miles/);
  assert.match(sql,/target_unit_type = 'Trailer'[\s\S]*Trailer deferrals support next visit or date only/);
  assert.match(sql,/inspection_follow_up_active_obligation_uidx[\s\S]*status <> 'superseded'/);
});

test("migration 198 preserves old follow-ups and expands event and command ledgers additively", async () => {
  const sql=await readFile(new URL("../../db/migrations/198_inspection_maintenance_deferrals.sql",import.meta.url),"utf8");
  assert.match(sql,/status in \('open','resolved_workorder','resolved_no_workorder','reopened','superseded'\)/);
  assert.match(sql,/event_type in \('opened','resolved_workorder','resolved_no_workorder','reopened','deferred','verified','superseded'\)/);
  assert.match(sql,/action in \('link_workorder','create_workorder','no_workorder','defer','verify'\)/);
  assert.doesNotMatch(sql,/delete from inspection_/i);
});
