import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { getInventoryReports } from "./inventory-reports.service.js";

test("inventory reports project a bounded shop-scoped custody summary and lineage without writes", async () => {
  const companyId = randomUUID();
  const locationId = randomUUID();
  const actorId = randomUUID();
  const queries = [];
  const custodyItems = Array.from({ length: 101 }, (_, index) => ({
    id: randomUUID(),
    status: index === 0 ? "awaiting_handoff" : "released",
    serial_number: `SERIAL-${index}`,
    invoice_number: index === 0 ? null : "INV-7",
    unit_cost: index === 0 ? null : "42.0000",
    position_id: index === 0 ? null : randomUUID(),
  }));
  const responses = [
    { rows: [] },
    { rows: [{ company_id: companyId, name: "Chino Yard" }] },
    { rows: [] },
    { rows: [] },
    { rows: [] },
    { rows: [{ receipt_lines: 0, unknown_cost_lines: 0 }] },
    { rows: [] },
    { rows: [{
      awaiting_handoff: 1,
      pending_inspection: 2,
      hold: 3,
      repair: 4,
      quarantine: 5,
      core_pending: 6,
      scrap_pending: 7,
      released_exact_position: 8,
      core_returned: 9,
      scrapped: 10,
    }] },
    { rows: custodyItems },
    { rows: [] },
    { rows: [] },
    { rows: [] },
    { rows: [] },
    { rows: [] },
    { rows: [] },
    { rows: [] },
    { rows: [] },
  ];
  const client = {
    async query(sql, values = []) {
      queries.push({ sql, values });
      const response = responses.shift();
      assert.ok(response, `Unexpected query: ${sql}`);
      return response;
    },
    release() {},
  };
  const context = {
    actor: { id: actorId, role: "admin" },
    companyIds: new Set([companyId]),
    locationIds: new Set(),
    companyRoles: new Map([[companyId, "admin"]]),
  };

  const result = await getInventoryReports(
    new URLSearchParams({ locationId, page: "1" }),
    context,
    { pool: { connect: async () => client } },
  );

  assert.equal(result.custody.items.length, 100);
  assert.equal(result.custody.hasMore, true);
  assert.equal(result.custody.limit, 100);
  assert.equal(result.custody.summary.released_exact_position, 8);
  assert.equal(result.custody.items[0].invoice_number, null);
  assert.equal(result.custody.items[0].unit_cost, null);

  const custodySql = queries.find(({ sql }) => /from inventory_reuse_cases c/.test(sql));
  assert.ok(custodySql);
  assert.deepEqual(custodySql.values, [companyId, locationId, 101]);
  assert.match(custodySql.sql, /c\.company_id=\$1 and c\.location_id=\$2/);
  assert.match(custodySql.sql, /c\.release_position_id/);
  assert.match(custodySql.sql, /original_workorder\.serial as original_workorder_serial/);
  assert.match(custodySql.sql, /receipt\.invoice_run_id/);
  assert.match(custodySql.sql, /line\.currency,line\.unit_cost,line\.cost_source/);
  assert.match(custodySql.sql, /limit \$3/);
  assert.equal(queries.some(({ sql }) => /^\s*(insert|update|delete)\b/i.test(sql)), false);
  assert.equal(queries.at(-1).sql, "commit");
});
