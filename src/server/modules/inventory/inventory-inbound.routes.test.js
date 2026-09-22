import assert from "node:assert/strict";
import test from "node:test";
import { handleInventoryApi } from "./inventory.routes.js";
import { InventoryError } from "./inventory.errors.js";

const COMPANY = "00000000-0000-4000-8000-000000000001";
const LOCATION = "00000000-0000-4000-8000-000000000011";
const INBOUND = "00000000-0000-4000-8000-000000000021";
const context = { actor: { id: "00000000-0000-4000-8000-000000000031", role: "office" }, companyIds: new Set([COMPANY]), locationIds: new Set([LOCATION]) };

function helpers(response) {
  return { requestContext: context, sendJson: (res, status, payload) => Object.assign(res, { status, payload }) };
}

test("GET inbound list dispatches through the injected boundary and returns its payload", async () => {
  const response = {};
  let called;
  const handled = await handleInventoryApi(
    { method: "GET" }, response,
    new URL("http://localhost/api/office/inventory/inbound?view=expected&page=2"),
    helpers(response),
    { getInbound: async (params, requestContext, dependencies) => {
      called = { params: Object.fromEntries(params), requestContext, dependencies };
      return { items: [{ id: INBOUND }], page: 2, hasMore: false, counts: { expected: 1 } };
    } },
  );
  assert.equal(handled, true);
  assert.equal(response.status, 200);
  assert.deepEqual(response.payload.items, [{ id: INBOUND }]);
  assert.deepEqual(called.params, { view: "expected", page: "2" });
  assert.equal(called.requestContext, context);
});

test("GET inbound detail dispatches with the decoded identifier", async () => {
  const response = {};
  let called;
  await handleInventoryApi(
    { method: "GET" }, response,
    new URL(`http://localhost/api/office/inventory/inbound/${encodeURIComponent(INBOUND)}?locationId=${LOCATION}`),
    helpers(response),
    { getInboundDetail: async (id, params) => { called = { id, params: Object.fromEntries(params) }; return { item: { id } }; } },
  );
  assert.equal(response.status, 200);
  assert.deepEqual(response.payload, { item: { id: INBOUND } });
  assert.deepEqual(called, { id: INBOUND, params: { locationId: LOCATION } });
});

test("GET inbound validation errors use the stable inventory error envelope", async () => {
  const response = {};
  await handleInventoryApi(
    { method: "GET" }, response,
    new URL("http://localhost/api/office/inventory/inbound?view=unsupported"),
    helpers(response),
    { query: async () => ({ rows: [] }) },
  );
  assert.equal(response.status, 400);
  assert.equal(response.payload.code, "validation_error");
});

test("GET inbound detail errors are serialized and unknown paths remain route misses", async () => {
  const response = {};
  await handleInventoryApi(
    { method: "GET" }, response,
    new URL(`http://localhost/api/office/inventory/inbound/${INBOUND}`),
    helpers(response),
    { getInboundDetail: async () => { throw new InventoryError("Inbound was not found.", { code: "inventory_not_found", statusCode: 404 }); } },
  );
  assert.equal(response.status, 404);
  assert.equal(response.payload.code, "inventory_not_found");

  const missing = {};
  await handleInventoryApi({ method: "GET" }, missing, new URL("http://localhost/api/office/inventory/inbound/no/such/path"), helpers(missing), {});
  assert.equal(missing.status, 404);
  assert.equal(missing.payload.code, "route_not_found");
});
