import assert from "node:assert/strict";
import test from "node:test";
import { approveRecommendedFulfillment, recommendPartFulfillment } from "./part-fulfillment.service.js";

const ids = { company: "11111111-1111-4111-8111-111111111111", workorder: "22222222-2222-4222-8222-222222222222", part: "33333333-3333-4333-8333-333333333333", destination: "44444444-4444-4444-8444-444444444444", source: "55555555-5555-4555-8555-555555555555" };
const context = { actor: { id: "66666666-6666-4666-8666-666666666666", role: "admin" }, companyIds: new Set([ids.company]), locationIds: new Set([ids.destination, ids.source]) };
const input = { workorderId: ids.workorder, catalogPartId: ids.part, destinationLocationId: ids.destination, quantity: 2, uomCode: "ea", neededBy: null, idempotencyKey: "request-key-123" };
function dependencies(availability = []) { return { authorizeModule: async () => true, loadWorkorder: async () => ({ id: ids.workorder, companyId: ids.company, locationId: ids.destination, status: "in_progress" }), loadCatalogPart: async () => ({ id: ids.part, uomCode: "ea" }), findAvailability: async () => availability, createFulfillment: async (value) => ({ kind: "created", fulfillment: { id: "f1", workorderId: ids.workorder, companyId: ids.company, destinationLocationId: ids.destination, state: "recommended", recommendationVersion: 1, legs: value.legs } }) }; }

test("recommends destination stock before transfers", async () => {
  const result = await recommendPartFulfillment(input, context, dependencies([{ id: "stock", locationId: ids.destination, quantityAvailable: 2, uomCode: "ea" }, { id: "source", locationId: ids.source, quantityAvailable: 10, uomCode: "ea" }]));
  assert.equal(result.fulfillment.legs[0].routeType, "destination_stock");
  assert.equal(result.fulfillment.legs[0].state, "proposed");
});
test("uses transfer plus backorder for partial source availability", async () => {
  const result = await recommendPartFulfillment({ ...input, quantity: 3 }, context, dependencies([{ id: "source", locationId: ids.source, quantityAvailable: 2, uomCode: "ea" }]));
  assert.deepEqual(result.fulfillment.legs.map(({ state, quantity }) => ({ state, quantity })), [{ state: "ready_for_transfer", quantity: 2 }, { state: "backordered", quantity: 1 }]);
});
test("records no stock as a manual-decision backorder", async () => {
  const result = await recommendPartFulfillment(input, context, dependencies());
  assert.equal(result.fulfillment.legs[0].state, "backordered");
});
test("rejects cross-company and destination mismatch before persistence", async () => {
  await assert.rejects(recommendPartFulfillment(input, context, { ...dependencies(), loadWorkorder: async () => ({ companyId: "77777777-7777-4777-8777-777777777777", locationId: ids.destination }) }), /not found/i);
  await assert.rejects(recommendPartFulfillment({ ...input, destinationLocationId: ids.source }, context, dependencies()), /Destination must match/i);
});
test("rejects unsupported quantity and unit", async () => {
  await assert.rejects(recommendPartFulfillment({ ...input, quantity: 0 }, context, dependencies()), />0/i);
  await assert.rejects(recommendPartFulfillment({ ...input, uomCode: "nope" }, context, dependencies()), /Invalid option/i);
});
test("turns replay conflict into 409-compatible inventory error", async () => {
  await assert.rejects(recommendPartFulfillment(input, context, { ...dependencies(), createFulfillment: async () => ({ kind: "conflict" }) }), (error) => error.code === "PART_FULFILLMENT_REPLAY_CONFLICT" && error.statusCode === 409);
});
test("rejects stale recommendation approval", async () => {
  await assert.rejects(approveRecommendedFulfillment("f1", { recommendationVersion: 1, idempotencyKey: "approve-key-123" }, context, { ...dependencies(), getFulfillment: async () => ({ workorderId: ids.workorder, companyId: ids.company, destinationLocationId: ids.destination, state: "recommended", recommendationVersion: 2 }) }), (error) => error.code === "PART_FULFILLMENT_RECOMMENDATION_STALE");
});
test("allows an exact approval replay and rejects a changed approval replay", async () => {
  const existing = { workorderId: ids.workorder, companyId: ids.company, destinationLocationId: ids.destination, state: "approved", recommendationVersion: 1 };
  const replay = await approveRecommendedFulfillment("f1", { recommendationVersion: 1, idempotencyKey: "approve-key-123" }, context, {
    ...dependencies(),
    getFulfillment: async () => existing,
    approveFulfillment: async (approval) => ({ kind: "replay", fulfillment: { ...existing, id: "f1", approval } }),
  });
  assert.equal(replay.replayed, true);
  await assert.rejects(
    approveRecommendedFulfillment("f1", { recommendationVersion: 1, idempotencyKey: "approve-key-456" }, context, {
      ...dependencies(),
      getFulfillment: async () => existing,
      approveFulfillment: async () => ({ kind: "conflict" }),
    }),
    (error) => error.code === "PART_FULFILLMENT_APPROVAL_REPLAY_CONFLICT" && error.statusCode === 409,
  );
});

test("requires canonical Parts write access before recommendation or approval", async () => {
  const denied = async () => { throw new Error("Parts module is read only."); };
  await assert.rejects(
    recommendPartFulfillment(input, context, { ...dependencies(), authorizeModule: denied }),
    /read only/i,
  );
  await assert.rejects(
    approveRecommendedFulfillment("f1", { recommendationVersion: 1, idempotencyKey: "approve-key-789" }, context, {
      ...dependencies(),
      authorizeModule: denied,
      getFulfillment: async () => ({ workorderId: ids.workorder, companyId: ids.company, destinationLocationId: ids.destination, state: "recommended", recommendationVersion: 1 }),
    }),
    /read only/i,
  );
});

test("rejects approval after the workorder becomes terminal", async () => {
  await assert.rejects(
    approveRecommendedFulfillment("f1", { recommendationVersion: 1, idempotencyKey: "approve-key-terminal" }, context, {
      ...dependencies(),
      loadWorkorder: async () => ({ id: ids.workorder, companyId: ids.company, locationId: ids.destination, status: "cancelled" }),
      getFulfillment: async () => ({ workorderId: ids.workorder, companyId: ids.company, destinationLocationId: ids.destination, state: "recommended", recommendationVersion: 1 }),
    }),
    (error) => error.code === "PART_FULFILLMENT_WORKORDER_INACTIVE" && error.statusCode === 409,
  );
});
