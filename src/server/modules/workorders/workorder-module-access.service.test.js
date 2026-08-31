import assert from "node:assert/strict";
import test from "node:test";

import {
  authorizeWorkorderCreate,
  authorizeWorkorderModule,
  authorizeWorkorderModuleActions,
  buildModuleAccessChangeEvent,
  resolveWorkorderModuleDecisions,
} from "./workorder-module-access.service.js";

const context = {
  actor: { id: "user-1", role: "office" },
  companyIds: new Set(["company-1"]),
};

const workorder = {
  id: "workorder-1",
  companyId: "company-1",
  locationId: "location-1",
  status: "work_done",
};

test("module authorization loads policy once and allows declared read access", async () => {
  let loads = 0;
  const result = await authorizeWorkorderModule(context, workorder.id, {
    moduleKey: "odoo",
    capability: "read",
  }, {
    requireAccess: async () => workorder,
    getEffectivePolicy: async () => {
      loads += 1;
      return {
        companyPolicy: { moduleAccess: { office: { detail: { odoo: "read" } } } },
        locationPolicy: null,
      };
    },
  });

  assert.equal(loads, 1);
  assert.equal(result.access, "read");
  assert.equal(result.source, "company");
});

test("module authorization denies write through a read-only grant", async () => {
  await assert.rejects(
    authorizeWorkorderModule(context, workorder.id, {
      moduleKey: "odoo",
      capability: "write",
    }, {
      requireAccess: async () => workorder,
      getEffectivePolicy: async () => ({
        companyPolicy: { moduleAccess: { office: { detail: { odoo: "read" } } } },
        locationPolicy: null,
      }),
    }),
    (error) => error.statusCode === 403 && error.code === "PERMISSION_DENIED",
  );
});

test("module authorization denies unknown modules by default", async () => {
  await assert.rejects(
    authorizeWorkorderModule(context, workorder.id, {
      moduleKey: "not-registered",
      capability: "read",
    }, {
      requireAccess: async () => workorder,
      getEffectivePolicy: async () => ({ companyPolicy: null, locationPolicy: null }),
    }),
    (error) => error.statusCode === 403,
  );
});

test("module authorization denies actions not owned by the module", async () => {
  await assert.rejects(
    authorizeWorkorderModule(context, workorder.id, {
      moduleKey: "odoo",
      capability: "write",
      action: "deleteEverything",
    }, {
      requireAccess: async () => workorder,
      getEffectivePolicy: async () => ({ companyPolicy: null, locationPolicy: null }),
    }),
    (error) => error.statusCode === 403,
  );
});

test("module actions require their declared capability and Parts requests remain available in View", async () => {
  await assert.rejects(
    authorizeWorkorderModule(context, workorder.id, {
      moduleKey: "odoo",
      capability: "read",
      action: "prepare",
    }, {
      requireAccess: async () => workorder,
      getEffectivePolicy: async () => ({
        companyPolicy: { moduleAccess: { office: { detail: { odoo: "read" } } } },
        locationPolicy: null,
      }),
    }),
    (error) => error.statusCode === 403,
  );

  const mechanicContext = { ...context, actor: { id: "mechanic-1", role: "mechanic" } };
  const request = await authorizeWorkorderModule(mechanicContext, workorder.id, {
    moduleKey: "parts",
    capability: "read",
    action: "request",
  }, {
    requireAccess: async () => workorder,
    getEffectivePolicy: async () => ({
      companyPolicy: { moduleAccess: { mechanic: { detail: { parts: "read" } } } },
      locationPolicy: null,
    }),
  });
  assert.equal(request.access, "read");

  await assert.rejects(authorizeWorkorderModule(mechanicContext, workorder.id, {
    moduleKey: "parts",
    capability: "read",
    action: "record",
  }, {
    requireAccess: async () => workorder,
    getEffectivePolicy: async () => ({ companyPolicy: null, locationPolicy: null }),
  }), (error) => error.statusCode === 403);
});

