import assert from "node:assert/strict";
import test from "node:test";

import { handleWorkorderModulesApi } from "./workorder-modules.routes.js";
import { runWorkorderModuleAction } from "../modules/workorders/workorder-module-runtime.service.js";

const WORKORDER_ID = "11111111-1111-4111-8111-111111111111";
const requestContext = { actor: { id: "admin-one", role: "admin" } };

function harness({ method, path, body = {} }) {
  const responses = [];
  return {
    req: { method, requestId: "request-one" },
    res: {},
    url: new URL(path, "http://localhost"),
    helpers: {
      requestContext,
      readBody: async () => body,
      sendJson: (_res, status, payload) => responses.push({ status, payload }),
    },
    responses,
  };
}

async function runRoute({ method, pathname, body = {}, dependencies = {} }) {
  const target = harness({ method, path: pathname, body });
  await handleWorkorderModulesApi(
    target.req, target.res, target.url, target.helpers, dependencies,
  );
  return target;
}

test("canonical readiness route passes authenticated context and workorder id", async () => {
  const target = harness({
    method: "GET",
    path: `/api/workorders/${WORKORDER_ID}/modules/odoo/readiness`,
  });
  let call = null;
  const handled = await handleWorkorderModulesApi(
    target.req,
    target.res,
    target.url,
    target.helpers,
    {
      readiness: async (...args) => {
        call = args;
        return { ready: true };
      },
    },
  );

  assert.equal(handled, true);
  assert.deepEqual(call, [requestContext, WORKORDER_ID]);
  assert.deepEqual(target.responses, [{ status: 200, payload: { ready: true } }]);
});

test("canonical Unit history route forwards bounded pagination input and authenticated context", async () => {
  const target = harness({
    method: "GET",
    path: `/api/workorders/${WORKORDER_ID}/modules/unit/history?limit=7&cursor=next-page`,
  });
  let call;
  const handled = await handleWorkorderModulesApi(
    target.req, target.res, target.url, target.helpers, {
      readUnitHistory: async (...args) => {
        call = args;
        return {
          state: "empty",
          unit: { assetId: "asset-1", unitNo: "G2116" },
          summary: {
            historyCount: 0, returnedCount: 0,
            lastCompletedServiceAt: null, latestRecordedServiceAt: null,
          },
          freshness: {
            state: "current", lastAttemptedAt: "2026-08-24T10:00:00Z",
            lastSucceededAt: "2026-08-24T10:00:01Z", lastErrorAt: null,
            errorCode: "", warning: "",
          },
          items: [],
          nextCursor: null,
        };
      },
    },
  );
  assert.equal(handled, true);
  assert.deepEqual(call, [requestContext, WORKORDER_ID, { limit: "7", cursor: "next-page" }]);
  assert.equal(target.responses[0].status, 200);
  assert.deepEqual(Object.keys(target.responses[0].payload), [
    "state", "unit", "summary", "freshness", "items", "nextCursor",
  ]);
  assert.deepEqual(Object.keys(target.responses[0].payload.summary), [
    "historyCount", "returnedCount", "lastCompletedServiceAt", "latestRecordedServiceAt",
  ]);
  assert.equal(target.responses[0].payload.freshness.state, "current");
});

test("canonical preparation and draft routes validate and forward provider inputs", async () => {
  const preparation = harness({
    method: "PUT",
    path: `/api/workorders/${WORKORDER_ID}/modules/odoo/preparation`,
    body: { laborHours: "2.50" },
  });
  let preparationInput = null;
  await handleWorkorderModulesApi(preparation.req, preparation.res, preparation.url, preparation.helpers, {
    prepare: async (_context, _workorderId, input) => {
      preparationInput = input;
      return { saved: true };
    },
  });
  assert.deepEqual(preparationInput, { laborHours: 2.5 });

  const draft = harness({
    method: "POST",
    path: `/api/workorders/${WORKORDER_ID}/modules/odoo/draft`,
    body: { expectedUpdatedAt: "2026-08-08T10:00:00.000Z" },
  });
  let draftInput = null;
  await handleWorkorderModulesApi(draft.req, draft.res, draft.url, draft.helpers, {
    createDraft: async (_context, _workorderId, input) => {
      draftInput = input;
      return { serviceOrderNumber: "S0001" };
    },
  });
  assert.deepEqual(draftInput, {
    expectedUpdatedAt: "2026-08-08T10:00:00.000Z",
    requestId: "request-one",
  });
  assert.equal(draft.responses[0].status, 201);
});

