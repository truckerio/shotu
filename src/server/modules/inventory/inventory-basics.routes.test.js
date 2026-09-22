import test from "node:test";
import assert from "node:assert/strict";
import { handleInventoryApi } from "./inventory.routes.js";
import { permissionsForRole } from "../../auth/permissions.js";

const companyId = "11111111-1111-4111-8111-111111111111";
const partId = "22222222-2222-4222-8222-222222222222";
const locationId = "33333333-3333-4333-8333-333333333333";
const actorId = "44444444-4444-4444-8444-444444444444";
const context = (role = "office") => ({ actor: { id: actorId, role }, companyIds: new Set([companyId]), locationIds: new Set([locationId]), permissions: permissionsForRole(role) });
async function request(method, path, body, dependencies, ctx = context()) {
  const res = {};
  const handled = await handleInventoryApi({ method }, res, new URL(path, "http://localhost"), {
    requestContext: ctx, readBody: async () => body,
    sendJson: (response, status, payload) => Object.assign(response, { status, payload }),
  }, dependencies);
  assert.equal(handled, true);
  return res;
}
const commercial = `/api/office/inventory/parts/${partId}/commercial`;
const pricePath = `/api/office/inventory/parts/${partId}/prices/selling`;
const priceBody = { expectedVersion: 0, amount: "0", currency: "USD", reason: "Opening configured price", idempotencyKey: "basic-price-route-1" };

test("commercial route preserves scoped reads and missing costs", async () => {
  const result = await request("GET", commercial, null, { read: async (input) => {
    assert.deepEqual(input.companyIds, [companyId]); assert.deepEqual(input.locationIds, [locationId]);
    return { purchaseCost: { status: "unknown", latest: null }, prices: {} };
  } });
  assert.equal(result.status, 200); assert.equal(result.payload.purchaseCost.latest, null);
});

test("price route records explicit zero, validation and stale conflicts", async () => {
  const result = await request("PUT", pricePath, priceBody, { append: async (input) => {
    assert.equal(input.amount, "0"); assert.equal(input.actorId, actorId);
    return { price: { amount: "0.0000", version: 1 }, replayed: false };
  } });
  assert.equal(result.status, 200); assert.equal(result.payload.price.amount, "0.0000");
  const invalid = await request("PUT", pricePath, { ...priceBody, amount: "-2" }, { append: () => assert.fail("Invalid price reached persistence") });
  assert.equal(invalid.status, 400);
  const stale = await request("PUT", pricePath, priceBody, { append: async () => ({ kind: "stale" }) });
  assert.equal(stale.status, 409); assert.equal(stale.payload.code, "INVENTORY_PART_PRICE_STALE");
});

test("commercial routes reject unauthorized roles and missing scoped parts", async () => {
  await assert.rejects(request("GET", commercial, null, { read: () => assert.fail("Unauthorized read reached database") }, context("mechanic")), (error) => error.statusCode === 403);
  const missing = await request("GET", commercial, null, { read: async () => null });
  assert.equal(missing.status, 404);
});

test("location routes validate hierarchy requests and scope before persistence", async () => {
  const path = `/api/office/inventory/locations/${locationId}/positions`;
  const result = await request("GET", path, null, { listPositions: async (input) => {
    assert.equal(input.locationId, locationId); assert.deepEqual(input.companyIds, [companyId]);
    return [{ id: partId, name: "Warehouse", kind: "warehouse", canStore: false }];
  } });
  assert.equal(result.status, 200); assert.equal(result.payload.positions[0].canStore, false);
  const denied = await request("GET", path, null, { listPositions: () => assert.fail("Cross-location read reached database") }, { ...context(), locationIds: new Set() });
  assert.equal(denied.status, 404);
  const invalid = await request("POST", path, { name: "Bad parent", parentId: "invalid" }, { insertPosition: () => assert.fail("Invalid hierarchy reached database") });
  assert.equal(invalid.status, 400);
});

test("movement and count routes preserve error and permission contracts", async () => {
  const movePath = `/api/office/inventory/parts/${partId}/locations/${locationId}/positions/moves`;
  const denied = await request("POST", movePath, {}, { moveStock: () => assert.fail("Unauthorized move reached database") }, context("mechanic"));
  assert.equal(denied.status, 403);
  const countPath = `/api/office/inventory/position-counts/${partId}/apply`;
  const countDenied = await request("POST", countPath, {}, { applyCount: () => assert.fail("Office applied count") });
  assert.equal(countDenied.status, 403);
});
