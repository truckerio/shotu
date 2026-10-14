import assert from "node:assert/strict";
import test from "node:test";
import { patchCanonicalModuleAccess, readCanonicalUserModuleAccess } from "./module-access.service.js";

const companyId = "11111111-1111-4111-8111-111111111111";
const lowerRoleCompanyId = "33333333-3333-4333-8333-333333333333";
const context = {
  actor: { id: "admin-1", role: "admin" },
  companyIds: new Set([companyId]),
  companyRoles: new Map([[companyId, "admin"]]),
  locationIds: new Set(),
  sessionMode: "standard",
};

test("canonical module access rejects a lower-role company before policy read or write", async () => {
  let policyReads = 0;
  let policyWrites = 0;
  const mixed = {
    ...context,
    companyIds: new Set([companyId, lowerRoleCompanyId]),
    companyRoles: new Map([[companyId, "admin"], [lowerRoleCompanyId, "mechanic"]]),
  };
  await assert.rejects(
    patchCanonicalModuleAccess(mixed, "role", "office", {
      companyId: lowerRoleCompanyId,
      surface: "detail",
      moduleKey: "odoo",
      access: "read",
      required: false,
    }, {
      getPolicy: async () => { policyReads += 1; return null; },
      savePolicy: async () => { policyWrites += 1; return null; },
    }),
    (error) => error.statusCode === 403,
  );
  assert.equal(policyReads, 0);
  assert.equal(policyWrites, 0);
});

test("location module access verifies the location belongs to the effective Admin company", async () => {
  let policyReads = 0;
  await assert.rejects(
    readCanonicalUserModuleAccess(context, "22222222-2222-4222-8222-222222222222", {
      companyId,
      locationId: "44444444-4444-4444-8444-444444444444",
    }, {
      getLocation: async () => ({
        id: "44444444-4444-4444-8444-444444444444",
        company_id: lowerRoleCompanyId,
      }),
      getPolicy: async () => { policyReads += 1; return null; },
    }),
    (error) => error.statusCode === 404,
  );
  assert.equal(policyReads, 0);
});

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
