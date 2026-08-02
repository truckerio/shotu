import assert from "node:assert/strict";
import test from "node:test";
import { ENDPOINT_BUDGETS, READ_ROUTES } from "./route-catalog.js";

test("every supported role has safe reads and every route has a p95 budget", () => {
  assert.deepEqual(Object.keys(READ_ROUTES), ["admin", "office", "mechanic", "surveillance"]);
  for (const [role, routes] of Object.entries(READ_ROUTES)) {
    assert.ok(routes.length >= 2, `${role} must exercise identity and domain reads`);
    for (const route of routes) {
      assert.match(route.path, /^\/api\//);
      assert.equal(typeof ENDPOINT_BUDGETS[route.label], "number", `${route.label} is missing a budget`);
    }
  }
});
