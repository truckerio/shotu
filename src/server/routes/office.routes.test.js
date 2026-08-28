import assert from "node:assert/strict";
import test from "node:test";
import { handleOfficeApi } from "./office.routes.js";

const context = {
  actor: { id: "11111111-1111-4111-8111-111111111111", role: "office" },
  companyIds: new Set(["22222222-2222-4222-8222-222222222222"]),
  locationIds: new Set(["33333333-3333-4333-8333-333333333333"]),
};

test("serves unresolved part requests through the protected Office API family", async () => {
  const sent = [];
  const handled = await handleOfficeApi(
    { method: "GET" },
    {},
    new URL("http://example.test/api/office/part-requests/queue?page=2&pageSize=10&search=filter&location=33333333-3333-4333-8333-333333333333&status=approved&supply=partial&sort=activity%3Aasc"),
    { requestContext: context, sendJson: (_res, status, value) => sent.push({ status, value }), readBody: async () => ({}) },
    { loadPartRequestQueue: async (query, requestContext) => ({ items: [], total: 7, query, actorId: requestContext.actor.id }) },
  );
  assert.equal(handled, true);
  assert.deepEqual(sent, [{ status: 200, value: { items: [], total: 7, query: { page: "2", pageSize: "10", search: "filter", location: "33333333-3333-4333-8333-333333333333", status: "approved", supply: "partial", sort: "activity:asc" }, actorId: context.actor.id } }]);
});

test("does not serve the queue to a non-office role", async () => {
  await assert.rejects(
    handleOfficeApi(
      { method: "GET" }, {}, new URL("http://example.test/api/office/part-requests/queue"),
      { requestContext: { ...context, actor: { ...context.actor, role: "mechanic" } }, sendJson: () => {}, readBody: async () => ({}) },
    ),
    /Permission denied/i,
  );
});
