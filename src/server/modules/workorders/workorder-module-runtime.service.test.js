import assert from "node:assert/strict";
import test from "node:test";
import {
  createWorkorderRuntime,
  patchWorkorderModule,
  patchWorkorderModules,
  protectedWorkorderDetail,
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

test("generic mechanic and kiosk detail reads apply the restricted parts projection", async () => {
  for (const role of ["mechanic", "kiosk"]) {
    const result = await protectedWorkorderDetail({
      actor: { id: `${role}-1`, role },
    }, "wo-1", {
      resolveModules: async () => ({ decisions: { parts: { access: "write", source: "default" } } }),
      loadDetail: async () => ({
        workorder: { id: "wo-1", companyId: "company-1", locationId: "location-1", formData: {} },
        partRequests: [{
          id: "request-1",
          partNumber: "LF9009",
          rawContext: { private: true },
          allocations: [{ vendor: "Private Vendor", sourceType: "purchase" }],
          inventory: [
            { locationId: "location-1", quantityAvailable: 2, quantityOnHand: 4, quantityReserved: 2 },
            { locationId: "location-2", locationName: "Remote Yard", quantityAvailable: 10 },
          ],
        }],
      }),
      listInstalledParts: async () => [{ catalogPartId: "catalog-1", partNumber: "LF9009", quantity: 1, uomCode: "ea" }],
      listAggregateUsages: async () => [{ evidenceId: "evidence-1", partNumber: "Coolant", effectiveQuantity: 1.25, uomCode: "gal", status: "reserved" }],
    });

    assert.equal(result.partRequests[0].partNumber, "LF9009");
    assert.deepEqual(result.partRequests[0].inventory, [{ locationId: "location-1", quantityAvailable: 2 }]);
    assert.deepEqual(result.partRequests[0].allocations, []);
    assert.equal("rawContext" in result.partRequests[0], false);
    assert.equal(result.modules.parts.data.installedSerializedParts[0].partNumber, "LF9009");
    assert.equal(result.modules.parts.data.aggregatePartUsages[0].evidenceId, "evidence-1");
  }
});

test("generic mechanic and kiosk Parts module reads cannot bypass response redaction", async () => {
  for (const role of ["mechanic", "kiosk"]) {
    const result = await protectedWorkorderModule({
      actor: { id: `${role}-1`, role },
    }, "wo-1", "parts", {
      authorize: async () => ({ access: "write", source: "default" }),
      loadDetail: async () => ({
        workorder: { id: "wo-1", companyId: "company-1", locationId: "location-1", formData: {} },
        partRequests: [{
          id: "request-1",
          partNumber: "LF9009",
          sourceAttachmentId: "attachment-1",
          allocations: [{ quoteUrl: "https://vendor.example/quote" }],
          inventory: [{ locationId: "location-2", locationName: "Remote Yard", quantityAvailable: 10 }],
        }],
      }),
      listInstalledParts: async () => [{ catalogPartId: "catalog-1", partNumber: "LF9009", quantity: 1, uomCode: "ea" }],
      listAggregateUsages: async () => [],
    });

    assert.equal(result.partRequests[0].partNumber, "LF9009");
    assert.deepEqual(result.partRequests[0].inventory, []);
    assert.deepEqual(result.partRequests[0].allocations, []);
    assert.equal("sourceAttachmentId" in result.partRequests[0], false);
    assert.equal(result.modules.parts.data.installedSerializedParts[0].quantity, 1);
  }
});

test("hidden Parts access does not query or expose installed serialized summaries", async () => {
  let queried = false;
  const result = await protectedWorkorderDetail(context, "wo-1", {
    resolveModules: async () => ({ decisions: {
      parts: { access: "hidden", source: "user" },
      preview: { access: "read", source: "default" },
    } }),
    loadDetail: async () => ({
      workorder: { id: "wo-1", companyId: "company-1", locationId: "location-1", formData: {} },
    }),
    listInstalledParts: async () => { queried = true; return []; },
    listAggregateUsages: async () => { queried = true; return []; },
  });
  assert.equal(queried, false);
  assert.equal("parts" in result.modules, false);
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

test("compatibility patch canonicalizes a changed labor product using server-owned workorder scope", async () => {
  const oldProductId = "11111111-1111-4111-8111-111111111111";
  const newProductId = "22222222-2222-4222-8222-222222222222";
  const current = {
    id: "wo-1",
    companyId: "company-server",
    locationId: "location-server",
    formData: { laborProduct: { productId: oldProductId, externalId: "", code: "OLD", name: "Old labor", uomCode: "hr" } },
  };
  const authorizations = [];
  let resolvedScope;
  const result = await patchWorkorderModules(context, "wo-1", ["unit", "diagnosisRepair"], {
    formData: {
      unitNo: "17",
      laborProduct: { productId: newProductId, externalId: "forged", code: "BAD", name: "Forged", uomCode: "hr" },
    },
  }, {
    loadWorkorder: async () => current,
    authorizeMany: async (_context, _workorderId, requests) => {
      authorizations.push(...requests);
      return { workorder: current };
    },
    resolveLaborProduct: async (scope) => {
      resolvedScope = scope;
      return { productId: newProductId, externalId: "", code: "DIAG", name: "Diagnostics", uomCode: "hr" };
    },
    updateOffice: async (...args) => args,
  });

  assert.deepEqual(authorizations.map(({ moduleKey }) => moduleKey), ["unit", "diagnosisRepair"]);
  assert.deepEqual(resolvedScope, {
    productId: newProductId,
    companyId: "company-server",
    locationId: "location-server",
  });
  assert.deepEqual(result[1].formData.laborProduct, {
    productId: newProductId, externalId: "", code: "DIAG", name: "Diagnostics", uomCode: "hr",
  });
});

test("compatibility autosave preserves an unchanged legacy labor snapshot without requiring Diagnosis access", async () => {
  const legacyLabor = { externalId: "91", code: "LAB", name: "Legacy labor", uomCode: "hr" };
  const current = {
    id: "wo-1",
    companyId: "company-server",
    locationId: "location-server",
    formData: { laborProduct: legacyLabor },
  };
  const authorizations = [];
  const result = await patchWorkorderModules(context, "wo-1", ["unit", "diagnosisRepair"], {
    formData: { unitNo: "17", laborProduct: { ...legacyLabor } },
  }, {
    loadWorkorder: async () => current,
    authorizeMany: async (_context, _workorderId, requests) => {
      authorizations.push(...requests);
      return { workorder: current };
    },
    resolveLaborProduct: async () => assert.fail("unchanged legacy snapshots must not be re-resolved"),
    updateOffice: async (...args) => args,
  });

  assert.deepEqual(authorizations.map(({ moduleKey }) => moduleKey), ["unit"]);
  assert.deepEqual(result[1].formData.laborProduct, legacyLabor);
});

test("labor-only compatibility autosave is a no-op when the saved snapshot is unchanged", async () => {
  const laborProduct = { externalId: "91", code: "LAB", name: "Legacy labor", uomCode: "hr" };
  const current = { id: "wo-1", companyId: "company-1", locationId: "location-1", formData: { laborProduct } };
  const result = await patchWorkorderModules(context, "wo-1", ["diagnosisRepair"], {
    formData: { laborProduct: { ...laborProduct } },
  }, {
    loadWorkorder: async () => current,
    authorizeMany: async () => assert.fail("an unchanged snapshot must not require write authorization"),
    updateOffice: async () => assert.fail("an unchanged labor-only snapshot must not be persisted"),
  });
  assert.equal(result, current);
});

test("explicit null remains a no-op when a legacy workorder has no saved labor product", async () => {
  const current = { id: "wo-1", companyId: "company-1", locationId: "location-1", formData: {} };
  const result = await patchWorkorderModules(context, "wo-1", ["diagnosisRepair"], {
    formData: { laborProduct: null },
  }, {
    loadWorkorder: async () => current,
    authorizeMany: async () => assert.fail("absent-to-null must not require write authorization"),
    updateOffice: async () => assert.fail("absent-to-null must not persist"),
  });
  assert.equal(result, current);
});

test("compatibility patch allows an authorized office user to clear the saved labor product", async () => {
  const current = {
    id: "wo-1", companyId: "company-1", locationId: "location-1",
    formData: { laborProduct: { externalId: "91", code: "LAB", name: "Legacy labor", uomCode: "hr" } },
  };
  const result = await patchWorkorderModules(context, "wo-1", ["diagnosisRepair"], {
    formData: { laborProduct: null },
  }, {
    loadWorkorder: async () => current,
    authorizeMany: async () => ({ workorder: current }),
    resolveLaborProduct: async () => assert.fail("clearing labor must not resolve a product"),
    updateOffice: async (...args) => args,
  });
  assert.equal(result[1].formData.laborProduct, null);
});

test("generic Diagnosis patch rejects mechanic labor-product mutation after module authorization", async () => {
  const current = { companyId: "company-1", locationId: "location-1", formData: {} };
  await assert.rejects(patchWorkorderModule(
    { actor: { id: "mechanic-1", role: "mechanic" } },
    "wo-1",
    "diagnosisRepair",
    {
      diagnosis: "",
      workPerformed: "",
      expectedVersion: 1,
      formData: {
        laborProduct: {
          productId: "33333333-3333-4333-8333-333333333333",
          externalId: "",
          code: "LAB",
          name: "Labor",
          uomCode: "hr",
        },
      },
    },
    {
      authorize: async () => ({ workorder: current }),
      resolveLaborProduct: async () => assert.fail("mechanics cannot select office-owned labor products"),
      updateMechanic: async () => assert.fail("denied mutations must not persist"),
    },
  ), (error) => error.statusCode === 403);
});

test("changed labor selection propagates trusted resolver rejection and never persists", async () => {
  const productId = "44444444-4444-4444-8444-444444444444";
  const current = { companyId: "company-server", locationId: "location-server", formData: {} };
  let scope;
  await assert.rejects(patchWorkorderModules(context, "wo-1", ["diagnosisRepair"], {
    formData: { laborProduct: { productId, externalId: "", code: "BAD", name: "Cross tenant", uomCode: "hr" } },
  }, {
    loadWorkorder: async () => current,
    authorizeMany: async () => ({ workorder: current }),
    resolveLaborProduct: async (value) => {
      scope = value;
      const error = new Error("Labor product not found");
      error.statusCode = 404;
      throw error;
    },
    updateOffice: async () => assert.fail("rejected selections must not persist"),
  }), (error) => error.statusCode === 404);
  assert.deepEqual(scope, { productId, companyId: "company-server", locationId: "location-server" });
});

test("changed non-local labor snapshots are rejected instead of trusting client fields", async () => {
  const current = { companyId: "company-server", locationId: "location-server", formData: {} };
  await assert.rejects(patchWorkorderModules(context, "wo-1", ["diagnosisRepair"], {
    formData: { laborProduct: { externalId: "91", code: "FORGED", name: "Forged", uomCode: "hr" } },
  }, {
    loadWorkorder: async () => current,
    authorizeMany: async () => ({ workorder: current }),
    resolveLaborProduct: async () => assert.fail("invalid snapshots must fail before lookup"),
    updateOffice: async () => assert.fail("invalid snapshots must not persist"),
  }), (error) => error.statusCode === 400);
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

test("mechanic part requests use Parts read access without granting actual-part writes", async () => {
  const authorizations = [];
  const result = await runWorkorderModuleAction(
    { actor: { id: "mechanic-1", role: "mechanic" } },
    "wo-1",
    "parts",
    "request",
    { description: "Oil filter", quantity: 1, uomCode: "ea" },
    {
      authorize: async (_context, _workorderId, request) => { authorizations.push(request); },
      requestPart: async (...args) => args,
    },
  );
  assert.equal(result[1].mechanicUserId, "mechanic-1");
  assert.equal(authorizations[0].capability, "read");
  assert.equal(authorizations[0].action, "request");

  await assert.rejects(
    runWorkorderModuleAction(context, "wo-1", "parts", "request", {}, {
      authorize: async () => assert.fail("non-mechanics must be denied before authorization"),
      requestPart: async () => assert.fail("non-mechanics must not create mechanic requests"),
    }),
    (error) => error.statusCode === 403,
  );
});

test("parts action persists labor hours with goods through the authenticated role", async () => {
  const authorizations = [];
  const result = await runWorkorderModuleAction(context, "wo-1", "parts", "record", {
    operation: "usedParts",
    laborHours: "2.5",
    parts: [{ partNo: "46305", qty: "1", uomCode: "ea", repairOrder: "Replace seal" }],
  }, {
    authorize: async (...args) => authorizations.push(args[2]),
    saveOfficeParts: async (...args) => args,
  });

  assert.equal(result[1].officeUserId, "actor-1");
  assert.equal(result[1].laborHours, "2.5");
  assert.equal(result[1].parts[0].partNo, "46305");
  assert.deepEqual(authorizations.map(({ moduleKey, action }) => [moduleKey, action]), [
    ["parts", "record"],
    ["diagnosisRepair", "update"],
  ]);
});

test("legacy manual amendments are Office-owned and carry server-derived scope", async () => {
  let command;
  const input = {
    operation: "legacyManualPartAmendment",
    evidenceId: "00000000-0000-4000-8000-000000000011",
    action: "voided",
    reason: "Duplicate historical row",
    idempotencyKey: "manual-evidence-void-1",
  };
  const result = await runWorkorderModuleAction(context, "wo-1", "parts", "record", input, {
    authorize: async () => ({ companyId: "company-1", locationId: "location-1" }),
    amendManualPartEvidence: async (...args) => { command = args; return { amended: true }; },
  });
  assert.deepEqual(result, { amended: true });
  assert.equal(command[0], "wo-1");
  assert.equal(command[1].officeUserId, "actor-1");
  assert.equal(command[1].companyId, "company-1");
  assert.equal(command[1].locationId, "location-1");

  await assert.rejects(runWorkorderModuleAction(
    { actor: { id: "mechanic-1", role: "mechanic" } },
    "wo-1",
    "parts",
    "record",
    input,
    {
      authorize: async () => ({ companyId: "company-1", locationId: "location-1" }),
      amendManualPartEvidence: async () => assert.fail("mechanic reached amendment owner"),
    },
  ), (error) => error.statusCode === 403);
});

test("Parts write alone cannot mutate labor through the combined compatibility action", async () => {
  let saved = false;
  await assert.rejects(runWorkorderModuleAction(context, "wo-1", "parts", "record", {
    operation: "usedParts",
    laborHours: "3",
    parts: [],
  }, {
    authorize: async (_context, _workorderId, request) => {
      if (request.moduleKey === "diagnosisRepair") throw Object.assign(new Error("Forbidden"), { statusCode: 403 });
    },
    saveOfficeParts: async () => { saved = true; },
  }), (error) => error.statusCode === 403);
  assert.equal(saved, false);
});

test("office part planning uses the authenticated Office actor without recording a used part", async () => {
  const calls = [];
  const result = await runWorkorderModuleAction(context, "wo-1", "parts", "record", {
    operation: "officePartPlan",
    query: "Oil filter",
    partNumber: "LF9009",
    quantity: 1,
    uomCode: "ea",
    allocations: [],
  }, {
    authorize: async (...args) => calls.push(["authorize", ...args]),
    planOfficePart: async (...args) => { calls.push(["plan", ...args]); return { planned: true }; },
    addOfficePart: async () => assert.fail("planning must not use the legacy used-part operation"),
  });

  assert.deepEqual(result, { planned: true });
  assert.equal(calls[0][3].moduleKey, "parts");
  assert.equal(calls[0][3].action, "record");
  assert.equal(calls[1][0], "plan");
  assert.equal(calls[1][2].officeUserId, "actor-1");
});

test("mechanics cannot plan office parts even when the Parts record guard is reached", async () => {
  await assert.rejects(
    runWorkorderModuleAction({ actor: { id: "mechanic-1", role: "mechanic" } }, "wo-1", "parts", "record", {
      operation: "officePartPlan",
      query: "Oil filter",
      partNumber: "LF9009",
      quantity: 1,
      uomCode: "ea",
      allocations: [],
    }, {
      authorize: async () => {},
      planOfficePart: async () => assert.fail("mechanics must not reach the planning service"),
    }),
    /permission denied/i,
  );
});

test("parts record routes serialized repair wording through the scoped inventory owner", async () => {
  const usage = { id: "usage-1", repairOrder: "Install and test" };
  const result = await runWorkorderModuleAction(context, "wo-1", "parts", "record", {
    operation: "serializedUsageRepairOrder",
    usageId: "usage-1",
    repairOrder: "Install and test",
  }, {
    authorize: async () => ({ companyId: "company-1", locationId: "location-1" }),
    updateSerializedRepairOrderForWorkorder: async (...args) => {
      assert.equal(args[0], "wo-1");
      assert.equal(args[1].usageId, "usage-1");
      assert.deepEqual(Object.keys(args[1]).sort(), ["operation", "repairOrder", "usageId"]);
      assert.equal(args[2].actor.id, "actor-1");
      assert.equal(args[3].authorization.companyId, "company-1");
      return { usage };
    },
  });
  assert.equal(result.usage, usage);
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

test("create persists only the trusted local labor snapshot", async () => {
  const localId = "44444444-4444-4444-8444-444444444444";
  let resolved;
  const result = await createWorkorderRuntime({
    actor: { id: "actor-1", role: "office" },
    companyIds: new Set(["company-1"]),
    locationIds: new Set(["location-1"]),
  }, {
    companyId: "company-1",
    locationId: "location-1",
    concern: "Inspect",
    mechanicUserIds: [],
    formData: { laborProduct: { productId: localId, externalId: "", name: "Untrusted", code: "BAD", uomCode: "hr" } },
  }, {
    companyId: "company-1", locationId: "location-1", concern: "Inspect", formData: { laborProduct: { productId: localId } },
  }, {
    authorizeCreate: async () => {},
    loadLaborProduct: async () => assert.fail("local selection must not use the configured fallback"),
    resolveLaborProduct: async (scope) => {
      resolved = scope;
      return { productId: localId, externalId: "", name: "Diagnostics", code: "DIAG", uomCode: "hr" };
    },
    create: async (input) => input,
  });
  assert.deepEqual(resolved, { productId: localId, companyId: "company-1", locationId: "location-1" });
  assert.deepEqual(result.formData.laborProduct, {
    productId: localId, externalId: "", name: "Diagnostics", code: "DIAG", uomCode: "hr",
  });
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
