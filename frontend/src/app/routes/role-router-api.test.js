import assert from "node:assert/strict";
import test from "node:test";

import { updateDetailDiagnosisRepair } from "./role-router-api.js";

test("admin diagnosis and repair autosave uses the canonical module endpoint", async () => {
  const calls = [];
  const result = await updateDetailDiagnosisRepair({
    role: "admin",
    workorderId: "workorder 1",
    diagnosis: "Found leak",
    workPerformed: "Replaced hose",
    expectedVersion: 3,
    recordActivity: true,
  }, async (...args) => {
    calls.push(args);
    return { result: { version: 4 } };
  });

  assert.deepEqual(result, { version: 4 });
  assert.equal(calls[0][0], "/api/workorders/workorder%201/modules/diagnosisRepair");
  assert.equal(calls[0][1].method, "PATCH");
  assert.deepEqual(JSON.parse(calls[0][1].body), {
    diagnosis: "Found leak",
    workPerformed: "Replaced hose",
    expectedVersion: 3,
    recordActivity: true,
  });
});

test("mechanic concern-only autosave uses the protected mechanic progress endpoint", async () => {
  const calls = [];
  const result = await updateDetailDiagnosisRepair({ role: "mechanic", workorderId: "wo 1", concern: "Office request; inspected leak", expectedVersion: 7, recordActivity: true }, async (...args) => {
    calls.push(args);
    return { concern: "Office request; inspected leak", version: 8 };
  });
  assert.equal(result.version, 8);
  assert.equal(calls[0][0], "/api/mechanic/workorders/wo%201/progress");
  assert.deepEqual(JSON.parse(calls[0][1].body), { concern: "Office request; inspected leak", expectedVersion: 7, recordActivity: true });
});
