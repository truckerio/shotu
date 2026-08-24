import assert from "node:assert/strict";
import test from "node:test";
import {
  createWorkorderRuntime,
  patchWorkorderModule,
  patchWorkorderModules,
  protectedWorkorderModule,
  readWorkorderUnitHistory,
  runWorkorderModuleAction,
  workorderCreateContext,
} from "./workorder-module-runtime.service.js";

const context = { actor: { id: "actor-1", role: "office" } };

test("protected module read never loads data before authorization", async () => {
  const calls = [];
  await assert.rejects(protectedWorkorderModule(context, "wo-1", "concern", {
    authorize: async () => { calls.push("authorize"); throw new Error("denied"); },
    loadDetail: async () => { calls.push("load"); },
  }), /denied/);
  assert.deepEqual(calls, ["authorize"]);
});

test("Unit history runtime forwards query input through the dedicated reader", async () => {
  const calls = [];
  const result = await readWorkorderUnitHistory(context, "wo-1", { limit: "10", cursor: "next" }, {
    readHistory: async (...args) => { calls.push(args); return { state: "ready" }; },
  });
  assert.equal(result.state, "ready");
  assert.equal(calls[0][0], context);
  assert.equal(calls[0][1], "wo-1");
  assert.deepEqual(calls[0][2], { limit: "10", cursor: "next" });
});

test("generic patch authorizes the exact module and passes authenticated actor", async () => {
  const calls = [];
  const result = await patchWorkorderModule(context, "wo-1", "concern", { officeNotes: "note" }, {
    authorize: async (...args) => calls.push(args),
    updateOffice: async (...args) => args,
  });
  assert.equal(calls[0][2].moduleKey, "concern");
  assert.equal(calls[0][2].action, "update");
  assert.equal(result[1].officeUserId, "actor-1");
});

test("office and admin diagnosis edits use office persistence instead of mechanic-only progress", async () => {
  for (const role of ["office", "admin"]) {
    const calls = [];
    const result = await patchWorkorderModule(
      { actor: { id: `${role}-actor`, role } },
      "wo-1",
      "diagnosisRepair",
      { diagnosis: "Found leak", workPerformed: "Replaced seal" },
      {
        authorize: async () => {},
        updateOffice: async (...args) => { calls.push(args); return args; },
        updateMechanic: async () => assert.fail("office/admin must not use mechanic persistence"),
      },
    );
    assert.equal(result[1].officeUserId, `${role}-actor`);
    assert.equal(calls.length, 1);
  }
});

test("compatibility batch patch authorizes every touched module and persists once", async () => {
  const calls = [];
  const result = await patchWorkorderModules(context, "wo-1", ["unit", "schedule"], { formData: { unitNo: "17" } }, {
    authorizeMany: async (...args) => calls.push(args),
    updateOffice: async (...args) => args,
  });
  assert.deepEqual(calls[0][2].map(({ moduleKey, action }) => [moduleKey, action]), [
    ["unit", "update"],
    ["schedule", "update"],
  ]);
  assert.equal(result[1].officeUserId, "actor-1");
});

test("generic action routes assignment through authenticated actor after module guard", async () => {
  const calls = [];
  const result = await runWorkorderModuleAction(context, "wo-1", "assignment", "assign", {
    mechanicUserIds: [], reason: "Schedule change",
  }, {
    authorize: async (...args) => calls.push(args),
    assign: async (...args) => args,
  });
  assert.equal(calls[0][2].action, "assign");
  assert.equal(result[1].officeUserId, "actor-1");
});

test("parts action persists labor hours with goods through the authenticated role", async () => {
  const result = await runWorkorderModuleAction(context, "wo-1", "parts", "record", {
    operation: "usedParts",
    laborHours: "2.5",
    parts: [{ partNo: "46305", qty: "1", uomCode: "ea", repairOrder: "Replace seal" }],
  }, {
    authorize: async () => {},
    saveOfficeParts: async (...args) => args,
  });

  assert.equal(result[1].officeUserId, "actor-1");
  assert.equal(result[1].laborHours, "2.5");
  assert.equal(result[1].parts[0].partNo, "46305");
});

