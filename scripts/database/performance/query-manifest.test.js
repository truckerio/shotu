import assert from "node:assert/strict";
import test from "node:test";
import { INDEX_RECOMMENDATIONS, PLAN_QUERIES, REQUIRED_INDEXES } from "./query-manifest.js";

test("performance manifest covers pagination, search, mechanic, and surveillance reads", () => {
  const keys = PLAN_QUERIES.map((query) => query.key);
  assert.deepEqual(keys, [
    "location_active_first_page",
    "location_active_deep_page",
    "location_search",
    "mechanic_active_queue",
    "surveillance_odoo_backlog",
  ]);
  for (const query of PLAN_QUERIES) {
    assert.match(query.sql, /^\s*select/i);
    assert.ok(query.budgetMs > 0);
    assert.ok(query.minimumRows > 0);
    assert.equal(typeof query.params, "function");
  }
  assert.ok(REQUIRED_INDEXES.includes("operational_workorders_company_status_idx"));
  assert.ok(INDEX_RECOMMENDATIONS.some((item) => item.key === "company_location_status_activity"));
});
