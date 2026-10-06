import assert from "node:assert/strict";
import test from "node:test";
import { handleCustomerDocumentsApi } from "./customer-documents.routes.js";

function harness(body = {}, requestContext = { actor: { id: "actor", role: "office" } }) {
  const sent = [];
  return {
    sent,
    helpers: {
      requestContext,
      readBody: async () => body,
      sendJson: (_res, status, payload) => sent.push({ status, payload }),
    },
  };
}

test("staff preview and issue routes delegate validated ownership to the service boundary", async () => {
  const preview = harness({ companyId: "company" });
  let previewCall;
  assert.equal(await handleCustomerDocumentsApi(
    { method: "POST", headers: {} }, {}, new URL("http://x/api/customer-documents/previews"), preview.helpers,
    { preview: async (...args) => (previewCall = args, { projection: { document: { state: "draft_projection" } } }) },
  ), true);
  assert.equal(preview.sent[0].status, 200);
  assert.equal(previewCall[0], preview.helpers.requestContext);
  assert.deepEqual(previewCall[1], { companyId: "company" });

  const issue = harness({ documentType: "estimate" });
  await handleCustomerDocumentsApi(
    { method: "POST", headers: {} }, {}, new URL("http://x/api/customer-documents/revisions"), issue.helpers,
    { issue: async () => ({ revision: { id: "revision" } }) },
  );
  assert.equal(issue.sent[0].status, 201);
});

test("published profile read uses explicit company and location query scope", async () => {
  const h = harness();
  let received;
  await handleCustomerDocumentsApi(
    { method: "GET", headers: {} }, {},
    new URL("http://x/api/customer-documents/profile?companyId=company&locationId=shop"), h.helpers,
    { readProfile: async (_context, input) => (received = input, { id: "profile" }) },
  );
  assert.deepEqual(received, { companyId: "company", locationId: "shop" });
  assert.equal(h.sent[0].status, 200);
});

test("customer document reporting forwards only bounded tenant query input", async () => {
  const h = harness();
  let received;
  await handleCustomerDocumentsApi(
    { method: "GET", headers: {} }, {},
    new URL("http://x/api/customer-documents/reports?companyId=company&locationId=shop&grantLimit=10"), h.helpers,
    { readReport: async (...args) => (received = args, { documents: [], grants: [] }) },
  );
  assert.deepEqual(received, [h.helpers.requestContext, { companyId: "company", locationId: "shop", grantLimit: "10" }]);
  assert.equal(h.sent[0].status, 200);
});

test("grant issuance takes the revision identity from the route and never from the body", async () => {
  const h = harness({ revisionId: "attacker", companyId: "company" });
  let received;
  await handleCustomerDocumentsApi(
    { method: "POST", headers: {} }, {},
    new URL("http://x/api/customer-documents/revisions/route-revision/grants"), h.helpers,
    { issueGrant: async (_context, input) => (received = input, { rawToken: "secret" }) },
  );
  assert.equal(received.revisionId, "route-revision");
  assert.equal(h.sent[0].status, 201);
});

test("portal requires its grant in the dedicated header and does not accept query token routing", async () => {
  const h = harness();
  let token;
  assert.equal(await handleCustomerDocumentsApi(
    { method: "GET", requestId: "request-1", headers: { "x-customer-grant": "raw-token" } }, {},
    new URL("http://x/api/customer-portal/document?grant=query-token"), h.helpers,
    { readPortal: async (value, audit) => (token = value, assert.equal(audit.idempotencyKey, "view:request-1"), { document: {} }) },
  ), true);
  assert.equal(token, "raw-token");
  assert.equal(h.sent[0].status, 200);

  assert.equal(await handleCustomerDocumentsApi(
    { method: "GET", headers: {} }, {}, new URL("http://x/api/customer-documents/portal?grant=query-token"), h.helpers, {},
  ), false);
});

test("portal response forwards only the header grant and parsed body to the service", async () => {
  const body = { response: "accepted", idempotencyKey: "response-key" };
  const h = harness(body, null);
  let received;
  await handleCustomerDocumentsApi(
    { method: "POST", headers: { "x-customer-grant": "grant" } }, {},
    new URL("http://x/api/customer-portal/responses"), h.helpers,
    { respond: async (...args) => (received = args, { eventId: "event" }) },
  );
  assert.deepEqual(received, ["grant", body]);
  assert.equal(h.sent[0].status, 200);
});

