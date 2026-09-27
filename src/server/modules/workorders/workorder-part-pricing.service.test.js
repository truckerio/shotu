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

test("mechanic cannot select or read a workorder financial price", async () => {
  await assert.rejects(
    () => selectWorkorderPartPrice(
      workorderId,
      input,
      { actor: { id: usageId, role: "mechanic" }, companyIds: new Set(), locationIds: new Set() },
      { savePartPrice: async () => { throw new Error("must not run"); } },
    ),
    (error) => error.code === "WORKORDER_PART_PRICE_FORBIDDEN" && error.statusCode === 403,
  );
});

test("office selection uses authenticated scope and maps missing exact batch cost", async () => {
  let received;
  const context = {
    actor: { id: usageId, role: "office" },
    companyIds: new Set([workorderId]),
    locationIds: new Set([usageId]),
  };
  await assert.rejects(
    () => selectWorkorderPartPrice(workorderId, input, context, {
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
