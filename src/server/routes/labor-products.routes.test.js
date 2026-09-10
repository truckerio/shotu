import assert from "node:assert/strict";
import test from "node:test";
import { handleLaborProductsApi } from "./labor-products.routes.js";

const LOCATION_ID = "33333333-3333-4333-8333-333333333333";
const PRODUCT_ID = "44444444-4444-4444-8444-444444444444";

function harness(method, path, body = {}) {
  const responses = [];
  const events = [];
  return {
    req: { method, requestId: "request-1" }, res: {}, url: new URL(path, "http://localhost"), responses, events,
    helpers: {
      requestContext: { actor: { id: "admin-1", role: "admin" }, companyIds: new Set(), locationIds: new Set() },
      readBody: async () => body,
      sendJson: (_res, status, payload) => responses.push({ status, payload }),
      emitAdministrativeAuditEvent: async (event) => events.push(event),
    },
  };
}

test("labor routes keep the agreed list, create, and pin envelopes", async () => {
  const item = { id: PRODUCT_ID, name: "Diagnostics", code: "DIAG", uomCode: "hr", pinned: false };
  const list = harness("GET", `/api/labor-products?locationId=${LOCATION_ID}`);
  await handleLaborProductsApi(list.req, list.res, list.url, list.helpers, {
    findLocation: async () => ({ id: LOCATION_ID, company_id: "company-1" }),
    listProducts: async () => [item],
  });
  assert.deepEqual(list.responses, [{ status: 200, payload: { items: [item], canCreate: true, canPin: true } }]);

  const create = harness("POST", "/api/labor-products", { locationId: LOCATION_ID, name: "Diagnostics" });
  await handleLaborProductsApi(create.req, create.res, create.url, create.helpers, {
    findLocation: async () => ({ id: LOCATION_ID, company_id: "company-1" }),
    createProduct: async () => ({ kind: "created", product: item }),
  });
  assert.deepEqual(create.responses, [{ status: 201, payload: { item } }]);
  assert.deepEqual(create.events, [{
    type: "labor_product_created",
    requestId: "request-1",
    actorId: "admin-1",
    laborProductId: PRODUCT_ID,
    locationId: LOCATION_ID,
  }]);

  const pin = harness("PATCH", `/api/labor-products/${PRODUCT_ID}`, { locationId: LOCATION_ID, pinned: true });
  await handleLaborProductsApi(pin.req, pin.res, pin.url, pin.helpers, {
    findLocation: async () => ({ id: LOCATION_ID, company_id: "company-1" }),
    setPinned: async () => ({ ...item, pinned: true }),
  });
  assert.deepEqual(pin.responses, [{ status: 200, payload: { item: { ...item, pinned: true } } }]);
  assert.deepEqual(pin.events, [{
    type: "labor_product_pin_changed",
    requestId: "request-1",
    actorId: "admin-1",
    laborProductId: PRODUCT_ID,
    locationId: LOCATION_ID,
    pinned: true,
  }]);
});
