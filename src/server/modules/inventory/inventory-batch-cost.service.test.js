import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { permissionsForRole } from "../../auth/permissions.js";
import { correctInventoryBatchCost } from "./inventory-batch-cost.service.js";
import { resolveInventoryResourceScope } from "./inventory-effective-scope.js";

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
const resourceScope = () => ({ companyIds: [companyId], locationIds: [locationId], isAdmin: false, effectiveRole: "office" });

test("batch cost correction is versioned, scoped and hashes the canonical command", async () => {
  let received;
  const body = { expectedVersion: 0, unitCost: "12.5000", currency: "usd", reason: "Legacy opening cost", idempotencyKey: "batch-cost-request-1" };
  const result = await correctInventoryBatchCost(layerId, body, context(), {
    resolveResourceScope: resourceScope,
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
  await assert.rejects(() => correctInventoryBatchCost(layerId, body, context(), { resolveResourceScope: resourceScope, append: async () => ({ kind: "stale" }) }), (error) => error.code === "INVENTORY_BATCH_COST_STALE");
  await assert.rejects(() => correctInventoryBatchCost(layerId, body, context(), { resolveResourceScope: resourceScope, append: async () => ({ kind: "idempotency_conflict" }) }), (error) => error.code === "INVENTORY_BATCH_COST_REPLAY_CONFLICT");
  await assert.rejects(() => correctInventoryBatchCost(layerId, body, context(), { resolveResourceScope: resourceScope, append: async () => ({ kind: "not_found" }) }), (error) => error.statusCode === 404);
});

test("batch correction resolves the target company before write across mixed roles", async () => {
  const otherCompanyId = "55555555-5555-4555-8555-555555555555";
  const otherLocationId = "66666666-6666-4666-8666-666666666666";
  const body = { expectedVersion: 0, unitCost: "8.25", currency: "USD", reason: "Verified allocation", idempotencyKey: "mixed-batch-cost-1" };
  const mixed = {
    ...context("admin"),
    companyIds: new Set([companyId, otherCompanyId]),
    locationIds: new Set([otherLocationId]),
    companyRoles: new Map([[companyId, "admin"], [otherCompanyId, "mechanic"]]),
  };
  const resolveResourceScope = (requestContext, type, id, options) => resolveInventoryResourceScope(requestContext, type, id, {
    ...options,
    query: async () => ({ rows: [{ company_id: otherCompanyId, location_id: otherLocationId }] }),
  });
  await assert.rejects(correctInventoryBatchCost(layerId, body, mixed, {
    resolveResourceScope,
    append: async () => assert.fail("mechanic-company write reached persistence"),
  }), (error) => error.statusCode === 403);
  let received;
  await correctInventoryBatchCost(layerId, body, { ...mixed, companyRoles: new Map([[companyId, "admin"], [otherCompanyId, "office"]]) }, {
    resolveResourceScope,
    append: async (input) => (received = input, { kind: "saved", revision: {}, replayed: false }),
  });
  assert.deepEqual(received.companyIds, [otherCompanyId]);
  assert.equal(received.isAdmin, false);
  await correctInventoryBatchCost(layerId, body, { ...mixed, companyRoles: new Map([[companyId, "admin"], [otherCompanyId, "office"]]) }, {
    resolveResourceScope: (requestContext, type, id, options) => resolveInventoryResourceScope(requestContext, type, id, {
      ...options, query: async () => ({ rows: [{ company_id: companyId, location_id: locationId }] }),
    }),
    append: async (input) => (received = input, { kind: "saved", revision: {}, replayed: false }),
  });
  assert.deepEqual(received.companyIds, [companyId]);
  assert.equal(received.isAdmin, true);
});
