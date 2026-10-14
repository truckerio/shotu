import assert from "node:assert/strict";
import test from "node:test";
import { listPartStockMovements } from "./local-inventory.repo.js";

const scope = { catalogPartId: "part", companyIds: ["company"], locationIds: ["shop"], isAdmin: false, locationId: "shop", view: "workorder", page: 4 };
test("movement pagination has exact scoped totals even for an empty out-of-range page", async () => {
  const calls = [];
  const result = await listPartStockMovements(scope, { query: async (sql, values) => {
    calls.push({ sql, values });
    return { rows: calls.length === 1 ? [] : [{total:57}] };
  }});
  assert.equal(result.total, 57);
  assert.equal(result.pageCount, 3);
  assert.equal(result.pageSize, 25);
  assert.equal(result.hasMore, false);
  assert.deepEqual(result.items, []);
  for (const call of calls) {
    assert.match(call.sql, /movement.company_id=any\(\$2::uuid\[\]\)/);
    assert.match(call.sql, /movement.location_id=any\(\$3::uuid\[\]\)/);
    assert.match(call.sql, /\$6::text='audit' or movement.workorder_id is not null/);
    assert.deepEqual(call.values.slice(0,6), ["part",["company"],["shop"],false,"shop","workorder"]);
  }
  assert.match(calls[0].sql, /order by movement.created_at desc,movement.id desc/);
  assert.equal(calls[0].values[6],75);
});
test("movement count failure is exposed instead of fabricating rail totals", async () => {
  let calls=0;
  await assert.rejects(() => listPartStockMovements(scope, {query:async()=>{if(++calls===2)throw new Error("count unavailable");return{rows:[]};}}), /count unavailable/);
});
