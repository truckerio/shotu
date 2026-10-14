import assert from "node:assert/strict";
import test from "node:test";
import { handleOfficeApi } from "./office.routes.js";
import { PERMISSION, permissionsForRole } from "../auth/permissions.js";

const context = {
  actor: { id: "11111111-1111-4111-8111-111111111111", role: "office" },
  companyIds: new Set(["22222222-2222-4222-8222-222222222222"]),
  locationIds: new Set(["33333333-3333-4333-8333-333333333333"]),
  permissions: new Set([
    PERMISSION.WORKORDER_OFFICE,
    PERMISSION.CUSTOMER_DOCUMENT_READ,
    PERMISSION.CUSTOMER_DOCUMENT_WRITE,
  ]),
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

test("Office part-plan route preserves the legacy part route and forwards a non-printing runtime operation", async () => {
  const body = {
    query: "Oil filter",
    partNumber: "LF9009",
    quantity: 1,
    uomCode: "ea",
    allocations: [],
  };
  const calls = [];
  const runAction = async (...args) => { calls.push(args); return { id: "request-1" }; };
  const sendJson = () => {};
  const helpers = { requestContext: context, sendJson, readBody: async () => body };

  await handleOfficeApi(
    { method: "POST" }, {}, new URL("http://example.test/api/office/workorders/workorder-1/parts"), helpers, { runAction },
  );
  await handleOfficeApi(
    { method: "POST" }, {}, new URL("http://example.test/api/office/workorders/workorder-1/part-plans"), helpers, { runAction },
  );

  assert.equal(calls[0][2], "parts");
  assert.equal(calls[0][3], "record");
  assert.equal(calls[0][4].operation, "officePart");
  assert.equal(calls[1][2], "parts");
  assert.equal(calls[1][3], "record");
  assert.equal(calls[1][4].operation, "officePartPlan");
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
      listAggregateUsages: async () => [],
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
    limit: 2001,
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
      loadDetail: async () => ({ workorder: { id: "workorder-1", companyId: "22222222-2222-4222-8222-222222222222", locationId: "location-1", formData: {} } }),
      listInstalledParts: async () => { queried = true; return []; },
      listAggregateUsages: async () => [],
    },
  );
  assert.equal(queried, false);
  assert.equal("parts" in sent[0].value.modules, false);
  assert.equal("installedSerializedParts" in sent[0].value.workorder, false);
});

test("Office detail refuses a mechanic-only company despite primary admin role", async () => {
  const adminCompany = "44444444-4444-4444-8444-444444444444";
  const targetCompany = "22222222-2222-4222-8222-222222222222";
  const mixed = {
    ...context,
    actor: { ...context.actor, role: "admin" },
    companyIds: new Set([adminCompany, targetCompany]),
    companyRoles: new Map([[adminCompany, "admin"], [targetCompany, "mechanic"]]),
  };
  await assert.rejects(() => handleOfficeApi(
    { method: "GET" }, {}, new URL("http://example.test/api/office/workorders/workorder-1"),
    { requestContext: mixed, sendJson: () => {}, readBody: async () => ({}) },
    { resolveModules: async () => ({ decisions: {} }),
      loadDetail: async () => ({ workorder: { id: "workorder-1", companyId: targetCompany, formData: {} } }) },
  ), { code: "PERMISSION_DENIED" });
});

test("Office detail accepts target office membership despite primary mechanic role", async () => {
  const primaryCompany = "44444444-4444-4444-8444-444444444444";
  const targetCompany = "22222222-2222-4222-8222-222222222222";
  const mixed = {
    ...context,
    actor: { ...context.actor, role: "mechanic" },
    companyIds: new Set([primaryCompany, targetCompany]),
    companyRoles: new Map([[primaryCompany, "mechanic"], [targetCompany, "office"]]),
  };
  const sent = [];
  await handleOfficeApi(
    { method: "GET" }, {}, new URL("http://example.test/api/office/workorders/workorder-1"),
    { requestContext: mixed, sendJson: (_res, status, value) => sent.push({ status, value }), readBody: async () => ({}) },
    { resolveModules: async () => ({ decisions: {} }),
      loadDetail: async () => ({ workorder: { id: "workorder-1", companyId: targetCompany, formData: {} } }) },
  );
  assert.equal(sent[0].status, 200);
});

