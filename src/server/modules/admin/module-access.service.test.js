import assert from "node:assert/strict";
import test from "node:test";
import { patchCanonicalModuleAccess, readCanonicalUserModuleAccess } from "./module-access.service.js";

const companyId = "11111111-1111-4111-8111-111111111111";
const context = { actor: { id: "admin-1", role: "admin" }, companyIds: new Set([companyId]), locationIds: new Set() };

test("canonical role patch writes one normalized sparse decision with optimistic version", async () => {
  let saved;
  await patchCanonicalModuleAccess(context, "role", "office", {
    companyId, surface: "detail", moduleKey: "odoo", access: "read", required: false, expectedVersion: 2,
  }, {
    getPolicy: async () => ({ companyId, moduleAccess: {}, userModuleAccess: {}, version: 2 }),
    savePolicy: async (input) => { saved = input; return input; },
  });
  assert.deepEqual(saved.moduleAccess, { office: { detail: { odoo: "read" } } });
  assert.equal(saved.expectedVersion, 2);
  assert.equal(saved.actorId, "admin-1");
});

test("canonical adapter allows explicit cross-role writes for registered writable modules", async () => {
  let saved;
  await patchCanonicalModuleAccess(context, "role", "surveillance", {
    companyId, surface: "detail", moduleKey: "unit", access: "write", required: false,
  }, {
    getPolicy: async () => ({ companyId, moduleAccess: {}, userModuleAccess: {}, version: 0 }),
    savePolicy: async (input) => { saved = input; return input; },
  });
  assert.equal(saved.moduleAccess.surveillance.detail.unit, "write");
});

test("canonical user read returns only the requested named-user rules", async () => {
  const userId = "22222222-2222-4222-8222-222222222222";
  const result = await readCanonicalUserModuleAccess(context, userId, { companyId }, {
    getPolicy: async () => ({
      companyId,
      moduleAccess: {},
      userModuleAccess: { [userId]: { detail: { odoo: "write" } }, other: { detail: { chat: "read" } } },
      version: 4,
    }),
  });
  assert.deepEqual(result.moduleAccess, { detail: { odoo: "write" } });
});

test("canonical rule patch emits one correlated audit envelope after persistence", async () => {
  const events = [];
  await patchCanonicalModuleAccess(context, "role", "office", {
    companyId, surface: "detail", moduleKey: "odoo", access: "write", required: false, expectedVersion: 1,
  }, {
    getPolicy: async () => ({
      companyId, moduleAccess: { office: { detail: { odoo: "read" } } }, userModuleAccess: {}, version: 1,
    }),
    savePolicy: async (input) => ({ ...input, version: 2 }),
    emitAuditEvent: async (event) => events.push(event),
    requestId: "request-1",
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].requestId, "request-1");
  assert.deepEqual(events[0].changes, [{
    targetType: "role", targetId: "office", moduleKey: "odoo", surface: "detail", before: "read", after: "write",
  }]);
});
