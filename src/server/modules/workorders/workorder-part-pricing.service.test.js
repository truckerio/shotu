import assert from "node:assert/strict";
import test from "node:test";
import { selectWorkorderPartPrice } from "./workorder-part-pricing.service.js";

const workorderId = "11111111-1111-4111-8111-111111111111";
const usageId = "22222222-2222-4222-8222-222222222222";
const input = {
  operation: "partPriceSelection",
  usageKind: "serialized",
  usageId,
  selection: "batch_cost",
  reason: "Use exact batch cost",
  idempotencyKey: "part-price-test-1",
};
const workorderAccess = { requireAccess: async () => ({ companyId: workorderId, locationId: usageId }) };

test("mechanic cannot select or read a workorder financial price", async () => {
  await assert.rejects(
    () => selectWorkorderPartPrice(
      workorderId,
      input,
      { actor: { id: usageId, role: "mechanic" }, companyIds: new Set([workorderId]), companyRoles: new Map([[workorderId, "mechanic"]]), locationIds: new Set([usageId]) },
      { ...workorderAccess, savePartPrice: async () => { throw new Error("must not run"); } },
    ),
    (error) => error.code === "WORKORDER_PART_PRICE_FORBIDDEN" && error.statusCode === 403,
  );
});

test("office selection uses authenticated scope and maps missing exact batch cost", async () => {
  let received;
  const context = {
    actor: { id: usageId, role: "office" },
    companyIds: new Set([workorderId]),
    companyRoles: new Map([[workorderId, "office"]]),
    locationIds: new Set([usageId]),
  };
  await assert.rejects(
    () => selectWorkorderPartPrice(workorderId, input, context, {
      ...workorderAccess,
      savePartPrice: async (value) => {
        received = value;
        return { kind: "batch_cost_unavailable" };
      },
    }),
    (error) => error.code === "WORKORDER_BATCH_COST_UNAVAILABLE" && error.statusCode === 422,
  );
  assert.deepEqual(received.companyIds, [workorderId]);
  assert.deepEqual(received.locationIds, [usageId]);
  assert.equal(received.actorId, usageId);
});

test("office prices no-stock by server-owned line id and rejects batch cost", async () => {
  const noStockLineId = "33333333-3333-4333-8333-333333333333";
  const noStockInput = {
    operation: "partPriceSelection",
    usageKind: "no_stock",
    noStockLineId,
    selection: "selling_price",
    reason: "Use configured selling policy",
    idempotencyKey: "part-price-no-stock-1",
  };
  let received;
  const result = await selectWorkorderPartPrice(workorderId, noStockInput, {
    actor: { id: usageId, role: "office" },
    companyIds: new Set([workorderId]),
    companyRoles: new Map([[workorderId, "office"]]),
    locationIds: new Set([usageId]),
  }, {
    ...workorderAccess,
    savePartPrice: async (value) => {
      received = value;
      return { kind: "saved", snapshot: { noStockLineId } };
    },
  });
  assert.equal(received.noStockLineId, noStockLineId);
  assert.equal(Object.hasOwn(received, "usageId"), false);
  assert.equal(result.snapshot.noStockLineId, noStockLineId);

  const configured = await selectWorkorderPartPrice(workorderId, { ...noStockInput, selection: "internal_cost" }, {
    actor: { id: usageId, role: "office" }, companyIds: new Set([workorderId]),
    companyRoles: new Map([[workorderId, "office"]]), locationIds: new Set([usageId]),
  }, { ...workorderAccess, savePartPrice: async (value) => ({ kind: "saved", snapshot: { selection: value.selection } }) });
  assert.equal(configured.snapshot.selection, "internal_cost");

  await assert.rejects(
    () => selectWorkorderPartPrice(workorderId, { ...noStockInput, selection: "batch_cost" }, {
      actor: { id: usageId, role: "office" }, companyIds: new Set([workorderId]), companyRoles: new Map([[workorderId, "office"]]), locationIds: new Set([usageId]),
    }, workorderAccess),
    (error) => error.code === "WORKORDER_BATCH_COST_UNAVAILABLE" && error.statusCode === 422,
  );
});

test("primary admin cannot price a workorder in a mechanic-only company", async () => {
  const adminCompany = "44444444-4444-4444-8444-444444444444";
  const context = {
    actor: { id: usageId, role: "admin" },
    companyIds: new Set([adminCompany, workorderId]),
    companyRoles: new Map([[adminCompany, "admin"], [workorderId, "mechanic"]]),
    locationIds: new Set([usageId]),
  };
  await assert.rejects(() => selectWorkorderPartPrice(workorderId, input, context, {
    ...workorderAccess,
    savePartPrice: async () => { throw new Error("must not price"); },
  }), { code: "WORKORDER_PART_PRICE_FORBIDDEN", statusCode: 403 });
});
