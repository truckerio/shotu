import assert from "node:assert/strict";
import test from "node:test";
import { listUserActivity, normalizeUserActivityQuery } from "./user-activity.repo.js";

test("activity query normalization allowlists categories and bounds pagination", () => {
  assert.deepEqual(normalizeUserActivityQuery({ category: "inventory", page: "2", pageSize: "25" }), { category: "inventory", page: 2, pageSize: 25 });
  assert.deepEqual(normalizeUserActivityQuery({ category: "secrets", page: "-1", pageSize: "900" }), { category: "", page: 1, pageSize: 100 });
});

test("activity projection binds the current actor and current tenant/location scope", async () => {
  let captured;
  const context = {
    actor: { id: "11111111-1111-4111-8111-111111111111", role: "office" },
    companyIds: new Set(["22222222-2222-4222-8222-222222222222"]),
    locationIds: new Set(["33333333-3333-4333-8333-333333333333"]),
  };
  const result = await listUserActivity(context, { category: "workorders", page: 2, pageSize: 10 }, {
    query: async (sql, params) => {
      captured = { sql, params };
      return { rows: [{ id: "workorder:1", total_count: 11, category: "workorders" }] };
    },
  });
  assert.deepEqual(captured.params, [context.actor.id, [...context.companyIds], [...context.locationIds], false, "workorders", 10, 10]);
  assert.match(captured.sql, /created_by_user_id=\$1/);
  assert.match(captured.sql, /movement\.actor_id=\$1/);
  assert.match(captured.sql, /part\.created_by=\$1/);
  assert.match(captured.sql, /activity\.company_id=any\(\$2::uuid\[\]\)/);
  assert.match(captured.sql, /activity\.location_id=any\(\$3::uuid\[\]\)/);
  assert.deepEqual(result, { items: [{ id: "workorder:1", category: "workorders" }], page: 2, pageSize: 10, total: 11, hasMore: false });
});

test("admin activity retains company scope while allowing every company location", async () => {
  let params;
  await listUserActivity({ actor: { id: "actor", role: "admin" }, companyIds: new Set(["company"]), locationIds: new Set() }, {}, { query: async (_sql, values) => { params = values; return { rows: [] }; } });
  assert.equal(params[3], true);
});
