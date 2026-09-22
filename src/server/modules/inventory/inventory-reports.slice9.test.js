import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { getInventoryReports } from "./inventory-reports.service.js";

function context(companyId, locationId, role = "office") {
  return {
    actor: { id: randomUUID(), role },
    companyIds: new Set([companyId]),
    locationIds: new Set([locationId]),
    companyRoles: new Map([[companyId, role]]),
  };
}

test("Slice 9 report projections stay bounded, scoped, and preserve nullable evidence", async () => {
  const companyId = randomUUID();
  const locationId = randomUUID();
  const responses = [
    { rows: [{ company_id: companyId, name: "Shop" }] },
    { rows: [] }, { rows: [] }, { rows: [] }, { rows: [{ receipt_lines: 0, unknown_cost_lines: 0 }] }, { rows: [] },
    { rows: [{ awaiting_handoff: 0 }] }, { rows: [] },
    { rows: [{ inventory_item_id: "item", uom_code: "ea", item_quantity_on_hand: "3", position_quantity: null, quantity_delta: null }] },
    { rows: [{ order_id: "po", line_ids: ["line"], remaining_quantity: "2", remaining_value: null, purchaser_id: "buyer" }] },
    { rows: [{ delivery_id: "delivery", invoice_run_id: "invoice", known_cost_lines: 1, unknown_cost_lines: 1, known_cost_total: null }] },
    { rows: [{ kind: "count", status: "recount", count: 1, open_exception_count: 0 }] },
    { rows: [{ task_id: "task", kind: "count", status: "recount", discrepancy_ids: null }] },
    { rows: [{ approval_request_id: "request", amount: null, vendor: null, purchaser_id: "buyer", approver_id: null, receipt_id: null }] },
    { rows: [{ month: "2026-09-01", currency: null, count: 1, amount: null }] },
  ];
  const queries = [];
  const client = {
    async query(sql, values = []) {
      queries.push({ sql, values });
      if (sql === "begin isolation level repeatable read read only" || sql === "commit") return { rows: [] };
      const response = responses.shift();
      assert.ok(response, `Unexpected query: ${sql}`);
      return response;
    },
    release() {},
  };
  const result = await getInventoryReports(new URLSearchParams({ locationId }), context(companyId, locationId), { pool: { connect: async () => client } });

  assert.equal(result.reconciliation.rows[0].quantity_delta, null);
  assert.equal(result.openPurchaseOrders.items[0].remaining_value, null);
  assert.equal(result.receiptBatches.items[0].known_cost_total, null);
  assert.equal(result.tasks.items[0].task_id, "task");
  assert.equal(result.noPo.items[0].amount, null);
  assert.equal(result.noPo.trend[0].amount, null);
  assert.equal(result.noPo.trend[0].currency, null);
  assert.equal(result.reconciliation.limit, 100);
  assert.equal(result.openPurchaseOrders.limit, 100);
  assert.equal(result.receiptBatches.limit, 100);
  assert.equal(result.tasks.limit, 100);
  for (const query of queries) assert.doesNotMatch(query.sql, /^\s*(insert|update|delete)\b/i);
  assert.match(queries.find(({ sql }) => /inventory_position_balances/.test(sql)).sql, /b\.uom_code=i\.uom_code/);
  const deliveryReport = queries.find(({ sql }) => /inventory_purchase_deliveries/.test(sql)).sql;
  assert.match(deliveryReport, /\{vendorName,value\}/);
  assert.match(deliveryReport, /count\(rl\.id\) filter\(where rl\.id is not null and rl\.unit_cost is null\)/);
  const commitments = queries.find(({ sql }) => /inventory_purchase_orders/.test(sql) && /priced_commitment/.test(sql)).sql;
  assert.match(commitments, /'partially_received'/);
  assert.doesNotMatch(commitments, /'received'/);
  const tasks = queries.filter(({ sql }) => /from inventory_stock_tasks t/.test(sql) && (/group by t\.kind,t\.status/.test(sql) || /discrepancy_ids/.test(sql)));
  assert.equal(tasks.length, 2);
  for (const query of tasks) assert.match(query.sql, /transfer.*received.*completed/s);
  const noPoDetail = queries.find(({ sql }) => /inventory_direct_receipt_approval_requests/.test(sql) && /limit \$3/.test(sql)).sql;
  assert.match(noPoDetail, /receipt\.company_id=\$1 and receipt\.location_id=\$2/);
  assert.doesNotMatch(noPoDetail, /source_reference,''\)\) as vendor/);
  const trend = queries.find(({ sql }) => /trendMonths/.test(sql))?.sql || queries.at(-2).sql;
  assert.match(trend, /month,currency/);
  assert.match(trend, /group by 1,2/);
});

test("Slice 9 report location lookup denies a location outside the tenant before projections run", async () => {
  const companyId = randomUUID();
  const locationId = randomUUID();
  let projectionQueries = 0;
  const client = {
    async query(sql) {
      if (/^(begin|rollback)/i.test(sql)) return { rows: [] };
      if (/from locations/.test(sql)) return { rows: [] };
      projectionQueries += 1;
      return { rows: [] };
    },
    release() {},
  };
  await assert.rejects(
    () => getInventoryReports(new URLSearchParams({ locationId }), context(companyId, locationId), { pool: { connect: async () => client } }),
    (error) => error.statusCode === 404,
  );
  assert.equal(projectionQueries, 0);
});
