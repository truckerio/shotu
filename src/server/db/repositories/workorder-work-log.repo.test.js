import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./workorder-work-log.repo.js", import.meta.url), "utf8");

test("work-log mutations lock the workorder and recheck mechanic assignment", () => {
  assert.match(source, /from operational_workorders where id = \$1 and company_id = \$2 for update/);
  assert.match(source, /assertAssignedMechanic\(client, workorderId, mechanicUserId\)/);
  assert.match(source, /workorder_mechanic_assignments[\s\S]*active = true[\s\S]*for share/);
});

test("labor idempotency compares canonical payload after a concurrent UUID collision", () => {
  assert.match(source, /if \(error\?\.code === "23505"\)[\s\S]*select request_hash[\s\S]*=== hash\) return false/);
  assert.match(source, /WORK_LOG_IDEMPOTENCY_MISMATCH/);
});
