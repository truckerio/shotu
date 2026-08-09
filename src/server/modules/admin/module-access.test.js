import assert from "node:assert/strict";
import test from "node:test";

import {
  adminCompanyWorkorderModulePolicy,
  adminWorkorderModuleCatalog,
  saveAdminCompanyWorkorderModulePolicy,
} from "./admin.service.js";

const COMPANY_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_COMPANY_ID = "22222222-2222-4222-8222-222222222222";
const context = {
  actor: { id: "admin-1", role: "admin" },
  companyIds: new Set([COMPANY_ID]),
};

test("admin module catalog exposes stable owned module definitions", () => {
  const catalog = adminWorkorderModuleCatalog();
  assert.equal(catalog.version, 1);
  assert.equal(catalog.modules.find(({ key }) => key === "odoo").owner, "integrations.odoo");
});

test("company module policy is tenant scoped and returns sparse defaults", async () => {
  const policy = await adminCompanyWorkorderModulePolicy(context, COMPANY_ID, {
    getPolicy: async () => null,
  });
  assert.deepEqual(policy.moduleAccess, {});
  assert.deepEqual(policy.userModuleAccess, {});
  assert.equal(policy.version, 0);
  await assert.rejects(
    adminCompanyWorkorderModulePolicy(context, OTHER_COMPANY_ID, { getPolicy: async () => null }),
    (error) => error.statusCode === 403 && error.code === "PERMISSION_DENIED",
  );
});

test("company module policy save records the authenticated actor", async () => {
  let saved = null;
  await saveAdminCompanyWorkorderModulePolicy(
    context,
    COMPANY_ID,
    {
      moduleAccess: { office: { detail: { odoo: "read" } } },
      userModuleAccess: { "user-1": { detail: { odoo: "write" } } },
      expectedVersion: 3,
    },
    "admin-1",
    {
      savePolicy: async (input) => {
        saved = input;
        return input;
      },
    },
  );
  assert.deepEqual(saved, {
    actorId: "admin-1",
    companyId: COMPANY_ID,
    moduleAccess: { office: { detail: { odoo: "read" } } },
    userModuleAccess: { "user-1": { detail: { odoo: "write" } } },
    expectedVersion: 3,
  });
});

test("company policy save emits one audit envelope only after persistence succeeds", async () => {
  const emitted = [];
  const savedPolicy = {
    companyId: COMPANY_ID,
    moduleAccess: { office: { detail: { odoo: "write" } } },
    userModuleAccess: {},
    version: 4,
  };
  const result = await saveAdminCompanyWorkorderModulePolicy(
    context,
    COMPANY_ID,
    {
      moduleAccess: savedPolicy.moduleAccess,
      userModuleAccess: {},
      expectedVersion: 3,
    },
    "admin-1",
    {
      getPolicy: async () => ({
        companyId: COMPANY_ID,
        moduleAccess: { office: { detail: { odoo: "read" } } },
        userModuleAccess: {},
        version: 3,
      }),
      savePolicy: async () => savedPolicy,
      emitAuditEvent: async (event) => emitted.push(event),
      requestId: "request-1",
    },
  );
  assert.equal(result, savedPolicy);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].requestId, "request-1");
  assert.deepEqual(emitted[0].changes, [{
    targetType: "role",
    targetId: "office",
    moduleKey: "odoo",
    surface: "detail",
    before: "read",
    after: "write",
  }]);
});

test("failed company policy persistence emits no audit event", async () => {
  let emitted = 0;
  await assert.rejects(saveAdminCompanyWorkorderModulePolicy(
    context,
    COMPANY_ID,
    { moduleAccess: {}, userModuleAccess: {}, expectedVersion: 2 },
    "admin-1",
    {
      getPolicy: async () => ({ moduleAccess: {}, userModuleAccess: {}, version: 2 }),
      savePolicy: async () => { throw Object.assign(new Error("conflict"), { statusCode: 409 }); },
      emitAuditEvent: async () => { emitted += 1; },
    },
  ));
  assert.equal(emitted, 0);
});
