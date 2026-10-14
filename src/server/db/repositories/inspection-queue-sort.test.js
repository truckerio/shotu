import assert from "node:assert/strict";
import test from "node:test";
import { listInspections, encodeInspectionCursor } from "./inspections.repo.js";
import { inspectionListSchema } from "../../modules/inspections/inspection.schemas.js";

test("inspection query schema validates global sort and existing filters", () => {
  assert.equal(inspectionListSchema.parse({}).sort, "updated_desc");
  assert.equal(inspectionListSchema.parse({ sort: "updated_asc", unitType: "Trailer", result: "passed" }).sort, "updated_asc");
  assert.equal(inspectionListSchema.safeParse({ sort: "updated_at; drop table inspections" }).success, false);
});

for (const [sort, direction, comparator] of [["updated_desc", "desc", "<"], ["updated_asc", "asc", ">"]]) {
  test(`inspection ${sort} pagination uses the matching stable cursor boundary`, async () => {
    const rows = ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"].map(id => ({ id, updated_at: "2026-10-14T12:00:00.000Z", version: 1 }));
    let statement, values;
    const page = await listInspections({ companyIds: ["company"], locationIds: [], sort, unitType: "Truck", result: "passed", limit: 1, cursor: encodeInspectionCursor(rows[0]) }, { query: async (sql, args) => { statement = sql; values = args; return { rows }; } });
    assert.ok(statement.includes(`(inspection.updated_at,inspection.id)${comparator}($8::timestamptz,$9::uuid)`));
    assert.ok(statement.includes(`order by inspection.updated_at ${direction},inspection.id ${direction}`));
    assert.equal(values[3], "Truck"); assert.equal(values[4], "passed");
    assert.equal(values[8], rows[0].id); assert.equal(page.items.length, 1);
    assert.equal(page.nextCursor, encodeInspectionCursor(rows[0]));
  });
}
