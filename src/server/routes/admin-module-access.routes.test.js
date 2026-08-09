import assert from "node:assert/strict";
import test from "node:test";
import { handleAdminApi } from "./admin.routes.js";

const companyId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const context = { actor: { id: "admin-1", role: "admin" }, companyIds: new Set([companyId]) };

async function request(method, path, body, dependencies) {
  const responses = [];
  const emitted = [];
  const emitAdministrativeAuditEvent = async (event) => emitted.push(event);
  const handled = await handleAdminApi(
    { method, requestId: "req-1" },
    {},
    new URL(path, "http://localhost"),
    {
      requestContext: context,
      readBody: async () => body,
      sendJson: (_res, status, payload) => responses.push({ status, payload }),
      emitAdministrativeAuditEvent,
    },
    dependencies,
  );
  return { handled, responses, emitted, emitAdministrativeAuditEvent };
}

test("canonical admin module-access adapters preserve company and named-user scope", async () => {
  const calls = [];
  await request("GET", `/api/admin/module-access?companyId=${companyId}`, null, {
    readModuleAccess: async (...args) => { calls.push(["read", ...args]); return { version: 1 }; },
  });
  await request("GET", `/api/admin/module-access/users/${userId}?companyId=${companyId}`, null, {
    readUserModuleAccess: async (...args) => { calls.push(["user", ...args]); return { version: 1 }; },
  });
  const patchResult = await request("PATCH", "/api/admin/module-access/roles/office", {
    companyId, surface: "detail", moduleKey: "odoo", access: "read",
  }, {
    patchModuleAccess: async (...args) => { calls.push(["patch", ...args]); return { version: 2 }; },
  });
  assert.deepEqual(calls.map(([kind]) => kind), ["read", "user", "patch"]);
  assert.equal(calls[1][2], userId);
  assert.equal(calls[2][2], "role");
  assert.equal(calls[2][3], "office");
  assert.equal(calls[2][5].requestId, "req-1");
  assert.equal(calls[2][5].emitAuditEvent, patchResult.emitAdministrativeAuditEvent);
});
