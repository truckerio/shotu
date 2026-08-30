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

test("legacy Office detail includes installed serialized summaries without losing role detail", async () => {
  const sent = [];
  let installedScope;
  await handleOfficeApi(
    { method: "GET" },
    {},
    new URL("http://example.test/api/office/workorders/workorder-1"),
    { requestContext: context, sendJson: (_res, status, value) => sent.push({ status, value }), readBody: async () => ({}) },
    {
      resolveModules: async () => ({ decisions: { parts: { access: "write", source: "default" } } }),
      loadDetail: async () => ({
        user: context.actor,
        workorder: {
          id: "workorder-1",
          companyId: "22222222-2222-4222-8222-222222222222",
          locationId: "33333333-3333-4333-8333-333333333333",
          formData: {},
        },
        policy: { mechanicCanRecordParts: true },
        allowedActions: { recordUsedParts: true },
      }),
      listInstalledParts: async (scope) => {
        installedScope = scope;
        return [{ catalogPartId: "catalog-1", partNumber: "LF9009", quantity: 1, uomCode: "ea" }];
      },
    },
  );

  const detail = sent[0].value;
  assert.equal(sent[0].status, 200);
  assert.equal(detail.user.id, context.actor.id);
  assert.equal(detail.policy.mechanicCanRecordParts, true);
  assert.equal(detail.allowedActions.recordUsedParts, true);
  assert.deepEqual(detail.modules.parts.data.installedSerializedParts, [
    { catalogPartId: "catalog-1", partNumber: "LF9009", quantity: 1, uomCode: "ea" },
  ]);
  assert.deepEqual(installedScope, {
    workorderId: "workorder-1",
    companyId: "22222222-2222-4222-8222-222222222222",
    locationId: "33333333-3333-4333-8333-333333333333",
    limit: 2000,
  });
});

test("legacy Office detail does not query or expose summaries when Parts is hidden", async () => {
  const sent = [];
  let queried = false;
  await handleOfficeApi(
    { method: "GET" }, {}, new URL("http://example.test/api/office/workorders/workorder-1"),
    { requestContext: context, sendJson: (_res, status, value) => sent.push({ status, value }), readBody: async () => ({}) },
    {
      resolveModules: async () => ({ decisions: { parts: { access: "hidden", source: "user" } } }),
      loadDetail: async () => ({ workorder: { id: "workorder-1", companyId: "company-1", locationId: "location-1", formData: {} } }),
      listInstalledParts: async () => { queried = true; return []; },
    },
  );
  assert.equal(queried, false);
  assert.equal("parts" in sent[0].value.modules, false);
  assert.equal("installedSerializedParts" in sent[0].value.workorder, false);
});
