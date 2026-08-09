import assert from "node:assert/strict";
import test from "node:test";

import {
  buildModulePolicyAuditPayload,
  emitModulePolicyAudit,
  modulePolicyChanges,
} from "./module-policy-audit.js";

const BASE = {
  moduleAccess: { office: { detail: { odoo: "read" } } },
  userModuleAccess: {},
};

test("policy diff reports role and named-user changes without unchanged fields", () => {
  assert.deepEqual(modulePolicyChanges(BASE, {
    moduleAccess: { office: { detail: { odoo: "write" } } },
    userModuleAccess: { "user-1": { detail: { parts: "hidden" } } },
  }), [
    {
      targetType: "role",
      targetId: "office",
      moduleKey: "odoo",
      surface: "detail",
      before: "read",
      after: "write",
    },
    {
      targetType: "user",
      targetId: "user-1",
      moduleKey: "parts",
      surface: "detail",
      before: "inherit",
      after: "hidden",
    },
  ]);
});

test("audit adapter emits exactly one successful payload for a multi-change patch", async () => {
  const emitted = [];
  const payload = await emitModulePolicyAudit({
    emitAuditEvent: async (event) => emitted.push(event),
  }, {
    actorId: "admin-1",
    companyId: "company-1",
    locationId: "location-1",
    requestId: "request-1",
    timestamp: "2026-08-08T12:00:00.000Z",
    beforePolicy: BASE,
    afterPolicy: {
      moduleAccess: { office: { detail: { odoo: "write" } } },
      userModuleAccess: { "user-1": { detail: { parts: "hidden" } } },
    },
  });

  assert.equal(emitted.length, 1);
  assert.equal(emitted[0], payload);
  assert.equal(payload.type, "policy.module_access.changed");
  assert.equal(payload.scope, "location");
  assert.equal(payload.requestId, "request-1");
  assert.equal(payload.changes.length, 2);
});

test("audit adapter does not emit for a no-op policy write", async () => {
  let calls = 0;
  const payload = await emitModulePolicyAudit({ emitAuditEvent: async () => { calls += 1; } }, {
    actorId: "admin-1",
    companyId: "company-1",
    beforePolicy: BASE,
    afterPolicy: BASE,
  });
  assert.equal(payload, null);
  assert.equal(calls, 0);
});

test("payload contains the approved actor, scope, subject, module, page, before and after fields", () => {
  const payload = buildModulePolicyAuditPayload({
    actorId: "admin-1",
    companyId: "company-1",
    beforePolicy: {},
    afterPolicy: BASE,
    requestId: "request-2",
    timestamp: "2026-08-08T12:00:00.000Z",
  });
  assert.deepEqual(payload.changes[0], {
    targetType: "role",
    targetId: "office",
    moduleKey: "odoo",
    surface: "detail",
    before: "inherit",
    after: "read",
  });
});
