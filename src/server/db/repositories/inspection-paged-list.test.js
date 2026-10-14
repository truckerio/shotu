import assert from "node:assert/strict";
import test from "node:test";
import { listInspections } from "./inspections.repo.js";

const companyId = "11111111-1111-4111-8111-111111111111";
const locationId = "22222222-2222-4222-8222-222222222222";
const actorId = "33333333-3333-4333-8333-333333333333";
const inspectionId = "44444444-4444-4444-8444-444444444444";
const scopedInput = {
  companyIds: [companyId], locationIds: [locationId], statuses: ["requested", "assigned"],
  unitType: "Truck", result: "passed", mechanicId: actorId, search: "T12",
  restrictedMechanicCompanyIds: [companyId], actorId, needsAction: true,
  limit: 20, page: 2,
};

test("paged inspections count and select from the same tenant- and role-filtered snapshot", async () => {
  let sql, values, calls = 0;
  const result = await listInspections(scopedInput, { query: async (statement, args) => {
    calls += 1; sql = statement; values = args;
    return { rows: [{ id: inspectionId, company_id: companyId, location_id: locationId, version: 1, total: "43" }] };
  } });
  assert.equal(calls, 1);
  assert.match(sql, /with filtered as \(select inspection\.\* from inspections inspection where inspection\.company_id=any\(\$1::uuid\[\]\)/);
  assert.match(sql, /inspection\.location_id=any\(\$2::uuid\[\]\)/);
  assert.match(sql, /inspection\.status=any\(\$3::text\[\]\)/);
  assert.match(sql, /inspection\.unit_type=\$4/);
  assert.match(sql, /inspection\.result=\$5/);
  assert.match(sql, /ia\.mechanic_user_id=\$6/);
  assert.match(sql, /inspection\.company_id=any\(\$11::uuid\[\]\)/);
  assert.match(sql, /restricted_assignment\.mechanic_user_id=\$12::uuid/);
  assert.match(sql, /not \$13::boolean/);
  assert.match(sql, /inspection\.inspection_number ilike '%'\|\|\$7\|\|'%'/);
  assert.match(sql, /totals as \(select count\(\*\)::bigint as total from filtered\)/);
  assert.match(sql, /selected as \(select \* from filtered order by updated_at desc,id desc limit \$10 offset \$14\)/);
  assert.deepEqual(values, [[companyId], [locationId], ["requested", "assigned"], "Truck", "passed", actorId, "T12", null, null, 20, [companyId], actorId, true, 20]);
  assert.deepEqual({ page: result.page, total: result.total, pageCount: result.pageCount, nextCursor: result.nextCursor },
    { page: 2, total: 43, pageCount: 3, nextCursor: null });
  assert.equal(result.items[0].id, inspectionId);
});

for (const [sort, direction] of [[undefined, "desc"], ["updated_desc", "desc"], ["updated_asc", "asc"]]) {
  test(`paged inspections use stable ${sort || "default"} order`, async () => {
    let sql;
    await listInspections({ ...scopedInput, sort }, { query: async (statement) => {
      sql = statement;
      return { rows: [{ id: inspectionId, version: 1, total: "1" }] };
    } });
    assert.match(sql, new RegExp(`selected as \\(select \\* from filtered order by updated_at ${direction},id ${direction} limit`));
    assert.match(sql, new RegExp(`order by inspection\\.updated_at ${direction},inspection\\.id ${direction}$`));
  });
}

test("paged inspections retain the exact total on an out-of-range page", async () => {
  const result = await listInspections({ ...scopedInput, page: 4 }, { query: async (_sql, values) => {
    assert.equal(values[13], 60);
    return { rows: [{ id: null, total: "45" }] };
  } });
  assert.deepEqual(result, { items: [], page: 4, total: 45, pageCount: 3, nextCursor: null });
});

test("paged inspections report zero total and zero pages for an empty scope", async () => {
  const result = await listInspections({ ...scopedInput, companyIds: [], page: 1 }, { query: async (_sql, values) => {
    assert.deepEqual(values[0], []);
    return { rows: [{ id: null, total: "0" }] };
  } });
  assert.deepEqual(result, { items: [], page: 1, total: 0, pageCount: 0, nextCursor: null });
});
