import assert from "node:assert/strict";
import test from "node:test";
import { officeDashboard } from "./office.service.js";

test("office dashboard includes assigned mechanics without workorders", async () => {
  const queriedCategories = [];
  const locationIds = new Set([
    "11111111-1111-1111-1111-111111111111",
    "22222222-2222-2222-2222-222222222222",
  ]);
  const mechanics = [
    { id: "mechanic-1", name: "Mechanic One", locationIds: [...locationIds] },
    { id: "mechanic-2", name: "Mechanic Two", locationIds: [...locationIds] },
  ];

  const dashboard = await officeDashboard(
    { locationIds },
    {
      queryWorkorders: async (_context, input) => {
        queriedCategories.push(input.category);
        return { items: [], total: 0 };
      },
      listMechanics: async (authorizedLocationIds) => {
        assert.deepEqual(authorizedLocationIds, [...locationIds]);
        return mechanics;
      },
    },
  );

  assert.deepEqual(dashboard.mechanics, mechanics);
  assert.deepEqual(dashboard.counts, {
    open: 0,
    active: 0,
    parts: 0,
    done: 0,
    closed: 0,
  });
  assert.deepEqual(queriedCategories, ["unassigned", "active", "parts", "ready_review", "all"]);
});