test("part scanning defaults to Office and supports a narrow named-Mechanic grant", async () => {
  const dependencies = {
    requireAccess: async () => workorder,
    getEffectivePolicy: async () => ({ companyPolicy: null, locationPolicy: null }),
  };
  assert.equal((await authorizeWorkorderModule(context, workorder.id, {
    moduleKey: "partsScanning", capability: "write", action: "issue",
  }, dependencies)).access, "write");

  const mechanicContext = { ...context, actor: { id: "mechanic-1", role: "mechanic" } };
  await assert.rejects(authorizeWorkorderModule(mechanicContext, workorder.id, {
    moduleKey: "partsScanning", capability: "write", action: "issue",
  }, dependencies), (error) => error.statusCode === 403);

  const granted = await authorizeWorkorderModule(mechanicContext, workorder.id, {
    moduleKey: "partsScanning", capability: "write", action: "issue",
  }, {
    ...dependencies,
    getEffectivePolicy: async () => ({
      companyPolicy: { userModuleAccess: { "mechanic-1": { detail: { partsScanning: "write" } } } },
      locationPolicy: null,
    }),
  });
  assert.equal(granted.access, "write");
  assert.equal(granted.source, "company_user");
});

test("explicit policy grants are not blocked by legacy role ownership hints", async () => {
  const result = await authorizeWorkorderModule(
    { ...context, actor: { id: "user-1", role: "surveillance" } }, workorder.id, {
      moduleKey: "unit",
      capability: "write",
      action: "update",
    }, {
      requireAccess: async () => workorder,
      getEffectivePolicy: async () => ({
        companyPolicy: { moduleAccess: { surveillance: { detail: { unit: "write" } } } },
        locationPolicy: null,
      }),
    },
  );
  assert.equal(result.access, "write");
});

test("permission event seam exposes structured before and after values without persistence", () => {
  assert.deepEqual(buildModuleAccessChangeEvent({
    actorId: "admin-1",
    companyId: "company-1",
    locationId: "location-1",
    targetType: "role",
    targetId: "office",
    moduleKey: "odoo",
    surface: "detail",
    before: "hidden",
    after: "read",
    requestId: "request-1",
    timestamp: "2026-08-08T00:00:00.000Z",
  }), {
    type: "policy.module_access.changed",
    actorId: "admin-1",
    companyId: "company-1",
    locationId: "location-1",
    targetType: "role",
    targetId: "office",
    moduleKey: "odoo",
    surface: "detail",
    before: "hidden",
    after: "read",
    requestId: "request-1",
    timestamp: "2026-08-08T00:00:00.000Z",
  });
});

test("batch authorization loads the workorder and effective policy once", async () => {
  let policyLoads = 0;
  const result = await authorizeWorkorderModuleActions(context, workorder.id, [
    { moduleKey: "parts", capability: "write", action: "approve" },
    { moduleKey: "chat", capability: "write", action: "send" },
  ], {}, {
    requireAccess: async () => workorder,
    getEffectivePolicy: async () => {
      policyLoads += 1;
      return {
        companyPolicy: { moduleAccess: { office: { detail: { parts: "write", chat: "write" } } } },
        locationPolicy: null,
      };
    },
  });
  assert.equal(policyLoads, 1);
  assert.equal(result.authorizations.length, 2);
});

test("create authorization requires write access to the mandatory concern module", async () => {
  await assert.rejects(authorizeWorkorderCreate(context, {
    companyId: "company-1",
    locationId: "location-1",
    moduleKeys: ["location", "concern"],
  }, {
    getEffectivePolicy: async () => ({
      companyPolicy: { moduleAccess: { office: { create: { concern: "hidden", unit: "write" } } } },
      locationPolicy: null,
    }),
  }), (error) => error.statusCode === 403);
});

test("detail resolution returns hidden decisions without exposing policy internals", async () => {
  const result = await resolveWorkorderModuleDecisions(context, workorder.id, {}, {
    requireAccess: async () => workorder,
    getEffectivePolicy: async () => ({
      companyPolicy: { moduleAccess: { office: { detail: { concern: "hidden" } } } },
      locationPolicy: null,
    }),
  });
  assert.deepEqual(result.decisions.concern, { access: "hidden", source: "company" });
  assert.equal(result.decisions.unit.access, "write");
  assert.equal("companyPolicy" in result, false);
});