test("canonical missing-info route returns the compatibility response shape", async () => {
  const target = harness({
    method: "POST",
    path: `/api/workorders/${WORKORDER_ID}/modules/odoo/missing-info`,
    body: { note: "  Need VIN  " },
  });
  let input = null;
  await handleWorkorderModulesApi(target.req, target.res, target.url, target.helpers, {
    markMissingInfo: async (_context, _workorderId, value) => {
      input = value;
      return { status: "missing_info" };
    },
  });

  assert.deepEqual(input, { note: "Need VIN" });
  assert.deepEqual(target.responses, [{
    status: 200,
    payload: { odooEntry: { status: "missing_info" } },
  }]);
});

test("canonical part-mapping route validates and forwards an audited provider choice", async () => {
  const target = harness({
    method: "PUT",
    path: `/api/workorders/${WORKORDER_ID}/modules/odoo/part-mapping`,
    body: { lineIndex: "2", productExternalId: "40409" },
  });
  let input = null;
  await handleWorkorderModulesApi(target.req, target.res, target.url, target.helpers, {
    mapPart: async (_context, _workorderId, value) => {
      input = value;
      return { saved: true };
    },
  });
  assert.deepEqual(input, {
    lineIndex: 2,
    productExternalId: "40409",
    requestId: "request-one",
  });
  assert.equal(target.responses[0].status, 200);
});

test("module route ignores unrelated workorder paths", async () => {
  const target = harness({ method: "GET", path: `/api/workorders/${WORKORDER_ID}` });
  assert.equal(
    await handleWorkorderModulesApi(target.req, target.res, target.url, target.helpers),
    false,
  );
});

test("canonical generic module routes expose protected reads and allowlisted mutations", async () => {
  const calls = [];
  const dependencies = {
    readDetail: async (...args) => { calls.push(["detail", ...args]); return { modules: {} }; },
    readModule: async (...args) => { calls.push(["read", ...args]); return { modules: { concern: {} } }; },
    patchModule: async (...args) => { calls.push(["patch", ...args]); return { id: "wo-1" }; },
    runAction: async (...args) => { calls.push(["action", ...args]); return { id: "wo-1" }; },
  };
  await runRoute({ method: "GET", pathname: "/api/workorders/wo-1/modules", dependencies });
  await runRoute({ method: "GET", pathname: "/api/workorders/wo-1/modules/concern", dependencies });
  await runRoute({
    method: "PATCH", pathname: "/api/workorders/wo-1/modules/concern",
    body: { officeNotes: "Call customer" }, dependencies,
  });
  await runRoute({
    method: "POST", pathname: "/api/workorders/wo-1/modules/completion/actions/close",
    body: { note: "Reviewed" }, dependencies,
  });
  assert.deepEqual(calls.map(([kind]) => kind), ["detail", "read", "patch", "action"]);
  assert.equal(calls[2][3], "concern");
  assert.equal(calls[3][4], "close");
});

test("canonical Parts action validates and forwards serialized repair wording", async () => {
  const calls = [];
  const dependencies = {
    runAction: (...args) => runWorkorderModuleAction(...args, {
      authorize: async () => ({ companyId: WORKORDER_ID, locationId: WORKORDER_ID }),
      updateRepairOrder: async (input) => {
        calls.push(input);
        return { kind: "updated", usage: { id: input.usageId, repairOrder: input.repairOrder } };
      },
    }),
  };
  const body = {
    operation: "serializedUsageRepairOrder",
    usageId: WORKORDER_ID,
    repairOrder: "  Install sensor and verify operation  ",
  };
  const target = await runRoute({
    method: "POST",
    pathname: `/api/workorders/${WORKORDER_ID}/modules/parts/actions/record`,
    body,
    dependencies,
  });

  assert.equal(target.responses[0].status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].workorderId, WORKORDER_ID);
  assert.equal(calls[0].usageId, WORKORDER_ID);
  assert.equal(calls[0].repairOrder, "Install sensor and verify operation");
  assert.equal(calls[0].companyId, WORKORDER_ID);
  assert.equal(calls[0].locationId, WORKORDER_ID);

  await runRoute({
    method: "POST",
    pathname: `/api/workorders/${WORKORDER_ID}/modules/parts/actions/record`,
    body: { ...body, repairOrder: " " },
    dependencies,
  });
  assert.equal(calls[1].repairOrder, "");

  await assert.rejects(runRoute({
    method: "POST",
    pathname: `/api/workorders/${WORKORDER_ID}/modules/parts/actions/record`,
    body: { ...body, repairOrder: "x".repeat(2001) },
    dependencies,
  }), (error) => error.statusCode === 400);
  assert.equal(calls.length, 2);
});