test("accepted Estimate activation is revision-addressed and staff-scoped", async () => {
  const body = { companyId: "company", locationId: "location", expectedDraftVersion: 3, idempotencyKey: "activate-001" };
  const h = harness(body);
  let received;
  await handleCustomerDocumentsApi(
    { method: "POST", headers: {} }, {},
    new URL("http://x/api/customer-documents/revisions/revision-1/activate"), h.helpers,
    { activate: async (...args) => (received = args, { workorderId: "workorder-1" }) },
  );
  assert.deepEqual(received, [h.helpers.requestContext, "revision-1", body]);
  assert.equal(h.sent[0].status, 201);
});

test("current Estimate recovery uses exact draft path plus explicit tenant query", async () => {
  const h = harness();
  let received;
  await handleCustomerDocumentsApi(
    { method: "GET", headers: {} }, {},
    new URL("http://x/api/customer-documents/drafts/draft-1/current-estimate?companyId=company&locationId=shop"), h.helpers,
    { readByDraft: async (...args) => (received = args, { id: "revision-1", eligibility: { canActivate: true } }) },
  );
  assert.deepEqual(received, [h.helpers.requestContext, "draft-1", { companyId: "company", locationId: "shop" }]);
  assert.equal(h.sent[0].status, 200);
  assert.equal(h.sent[0].payload.revision.id, "revision-1");
});

test("Workorder customer document summary is exact-path and tenant scoped", async () => {
  const h = harness();
  let received;
  await handleCustomerDocumentsApi(
    { method: "GET", headers: {} }, {},
    new URL("http://x/api/customer-documents/workorders/workorder-1/summary?companyId=company&locationId=shop"), h.helpers,
    { readWorkorderSummary: async (...args) => (received = args, { workorderId: "workorder-1", documents: {} }) },
  );
  assert.deepEqual(received, [h.helpers.requestContext, "workorder-1", { companyId: "company", locationId: "shop" }]);
  assert.equal(h.sent[0].status, 200);
});

test("customer audience chat routes keep staff Workorder scope and portal grant scope separate", async () => {
  const staffRead = harness();
  let readArgs;
  await handleCustomerDocumentsApi(
    { method: "GET", headers: {} }, {},
    new URL("http://x/api/customer-documents/workorders/workorder-1/customer-chat?companyId=company&locationId=shop"),
    staffRead.helpers,
    { readStaffChat: async (...args) => (readArgs = args, { messages: [] }) },
  );
  assert.deepEqual(readArgs, [staffRead.helpers.requestContext, "workorder-1", { companyId: "company", locationId: "shop" }]);
  assert.equal(staffRead.sent[0].status, 200);

  const body = {
    companyId: "company", locationId: "shop", documentId: "document-1", revisionId: "revision-1",
    body: "Please review the revision.", idempotencyKey: "chat-1",
  };
  const staffSend = harness(body);
  let sendArgs;
  await handleCustomerDocumentsApi(
    { method: "POST", headers: {} }, {},
    new URL("http://x/api/customer-documents/workorders/workorder-1/customer-chat"),
    staffSend.helpers,
    { sendStaffChat: async (...args) => (sendArgs = args, { message: { id: "message-1" } }) },
  );
  assert.deepEqual(sendArgs, [staffSend.helpers.requestContext, "workorder-1", body]);
  assert.equal(staffSend.sent[0].status, 201);

  const portalBody = { body: "Can you explain the labor?", customerName: "Pat", idempotencyKey: "portal-chat-1" };
  const portal = harness(portalBody, null);
  let portalArgs;
  await handleCustomerDocumentsApi(
    { method: "POST", headers: { "x-customer-grant": "grant-token" } }, {},
    new URL("http://x/api/customer-portal/chat?grant=ignored"), portal.helpers,
    { sendPortalChat: async (...args) => (portalArgs = args, { message: { id: "message-2" } }) },
  );
  assert.deepEqual(portalArgs, ["grant-token", portalBody]);
  assert.equal(portal.sent[0].status, 201);
});