test("location mechanics allows company Admin without an assignment but hides lower-role and unassigned Office locations", async () => {
  const adminCompany = "44444444-4444-4444-8444-444444444444";
  const otherCompany = "55555555-5555-4555-8555-555555555555";
  const adminLocation = "66666666-6666-4666-8666-666666666666";
  const otherLocation = "77777777-7777-4777-8777-777777777777";
  const locations = new Map([[adminLocation, adminCompany], [otherLocation, otherCompany]]);
  const mixed = {
    ...context,
    actor: { ...context.actor, role: "admin" },
    companyIds: new Set([adminCompany, otherCompany]),
    companyRoles: new Map([[adminCompany, "admin"], [otherCompany, "mechanic"]]),
    locationIds: new Set(),
    permissions: permissionsForRole("admin"),
  };
  const lookedUpCompanies = [];
  const sent = [];
  const dependencies = {
    getLocation: async (id, companyIds) => {
      lookedUpCompanies.push(companyIds);
      const companyId = locations.get(id);
      return companyIds.includes(companyId) ? { id, company_id: companyId } : null;
    },
    listLocationMechanics: async (_id, _userId, scoped) => {
      assert.deepEqual([...scoped.companyIds], [adminCompany]);
      assert.equal(scoped.actor.role, "admin");
      return [{ id: "mechanic-1" }];
    },
  };
  const helpers = { requestContext: mixed, sendJson: (_res, status, value) => sent.push({ status, value }), readBody: async () => ({}) };

  await handleOfficeApi({ method: "GET" }, {}, new URL(`http://example.test/api/office/locations/${adminLocation}/mechanics`), helpers, dependencies);
  assert.deepEqual(sent, [{ status: 200, value: { mechanics: [{ id: "mechanic-1" }] } }]);
  await assert.rejects(() => handleOfficeApi({ method: "GET" }, {}, new URL(`http://example.test/api/office/locations/${otherLocation}/mechanics`), helpers, dependencies), { code: "RESOURCE_NOT_FOUND" });
  assert.deepEqual(lookedUpCompanies, [[adminCompany], [adminCompany]]);

  const office = { ...mixed, actor: { ...mixed.actor, role: "office" }, companyRoles: new Map([[adminCompany, "office"]]), companyIds: new Set([adminCompany]) };
  await assert.rejects(() => handleOfficeApi({ method: "GET" }, {}, new URL(`http://example.test/api/office/locations/${adminLocation}/mechanics`), { ...helpers, requestContext: office }, dependencies), { code: "PERMISSION_DENIED" });
});

test("Office detail projects saved discount intent only with customer-document read permission", async () => {
  const adjustments = {
    lineDiscounts: [],
    documentDiscount: { kind: "fixed", value: "25", reason: "Service recovery" },
    overrideReasons: [],
  };
  const loadDetail = async () => ({
    user: context.actor,
    workorder: {
      id: "workorder-1",
      companyId: "22222222-2222-4222-8222-222222222222",
      locationId: "33333333-3333-4333-8333-333333333333",
      formData: {
        customerDocumentAdjustments: adjustments,
        customerDocumentAdjustmentBaseRevisionId: "44444444-4444-4444-8444-444444444444",
      },
    },
  });
  const resolveModules = async () => ({ decisions: { concern: { access: "read", source: "default" } } });
  const read = async (requestContext) => {
    const sent = [];
    await handleOfficeApi(
      { method: "GET" }, {}, new URL("http://example.test/api/office/workorders/workorder-1"),
      { requestContext, sendJson: (_res, _status, value) => sent.push(value), readBody: async () => ({}) },
      { loadDetail, resolveModules },
    );
    return sent[0];
  };

  const permitted = await read(context);
  assert.deepEqual(permitted.workorder.formData.customerDocumentAdjustments, adjustments);
  assert.equal(permitted.workorder.formData.customerDocumentAdjustmentBaseRevisionId, "44444444-4444-4444-8444-444444444444");
  assert.deepEqual(permitted.customerDocumentAccess, { canRead: true, canWrite: true });

  const restricted = await read({
    ...context,
    permissions: new Set([PERMISSION.WORKORDER_OFFICE, PERMISSION.CUSTOMER_DOCUMENT_WRITE]),
  });
  assert.equal(Object.hasOwn(restricted.workorder.formData, "customerDocumentAdjustments"), false);
  assert.equal(Object.hasOwn(restricted.workorder.formData, "customerDocumentAdjustmentBaseRevisionId"), false);
  assert.deepEqual(restricted.customerDocumentAccess, { canRead: false, canWrite: true });

  const readOnly = await read({
    ...context,
    permissions: new Set([PERMISSION.WORKORDER_OFFICE, PERMISSION.CUSTOMER_DOCUMENT_READ]),
  });
  assert.deepEqual(readOnly.customerDocumentAccess, { canRead: true, canWrite: false });
  assert.deepEqual(readOnly.workorder.formData.customerDocumentAdjustments, adjustments);
});