test("canonical generic module routes default-deny unregistered mutations", async () => {
  await assert.rejects(runRoute({
    method: "POST",
    pathname: "/api/workorders/wo-1/modules/chat/actions/delete",
    body: {},
  }), (error) => error.statusCode === 403);
});

test("canonical authenticated create and create-context routes are role neutral", async () => {
  let createCall;
  const createTarget = await runRoute({
    method: "POST",
    pathname: "/api/workorders",
    body: {
      companyId: WORKORDER_ID,
      locationId: "22222222-2222-4222-8222-222222222222",
      concern: "Inspect brakes",
    },
    dependencies: {
      createWorkorder: async (...args) => { createCall = args; return { id: "wo-new" }; },
    },
  });
  assert.equal(createTarget.responses[0].status, 201);
  assert.equal(createCall[0], requestContext);
  assert.equal(createCall[1].concern, "Inspect brakes");

  const contextTarget = await runRoute({
    method: "GET",
    pathname: "/api/workorders/create-context",
    dependencies: { createContext: async () => ({ locations: [{ id: "loc-1" }] }) },
  });
  assert.equal(contextTarget.responses[0].payload.locations.length, 1);
});

test("canonical create accepts independent serialized rows and rejects grouped unit IDs", async () => {
  const catalogPartId = "33333333-3333-4333-8333-333333333333";
  const unitIds = [
    "44444444-4444-4444-8444-444444444441",
    "44444444-4444-4444-8444-444444444442",
  ];
  const body = {
    companyId: WORKORDER_ID,
    locationId: "22222222-2222-4222-8222-222222222222",
    concern: "Replace both sensors",
    formData: {
      parts: unitIds.map((unitId) => ({
        catalogPartId,
        partNo: "SENSOR-1",
        qty: "1",
        uomCode: "ea",
        serializedUnitIds: [unitId],
      })),
    },
    inventoryUnitSelections: unitIds.map((unitId, partIndex) => ({
      partIndex,
      catalogPartId,
      unitIds: [unitId],
    })),
  };
  let createInput;
  const target = await runRoute({
    method: "POST",
    pathname: "/api/workorders",
    body,
    dependencies: { createWorkorder: async (_context, input) => { createInput = input; return { id: "wo-serialized" }; } },
  });

  assert.equal(target.responses[0].status, 201);
  assert.deepEqual(createInput.inventoryUnitSelections.map((selection) => selection.unitIds), unitIds.map((unitId) => [unitId]));
  await assert.rejects(runRoute({
    method: "POST",
    pathname: "/api/workorders",
    body: {
      ...body,
      formData: { parts: [{ ...body.formData.parts[0], qty: "2", serializedUnitIds: unitIds }] },
      inventoryUnitSelections: [{ partIndex: 0, catalogPartId, unitIds }],
    },
  }), (error) => error.statusCode === 400 && /own part row/i.test(error.message));
});

test("mechanic creation uses the same canonical role-neutral create route", async () => {
  const mechanicContext = { actor: { id: "mechanic-one", role: "mechanic" } };
  const target = harness({
    method: "POST",
    path: "/api/workorders",
    body: {
      companyId: WORKORDER_ID,
      locationId: "22222222-2222-4222-8222-222222222222",
      concern: "Inspect brakes",
    },
  });
  target.helpers.requestContext = mechanicContext;
  let createCall;
  await handleWorkorderModulesApi(target.req, target.res, target.url, target.helpers, {
    createWorkorder: async (...args) => {
      createCall = args;
      return { id: "wo-mechanic", status: "in_progress" };
    },
  });
  assert.equal(createCall[0], mechanicContext);
  assert.equal(createCall[1].concern, "Inspect brakes");
  assert.deepEqual(target.responses, [{
    status: 201,
    payload: { workorder: { id: "wo-mechanic", status: "in_progress" } },
  }]);
});
