import test from "node:test";
import assert from "node:assert/strict";
import { authorizeProductModule, productModuleBootstrap, requireAdminProductModuleScope, resolveProductModuleQueryScope } from "./product-module-access.service.js";

const companyId = "11111111-1111-4111-8111-111111111111";
const locationId = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";
const context = {
  actor: { id: userId, role: "office" },
  companyIds: new Set([companyId]), locationIds: new Set([locationId]),
  companyRoles: new Map([[companyId, "office"]]),
};

test("bootstrap matches the versioned multi-scope contract and compatibility defaults", async () => {
  const result = await productModuleBootstrap(context, {
    listRules: async () => [{ companyId, locationId, subjectType: "role", subjectId: "office", moduleKey: "inspections", mode: "read", version: 1 }],
    listLocations: async () => [{ companyId, locationId }],
  });
  assert.deepEqual(result, { version: 1, companies: [{
    companyId, role: "office", modules: { workorders: "full", inspections: "full" },
    locations: [{ locationId, modules: { workorders: "full", inspections: "read" } }],
  }] });
});

test("read mode denies write capability", async () => {
  const deps = { listRules: async () => [{ companyId, locationId, subjectType: "user", subjectId: userId, moduleKey: "inspections", mode: "read", version: 2 }] };
  assert.equal((await authorizeProductModule(context, { companyId, locationId, moduleKey: "inspections" }, "read", deps)).mode, "read");
  await assert.rejects(authorizeProductModule(context, { companyId, locationId, moduleKey: "inspections" }, "write", deps), /permission/i);
});

test("cross-tenant scope fails without exposing a module decision", async () => {
  await assert.rejects(authorizeProductModule(context, {
    companyId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", locationId, moduleKey: "inspections",
  }, "read", { listRules: async () => assert.fail("must deny before query") }), /not found/i);
});

test("query scope contains only locations where the requested capability is effective", async () => {
  const result = await resolveProductModuleQueryScope(context, { moduleKey: "workorders", capability: "read" }, {
    listRules: async () => [{ companyId, locationId, subjectType: "role", subjectId: "office", moduleKey: "workorders", mode: "off", version: 1 }],
    listLocations: async () => [{ companyId, locationId }],
  });
  assert.deepEqual(result, { companyIds: [companyId], locationIds: [] });
});

test("company admin may manage a company-owned location without location membership", async () => {
  const adminContext = {
    actor: { id: userId, role: "admin" },
    companyIds: new Set([companyId]),
    locationIds: new Set(),
    companyRoles: new Map([[companyId, "admin"]]),
  };
  assert.deepEqual(await requireAdminProductModuleScope(adminContext, companyId, locationId, {
    getLocation: async () => ({ id: locationId, company_id: companyId }),
  }), { companyId, locationId });
  await assert.rejects(requireAdminProductModuleScope(adminContext, companyId, locationId, {
    getLocation: async () => ({ id: locationId, company_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }),
  }), /not found/i);
});
