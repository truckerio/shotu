import assert from "node:assert/strict";
import test from "node:test";
import { handlePartFulfillmentApi } from "./part-fulfillment.routes.js";
const context = { actor: { id: "11111111-1111-4111-8111-111111111111", role: "admin" }, companyIds: new Set(["22222222-2222-4222-8222-222222222222"]), locationIds: new Set() };
function helpers(body) { const sent = []; return { sent, requestContext: context, readBody: async () => body, sendJson: (_res, status, value) => sent.push({ status, value }) }; }
test("route returns recommendation through its protected office path", async () => {
  const body = { workorderId: "33333333-3333-4333-8333-333333333333", catalogPartId: "44444444-4444-4444-8444-444444444444", destinationLocationId: "55555555-5555-4555-8555-555555555555", quantity: 1, uomCode: "ea", idempotencyKey: "request-key-123" }; const h = helpers(body);
  await handlePartFulfillmentApi({ method: "POST" }, {}, new URL("http://x/api/office/part-fulfillments"), h, { authorizeModule: async () => true, loadWorkorder: async () => ({ companyId: "22222222-2222-4222-8222-222222222222", locationId: body.destinationLocationId, status: "in_progress" }), loadCatalogPart: async () => ({ uomCode: "ea" }), findAvailability: async () => [], createFulfillment: async () => ({ kind: "created", fulfillment: { id: "f", legs: [] } }) });
  assert.equal(h.sent[0].status, 201);
});
test("route exposes replay conflict as 409", async () => {
  const h = helpers({}); await handlePartFulfillmentApi({ method: "POST" }, {}, new URL("http://x/api/office/part-fulfillments"), h); assert.equal(h.sent[0].status, 400);
});
