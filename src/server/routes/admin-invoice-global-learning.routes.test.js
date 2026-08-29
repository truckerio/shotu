import assert from "node:assert/strict";
import test from "node:test";
import { handleAdminApi } from "./admin.routes.js";

const COMPANY_ID = "11111111-1111-4111-8111-111111111111";
const ACTOR_ID = "22222222-2222-4222-8222-222222222222";

function context(role = "admin", companyIds = [COMPANY_ID]) {
  return { actor: { id: ACTOR_ID, role }, companyIds: new Set(companyIds), locationIds: new Set() };
}

function helpers(requestContext, body = {}) {
  return {
    requestContext,
    readBody: async () => body,
    sendJson: (res, status, payload) => Object.assign(res, { status, payload }),
    emitAdministrativeAuditEvent: async () => {},
  };
}

test("admin can read the company global invoice-learning policy through its canonical owner", async () => {
  const response = {};
  let companyId;
  const handled = await handleAdminApi(
    { method: "GET" },
    response,
    new URL(`http://localhost/api/admin/companies/${COMPANY_ID}/invoice-global-learning`),
    helpers(context()),
    {
      readInvoiceGlobalLearning: async (value) => {
        companyId = value;
        return { company_id: value, state: "disabled", version: 0 };
      },
    },
  );
  assert.equal(handled, true);
  assert.equal(companyId, COMPANY_ID);
  assert.equal(response.status, 200);
  assert.equal(response.payload.policy.state, "disabled");
});

test("policy change is explicit, optimistic, and returns accepted while withdrawal rebuilds", async () => {
  const response = {};
  const body = { enabled: false, expectedVersion: 3, policyVersion: "global-layout-v1", idempotencyKey: "withdraw-12345678" };
  let command;
  await handleAdminApi(
    { method: "PATCH" },
    response,
    new URL(`http://localhost/api/admin/companies/${COMPANY_ID}/invoice-global-learning`),
    helpers(context(), body),
    {
      changeInvoiceGlobalLearning: async (companyId, input, requestContext) => {
        command = { companyId, input, requestContext };
        return { consent: { company_id: companyId, state: "withdrawing", version: 4 }, rebuilds: [{ status: "queued" }] };
      },
    },
  );
  assert.equal(response.status, 202);
  assert.equal(command.companyId, COMPANY_ID);
  assert.deepEqual(command.input, body);
  assert.equal(command.requestContext.actor.id, ACTOR_ID);
  assert.equal(response.payload.rebuilds[0].status, "queued");
});

test("real policy service hides cross-company and non-admin access", async () => {
  for (const requestContext of [context("office"), context("admin", [])]) {
    await assert.rejects(
      () => handleAdminApi(
        { method: "GET" },
        {},
        new URL(`http://localhost/api/admin/companies/${COMPANY_ID}/invoice-global-learning`),
        helpers(requestContext),
        { readInvoiceGlobalLearning: undefined },
      ),
      (error) => error.statusCode === 404 && error.code === "invoice_global_layout_not_found",
    );
  }
});