test("legacy Office patch assigns labor selection to the Diagnosis and repair module", async () => {
  const productId = "44444444-4444-4444-8444-444444444444";
  let patched;
  await handleOfficeApi(
    { method: "PATCH" }, {}, new URL("http://example.test/api/office/workorders/workorder-1"),
    {
      requestContext: context,
      readBody: async () => ({
        formData: { laborProduct: { productId, externalId: "", code: "LAB", name: "Labor", uomCode: "hr" } },
      }),
      sendJson: () => {},
    },
    { requireAccess: async () => ({ companyId: "22222222-2222-4222-8222-222222222222" }),
      patchModules: async (...args) => { patched = args; return {}; } },
  );
  assert.equal(patched[1], "workorder-1");
  assert.deepEqual(patched[2], ["diagnosisRepair"]);
  assert.equal(patched[3].formData.laborProduct.productId, productId);
});

test("legacy Office patch assigns changed labor hours to the Diagnosis and repair module", async () => {
  let patched;
  await handleOfficeApi(
    { method: "PATCH" }, {}, new URL("http://example.test/api/office/workorders/workorder-1"),
    {
      requestContext: context,
      readBody: async () => ({ formData: { laborHours: "3.5" } }),
      sendJson: () => {},
    },
    { patchModules: async (...args) => { patched = args; return {}; } },
  );

  assert.deepEqual(patched[2], ["diagnosisRepair"]);
  assert.equal(patched[3].formData.laborHours, "3.5");
});

test("Office discount intent requires customer-document permission and the existing Concern module write", async () => {
  const revisionId = "44444444-4444-4444-8444-444444444444";
  const body = {
    formData: {
      customerDocumentAdjustments: {
        lineDiscounts: [],
        documentDiscount: { kind: "percentage", value: "", reason: "" },
        overrideReasons: [],
      },
      customerDocumentAdjustmentBaseRevisionId: revisionId,
    },
  };
  let patched;
  await handleOfficeApi(
    { method: "PATCH" }, {}, new URL("http://example.test/api/office/workorders/workorder-1"),
    { requestContext: context, readBody: async () => body, sendJson: () => {} },
    { requireAccess: async () => ({ companyId: "22222222-2222-4222-8222-222222222222" }),
      patchModules: async (...args) => { patched = args; return {}; } },
  );

  assert.deepEqual(patched[2], ["concern"]);
  assert.deepEqual(patched[3].formData.customerDocumentAdjustments, body.formData.customerDocumentAdjustments);
  assert.equal(patched[3].formData.customerDocumentAdjustmentBaseRevisionId, revisionId);

  await assert.rejects(
    handleOfficeApi(
      { method: "PATCH" }, {}, new URL("http://example.test/api/office/workorders/workorder-1"),
      {
        requestContext: { ...context, permissions: new Set([PERMISSION.WORKORDER_OFFICE]) },
        readBody: async () => body,
        sendJson: () => {},
      },
      { requireAccess: async () => ({ companyId: "22222222-2222-4222-8222-222222222222" }),
        patchModules: async () => ({}) },
    ),
    (error) => error?.statusCode === 403,
  );
});

test("customer-document read-only Office users can save unrelated fields when financial keys are omitted", async () => {
  const readOnlyContext = {
    ...context,
    permissions: new Set([PERMISSION.WORKORDER_OFFICE, PERMISSION.CUSTOMER_DOCUMENT_READ]),
  };
  let patched;
  await handleOfficeApi(
    { method: "PATCH" }, {}, new URL("http://example.test/api/office/workorders/workorder-1"),
    {
      requestContext: readOnlyContext,
      readBody: async () => ({ formData: { workStartDate: "2026-08-03" } }),
      sendJson: () => {},
    },
    { patchModules: async (...args) => { patched = args; return {}; } },
  );

  assert.deepEqual(patched[2], ["schedule"]);
  assert.equal(Object.hasOwn(patched[3].formData, "customerDocumentAdjustments"), false);
  assert.equal(Object.hasOwn(patched[3].formData, "customerDocumentAdjustmentBaseRevisionId"), false);
});
