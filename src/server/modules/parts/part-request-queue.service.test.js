import assert from "node:assert/strict";
import test from "node:test";
import { loadUnresolvedPartRequestQueue } from "./part-request-queue.service.js";

const companyId = "11111111-1111-4111-8111-111111111111";
const locationId = "22222222-2222-4222-8222-222222222222";
const otherLocationId = "33333333-3333-4333-8333-333333333333";
const baseContext = { actor: { id: "44444444-4444-4444-8444-444444444444", role: "office" }, companyIds: new Set([companyId]), locationIds: new Set([locationId]) };

test("derives the queue scope from the authenticated office context and maps next actions", async () => {
  let received;
  const response = await loadUnresolvedPartRequestQueue({ page: "2", pageSize: "25", search: "filter", status: "approved", supply: "partial", sort: "activity:asc" }, baseContext, {
    listQueue: async (input) => {
      received = input;
      return { total: 3, items: [
        { approvalStatus: "submitted" },
        { approvalStatus: "needs_info" },
        { approvalStatus: "approved", suppliedQuantity: 1 },
      ] };
    },
  });
  assert.deepEqual(received, { companyIds: [companyId], locationIds: [locationId], isAdmin: false, page: 2, pageSize: 25, locationId: null, search: "filter", status: "approved", supply: "partial", sort: "activity:asc" });
  assert.equal(response.total, 3);
  assert.equal(response.pageCount, 1);
  assert.deepEqual(response.items.map(({ state, nextAction }) => ({ state, nextAction })), [
    { state: "submitted", nextAction: "Review request" },
    { state: "needs_info", nextAction: "Await mechanic details" },
    { state: "approved_pending_supply", nextAction: "Supply or issue remaining quantity" },
  ]);
});

test("rejects non-office roles and does not query an unauthorized requested location", async () => {
  await assert.rejects(loadUnresolvedPartRequestQueue({}, { ...baseContext, actor: { ...baseContext.actor, role: "mechanic" } }), /Permission denied/i);
  let called = false;
  const response = await loadUnresolvedPartRequestQueue({ location: otherLocationId }, baseContext, {
    listQueue: async () => { called = true; return { total: 1, items: [] }; },
  });
  assert.equal(called, false);
  assert.deepEqual(response, { items: [], total: 0, page: 1, pageSize: 50, pageCount: 1 });
});

test("fails closed before querying for missing company or unauthorized location scope", async () => {
  let called = false;
  const dependencies = { listQueue: async () => { called = true; return { total: 1, items: [] }; } };
  const noCompany = await loadUnresolvedPartRequestQueue({}, { ...baseContext, companyIds: new Set() }, dependencies);
  const noLocation = await loadUnresolvedPartRequestQueue({}, { ...baseContext, locationIds: new Set() }, dependencies);
  assert.deepEqual(noCompany.items, []);
  assert.deepEqual(noLocation.items, []);
  assert.equal(called, false);
});

test("allows an admin's authorized companies without inventing a location filter", async () => {
  let received;
  await loadUnresolvedPartRequestQueue({}, { actor: { id: baseContext.actor.id, role: "admin" }, companyIds: new Set([companyId]), locationIds: new Set([otherLocationId]) }, {
    listQueue: async (input) => { received = input; return { total: 0, items: [] }; },
  });
  assert.equal(received.isAdmin, true);
  assert.deepEqual(received.companyIds, [companyId]);
});
