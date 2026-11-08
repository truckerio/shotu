import test from "node:test";
import assert from "node:assert/strict";
import { handleCustomerRepairPortalApi } from "./customer-repair-portal.routes.js";
import { permissionForRequest } from "../auth/policy.js";
import { PERMISSION } from "../auth/permissions.js";
const id = "30000000-0000-4000-8000-000000000001";
test("only explicit repair portal read/response/chat/export operations are public", () => {
  for (const [method, path] of [
    ["GET", "/api/customer-repair/portal"],
    ["POST", "/api/customer-repair/portal/responses"],
    ["GET", "/api/customer-repair/portal/chat"],
    ["POST", "/api/customer-repair/portal/chat"],
    ["GET", "/api/customer-repair/export"],
  ])
    assert.equal(permissionForRequest(method, path), null);
  for (const [method, path] of [
    ["POST", `/api/customer-repair/workorders/${id}/links`],
    ["POST", `/api/customer-repair/links/${id}/revoke`],
    ["POST", `/api/customer-repair/links/${id}/email`],
    ["GET", `/api/customer-repair/workorders/${id}/chat`],
    ["POST", "/api/customer-repair/portal"],
    ["DELETE", "/api/customer-repair/portal/chat"],
  ])
    assert.equal(
      permissionForRequest(method, path),
      PERMISSION.CUSTOMER_DOCUMENT_WRITE,
    );
});
test("public repair routes use header capability, never URL or session identity", async () => {
  let captured;
  const helpers = {
    requestContext: { actor: { id } },
    readBody: async () => ({ revisionId: id }),
    sendJson: (_, status, result) => {
      assert.equal(status, 200);
      assert.equal(result.ok, true);
    },
  };
  await handleCustomerRepairPortalApi(
    { method: "GET", headers: { "x-customer-repair-grant": "header-token" } },
    {},
    new URL(
      "https://example.test/api/customer-repair/portal?token=query-token",
    ),
    helpers,
    {
      readCustomerRepairPortal: async (token) => (
        (captured = token),
        { ok: true }
      ),
    },
  );
  assert.equal(captured, "header-token");
});
test("staff link routes pass authenticated context and exact workorder to service", async () => {
  const context = { actor: { id } };
  let captured;
  let status;
  await handleCustomerRepairPortalApi(
    { method: "POST" },
    {},
    new URL(`https://example.test/api/customer-repair/workorders/${id}/links`),
    {
      requestContext: context,
      readBody: async () => ({ companyId: "company" }),
      sendJson: (_, code) => (status = code),
    },
    {
      createCustomerRepairLink: async (...args) => {
        captured = args;
        return {};
      },
    },
  );
  assert.equal(status, 201);
  assert.deepEqual(captured, [context, id, { companyId: "company" }]);
});
test("unmatched repair routes remain unhandled", async () => {
  assert.equal(
    await handleCustomerRepairPortalApi(
      { method: "DELETE" },
      {},
      new URL("https://example.test/api/customer-repair/portal"),
      {},
    ),
    false,
  );
});
