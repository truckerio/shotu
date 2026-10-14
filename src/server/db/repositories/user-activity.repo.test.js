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
  assert.deepEqual(captured.params, [context.actor.id, [...context.companyIds], [...context.locationIds], [], ["22222222-2222-4222-8222-222222222222"], "workorders", 10, 10]);
  assert.match(captured.sql, /created_by_user_id=\$1/);
  assert.match(captured.sql, /movement\.actor_id=\$1/);
  assert.match(captured.sql, /part\.created_by=\$1/);
  assert.match(captured.sql, /activity\.company_id=any\(\$2::uuid\[\]\)/);
  assert.match(captured.sql, /activity\.location_id=any\(\$3::uuid\[\]\)/);
  assert.match(captured.sql, /activity\.action not like 'pricing\.%'.*activity\.company_id=any\(\$5::uuid\[\]\)/s);
  assert.match(captured.sql, /event\.field_key like 'pricing\.%'[\s\S]*changed from[\s\S]*event\.old_value[\s\S]*event\.new_value/);
  assert.deepEqual(result, { items: [{ id: "workorder:1", category: "workorders" }], page: 2, pageSize: 10, total: 11, hasMore: false });
});

test("admin activity retains company scope while allowing every location only in admin companies", async () => {
  let params;
  await listUserActivity({ actor: { id: "actor", role: "admin" }, companyIds: new Set(["company"]), locationIds: new Set() }, {}, { query: async (_sql, values) => { params = values; return { rows: [] }; } });
  assert.deepEqual(params[3], ["company"]);
  assert.deepEqual(params[4], ["company"]);
});

test("mixed roles partition unrestricted activity visibility by admin company", async () => {
  let params;
  const context = {
    actor: { id: "actor", role: "admin" },
    companyIds: new Set(["admin-company", "mechanic-company"]),
    companyRoles: new Map([["admin-company", "admin"], ["mechanic-company", "mechanic"]]),
    locationIds: new Set(["assigned-location"]),
  };
  await listUserActivity(context, {}, { query: async (_sql, values) => { params = values; return { rows: [] }; } });
  assert.deepEqual(params[1], ["admin-company", "mechanic-company"]);
  assert.deepEqual(params[2], ["assigned-location"]);
  assert.deepEqual(params[3], ["admin-company"]);
  assert.deepEqual(params[4], ["admin-company"]);
});
