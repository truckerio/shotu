import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { permissionsForRole } from "../../auth/permissions.js";
import { correctInventoryBatchCost } from "./inventory-batch-cost.service.js";

const companyId = "11111111-1111-4111-8111-111111111111";
const locationId = "22222222-2222-4222-8222-222222222222";
const layerId = "33333333-3333-4333-8333-333333333333";
const actorId = "44444444-4444-4444-8444-444444444444";
const context = (role = "office") => ({
  actor: { id: actorId, role },
  permissions: permissionsForRole(role),
  companyIds: new Set([companyId]),
  locationIds: new Set([locationId]),
});

test("batch cost correction is versioned, scoped and hashes the canonical command", async () => {
  let received;
  const body = { expectedVersion: 0, unitCost: "12.5000", currency: "usd", reason: "Legacy opening cost", idempotencyKey: "batch-cost-request-1" };
  const result = await correctInventoryBatchCost(layerId, body, context(), {
    append: async (input) => {
      received = input;
      return { kind: "saved", revision: { version: 1, unitCost: input.unitCost, currency: input.currency }, replayed: false };
    },
  });
  assert.equal(result.revision.version, 1);
  assert.deepEqual(received.companyIds, [companyId]);
  assert.deepEqual(received.locationIds, [locationId]);
  assert.equal(received.currency, "USD");
  const command = { costLayerId: layerId, expectedVersion: 0, unitCost: "12.5000", currency: "USD", reason: "Legacy opening cost" };
  assert.equal(received.requestHash, createHash("sha256").update(JSON.stringify(command)).digest("hex"));
});

test("batch cost correction rejects unauthorized, invalid, stale and replay-conflict writes", async () => {
  const body = { expectedVersion: 1, unitCost: "8.25", currency: "USD", reason: "Corrected invoice allocation", idempotencyKey: "batch-cost-request-2" };
  await assert.rejects(() => correctInventoryBatchCost(layerId, body, { ...context(), permissions: new Set() }, { append: () => assert.fail("Unauthorized write reached persistence") }), (error) => error.statusCode === 403);
  await assert.rejects(() => correctInventoryBatchCost(layerId, { ...body, unitCost: -1 }, context(), { append: () => assert.fail("Invalid write reached persistence") }));
  await assert.rejects(() => correctInventoryBatchCost(layerId, body, context(), { append: async () => ({ kind: "stale" }) }), (error) => error.code === "INVENTORY_BATCH_COST_STALE");
  await assert.rejects(() => correctInventoryBatchCost(layerId, body, context(), { append: async () => ({ kind: "idempotency_conflict" }) }), (error) => error.code === "INVENTORY_BATCH_COST_REPLAY_CONFLICT");
  await assert.rejects(() => correctInventoryBatchCost(layerId, body, context(), { append: async () => ({ kind: "not_found" }) }), (error) => error.statusCode === 404);
});
