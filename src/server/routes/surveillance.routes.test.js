import assert from "node:assert/strict";
import test from "node:test";

import { handleSurveillanceApi } from "./surveillance.routes.js";

const WORKORDER_ID = "11111111-1111-4111-8111-111111111111";
const requestContext = { actor: { id: "surveillance-one", role: "surveillance" } };

function harness(method, suffix, body = {}) {
  const responses = [];
  return {
    req: { method, requestId: "request-one" },
    res: {},
    url: new URL(`/api/surveillance/workorders/${WORKORDER_ID}/${suffix}`, "http://localhost"),
    helpers: {
      requestContext,
      readBody: async () => body,
      sendJson: (_res, status, payload) => responses.push({ status, payload }),
    },
    responses,
  };
}

test("legacy Surveillance Odoo routes remain aliases of shared module operations", async () => {
  const calls = [];
  const dependencies = {
    odooReadiness: async (...args) => {
      calls.push(["readiness", ...args]);
      return { ready: true };
    },
    prepareOdoo: async (...args) => {
      calls.push(["preparation", ...args]);
      return { saved: true };
    },
    createOdooDraft: async (...args) => {
      calls.push(["draft", ...args]);
      return { serviceOrderNumber: "S0001" };
    },
    markMissingInfo: async (...args) => {
      calls.push(["missing-info", ...args]);
      return { status: "missing_info" };
    },
  };

  const readiness = harness("GET", "odoo-readiness");
  const preparation = harness("PUT", "odoo-preparation", { laborHours: "1.25" });
  const draft = harness("POST", "odoo-draft", { expectedUpdatedAt: "2026-08-08T10:00:00.000Z" });
  const missing = harness("POST", "mark-missing-info", { note: "Need VIN" });

  for (const target of [readiness, preparation, draft, missing]) {
    assert.equal(await handleSurveillanceApi(
      target.req,
      target.res,
      target.url,
      target.helpers,
      dependencies,
    ), true);
  }

  assert.deepEqual(calls, [
    ["readiness", requestContext, WORKORDER_ID],
    ["preparation", requestContext, WORKORDER_ID, { laborHours: 1.25 }],
    ["draft", requestContext, WORKORDER_ID, {
      expectedUpdatedAt: "2026-08-08T10:00:00.000Z",
      requestId: "request-one",
    }],
    ["missing-info", requestContext, WORKORDER_ID, { note: "Need VIN" }],
  ]);
  assert.deepEqual(readiness.responses, [{ status: 200, payload: { ready: true } }]);
  assert.deepEqual(draft.responses, [{
    status: 201,
    payload: { serviceOrderNumber: "S0001" },
  }]);
  assert.deepEqual(missing.responses, [{
    status: 200,
    payload: { odooEntry: { status: "missing_info" } },
  }]);
});

test("legacy mark-entered route requires generic Odoo write authorization", async () => {
  const calls = [];
  const target = harness("POST", "mark-odoo-entered", {
    odooServiceOrderNo: "S0002",
    note: "Entered",
  });
  const dependencies = {
    authorizeModule: async (...args) => calls.push(["authorize", ...args]),
    markOdooEntered: async (...args) => {
      calls.push(["mark", ...args]);
      return { status: "entered" };
    },
  };

  assert.equal(await handleSurveillanceApi(
    target.req,
    target.res,
    target.url,
    target.helpers,
    dependencies,
  ), true);
  assert.deepEqual(calls, [
    ["authorize", requestContext, WORKORDER_ID, {
      moduleKey: "odoo",
      capability: "write",
      action: "markEntered",
    }],
    ["mark", WORKORDER_ID, {
      odooServiceOrderNo: "S0002",
      note: "Entered",
      userId: "surveillance-one",
    }],
  ]);
});
