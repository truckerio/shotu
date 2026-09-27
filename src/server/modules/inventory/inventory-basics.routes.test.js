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
    emitAdministrativeAuditEvent: dependencies.emitAdministrativeAuditEvent,
  }, dependencies);
  assert.equal(handled, true);
  return res;
}
const commercial = `/api/office/inventory/parts/${partId}/commercial`;
const pricePath = `/api/office/inventory/parts/${partId}/prices/selling`;
const sellingPolicyPath = `/api/office/inventory/parts/${partId}/selling-policy?locationId=${locationId}`;
const batchCostPath = `/api/office/inventory/batches/${partId}/cost`;
const priceBody = { expectedVersion: 0, amount: "0", currency: "USD", reason: "Opening configured price", idempotencyKey: "basic-price-route-1" };

test("commercial route preserves scoped reads and missing costs", async () => {
  const result = await request("GET", commercial, null, { read: async (input) => {
    assert.deepEqual(input.companyIds, [companyId]); assert.deepEqual(input.locationIds, []); assert.equal(input.isAdmin, true);
    return { purchaseCost: { status: "unknown", latest: null }, prices: {} };
  } });
  assert.equal(result.status, 200); assert.equal(result.payload.purchaseCost.latest, null);
});

test("price route records explicit zero, validation and stale conflicts", async () => {
  const result = await request("PUT", pricePath, priceBody, { append: async (input) => {
    assert.equal(input.amount, "0"); assert.equal(input.actorId, actorId);
    return { price: { amount: "0.0000", version: 1 }, replayed: false };
  } }, context("admin"));
  assert.equal(result.status, 200); assert.equal(result.payload.price.amount, "0.0000");
  const invalid = await request("PUT", pricePath, { ...priceBody, amount: "-2" }, { append: () => assert.fail("Invalid price reached persistence") }, context("admin"));
  assert.equal(invalid.status, 400);
  const stale = await request("PUT", pricePath, priceBody, { append: async () => ({ kind: "stale" }) }, context("admin"));
  assert.equal(stale.status, 409); assert.equal(stale.payload.code, "INVENTORY_PART_PRICE_STALE");
});

test("selling policy route reads and writes one location-scoped versioned policy", async () => {
  const readResult = await request("GET", sellingPolicyPath, null, {
    resolveReadLocationScope: async () => ({ companyIds: [companyId], locationIds: [locationId], isAdmin: false, canManageLocation: true }),
    read: async (input) => {
      assert.equal(input.catalogPartId, partId);
      assert.equal(input.locationId, locationId);
      return { policy: { version: 2, method: "markup_percent", value: "15.0000", currency: null }, writeVersion: 0 };
    },
  });
  assert.equal(readResult.status, 200);
  assert.equal(readResult.payload.policy.method, "markup_percent");
  assert.equal(readResult.payload.writeVersion, 0);

  const body = { expectedVersion: 2, method: "markup_percent", value: "20", currency: null, reason: "Updated markup", idempotencyKey: "selling-policy-route-1" };
  const writeResult = await request("PUT", sellingPolicyPath, body, {
    resolveLocationScope: async () => ({ companyIds: [companyId], locationIds: [locationId], isAdmin: false }),
    append: async (input) => {
      assert.equal(input.actorId, actorId);
      assert.equal(input.expectedVersion, 2);
      assert.match(input.requestHash, /^[0-9a-f]{64}$/);
      return { kind: "saved", policy: { version: 3, method: input.method, value: input.value, currency: input.currency }, replayed: false };
    },
  });
  assert.equal(writeResult.status, 200);
  assert.equal(writeResult.payload.policy.version, 3);
});

test("batch cost route saves an audited correction and preserves permission checks", async () => {
  const audit = [];
  const body = { expectedVersion: 0, unitCost: "11.2500", currency: "USD", reason: "Opening legacy cost", idempotencyKey: "batch-cost-route-1" };
  const saved = await request("PUT", batchCostPath, body, { emitAdministrativeAuditEvent: async (event) => audit.push(event), append: async (input) => {
    assert.equal(input.costLayerId, partId);
    assert.equal(input.actorId, actorId);
    return { kind: "saved", revision: { id: locationId, version: 1, unitCost: input.unitCost, currency: input.currency }, replayed: false };
  } });
  assert.equal(saved.status, 200);
  assert.equal(saved.payload.revision.unitCost, "11.2500");
  assert.deepEqual(audit.map((event) => ({ type: event.type, costLayerId: event.costLayerId, reason: event.reason })), [{ type: "inventory_batch_cost_corrected", costLayerId: partId, reason: body.reason }]);
  await assert.rejects(request("PUT", batchCostPath, body, { append: () => assert.fail("Mechanic correction reached persistence") }, context("mechanic")), (error) => error.statusCode === 403);
});

test("commercial routes reject unauthorized roles and missing scoped parts", async () => {
  await assert.rejects(request("GET", commercial, null, { read: () => assert.fail("Unauthorized read reached database") }, context("mechanic")), (error) => error.statusCode === 403);
  const missing = await request("GET", commercial, null, { read: async () => null });
  assert.equal(missing.status, 404);
});

test("browse locations route exposes company locations with server-projected manage capability", async () => {
  const otherLocationId = "55555555-5555-4555-8555-555555555555";
  const result = await request("GET", "/api/office/inventory/browse-locations", null, {
    query: async () => ({ rows: [
      { id: locationId, company_id: companyId, name: "Chino Yard", type: "yard", address: null },
      { id: otherLocationId, company_id: companyId, name: "Arizona Yard", type: "yard", address: null },
    ] }),
  });
  assert.equal(result.status, 200);
  assert.deepEqual(result.payload.locations.map(({ name, canManage, canManageCompany }) => ({ name, canManage, canManageCompany })), [
    { name: "Chino Yard", canManage: true, canManageCompany: false },
    { name: "Arizona Yard", canManage: false, canManageCompany: false },
  ]);
  const denied = await request(
    "GET",
    "/api/office/inventory/browse-locations",
    null,
    { query: () => assert.fail("Mechanic browse reached persistence") },
    context("mechanic"),
  );
  assert.equal(denied.status, 403);
});

test("location routes validate hierarchy requests and scope before persistence", async () => {
  const path = `/api/office/inventory/locations/${locationId}/positions`;
  const result = await request("GET", path, null, { loadLocation: async () => ({ id: locationId, company_id: companyId }), listPositions: async (input) => {
    assert.equal(input.locationId, locationId); assert.deepEqual(input.companyIds, [companyId]);
    return [{ id: partId, name: "Warehouse", kind: "warehouse", canStore: false }];
  } });
  assert.equal(result.status, 200); assert.equal(result.payload.positions[0].canStore, false);
  const readOnly = await request("GET", path, null, {
    loadLocation: async () => ({ id: locationId, company_id: companyId }),
    listPositions: async (input) => {
      assert.equal(input.canManageLocation, false);
      return [{ id: partId, name: "Receiving", kind: "area", canStore: false }];
    },
  }, { ...context(), locationIds: new Set() });
  assert.equal(readOnly.status, 200);
  assert.equal(readOnly.payload.positions[0].name, "Receiving");
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