test("office Work done uses the shared completion transition with the authenticated office actor", async () => {
  const calls = [];
  const result = await runWorkorderModuleAction(context, "wo-1", "completion", "markWorkDone", {
    diagnosis: "Found an oil leak",
    workPerformed: "Replaced the oil filter",
  }, {
    authorize: async (...args) => calls.push(args),
    markOfficeDone: async (...args) => args,
    markDone: async () => assert.fail("office must not use the mechanic completion path"),
  });
  assert.equal(calls[0][2].action, "markWorkDone");
  assert.equal(result[1].officeUserId, "actor-1");
  assert.equal(result[1].workPerformed, "Replaced the oil filter");
});

test("canonical create derives actor identity and preserves mechanic start semantics", async () => {
  const mechanicContext = {
    actor: { id: "actor-1", role: "mechanic" },
    companyIds: new Set(["company-1"]),
    locationIds: new Set(["location-1"]),
  };
  let authorized;
  const result = await createWorkorderRuntime(mechanicContext, {
    companyId: "company-1", locationId: "location-1", concern: "Inspect", mechanicUserIds: [], formData: { workPerformed: "Inspect brakes" },
  }, {
    companyId: "company-1",
    locationId: "location-1",
    assetId: "asset-1",
    concern: "Inspect",
    officeNotes: "",
    formData: {
      customerCompanyName: "Long Haul",
      workStartDate: "2026-08-10",
      unitNo: "G2026",
      mechanicConcern: "Inspect",
      workPerformed: "Inspect brakes",
      parts: [],
    },
  }, {
    authorizeCreate: async (...args) => { authorized = args; },
    create: async (input) => input,
    loadLaborProduct: async () => ({ externalId: "91", code: "LAB", name: "Shop labor", uomCode: "hr" }),
  });
  assert.deepEqual(result.mechanicUserIds, ["actor-1"]);
  assert.equal(result.startImmediately, true);
  assert.equal(result.formData.laborProduct.code, "LAB");
  assert.equal(result.formData.workPerformed, "Inspect brakes");
  assert.deepEqual(authorized[1].moduleKeys, ["concern", "unit", "location", "schedule", "parts"]);
});

test("active-unit creation conflicts are returned as actionable HTTP errors", async () => {
  const conflict = Object.assign(new Error("Asset already has an active workorder."), {
    code: "23505",
    constraint: "operational_workorders_one_active_per_asset_uidx",
  });
  await assert.rejects(
    createWorkorderRuntime({
      actor: { id: "actor-1", role: "office" },
      companyIds: new Set(["company-1"]),
      locationIds: new Set(["location-1"]),
    }, {
      companyId: "company-1",
      locationId: "location-1",
      concern: "Inspect",
      mechanicUserIds: [],
      formData: {},
    }, {
      companyId: "company-1",
      locationId: "location-1",
      concern: "Inspect",
      formData: {},
    }, {
      authorizeCreate: async () => {},
      loadLaborProduct: async () => null,
      create: async () => { throw conflict; },
    }),
    (error) => error.statusCode === 409
      && error.code === "ASSET_ACTIVE_WORKORDER_EXISTS"
      && /already has an active workorder/i.test(error.message),
  );
});

test("create context exposes the company-selected labor product to every location", async () => {
  const result = await workorderCreateContext({
    actor: { id: "admin-1", role: "admin" },
    companyIds: new Set(["company-1"]),
    locationIds: new Set(),
  }, {
    loadTemplates: async () => [{
      company_id: "company-1",
      location_id: "location-1",
      location_name: "Chino Yard",
      location_type: "yard",
      location_address: "",
    }],
    resolveModules: async () => ({ decisions: {
      concern: { access: "write" },
      assignment: { access: "hidden" },
    } }),
    loadLaborProduct: async () => ({ externalId: "91", code: "LAB200", name: "Shop labor", uomCode: "hr" }),
  });

  assert.deepEqual(result.locations[0].laborProduct, {
    externalId: "91",
    code: "LAB200",
    name: "Shop labor",
    uomCode: "hr",
  });
});
