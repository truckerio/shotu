import assert from "node:assert/strict";
import test from "node:test";
import { planMetrics, recommendationStatus, sanitizePlan } from "./plan-utils.js";

test("plan output is sanitized and summarized without tenant identifiers", () => {
  const raw = [{
    "Planning Time": 0.3,
    "Execution Time": 4.2,
    Plan: {
      "Node Type": "Index Scan",
      "Index Cond": "company_id = '00000000-0000-0000-0000-000000000001'::uuid and id = 'ad5157f0-b074-4d78-b844-1cc6e1566ff4'::uuid",
      "Actual Rows": 25,
      "Shared Hit Blocks": 12,
    },
  }];
  const sanitized = sanitizePlan(raw);
  assert.doesNotMatch(JSON.stringify(sanitized), /ad5157f0|00000000/);
  assert.deepEqual(planMetrics(raw), {
    planningTimeMs: 0.3,
    executionTimeMs: 4.2,
    rootNode: "Index Scan",
    actualRows: 25,
    sharedHitBlocks: 12,
    sharedReadBlocks: 0,
    temporaryReadBlocks: 0,
    temporaryWrittenBlocks: 0,
  });
});

test("index recommendation recognizes ordered composite coverage", () => {
  const result = recommendationStatus([{
    tablename: "operational_workorders",
    indexdef: "CREATE INDEX queue_idx ON operational_workorders (company_id, location_id, status, updated_at DESC)",
  }], {
    table: "operational_workorders",
    columns: ["company_id", "location_id", "status", "updated_at"],
  });
  assert.equal(result.covered, true);
});
