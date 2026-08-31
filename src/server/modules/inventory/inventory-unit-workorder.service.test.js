import assert from "node:assert/strict";
import test from "node:test";
import {
  finalizeSerializedUnitForWorkorder,
  createSerializedUnitsForWorkorder,
  issueSerializedUnitForWorkorder,
  readAvailableSerializedUnitsForWorkorder,
  readSerializedUnitUsagesForWorkorder,
  resolveSerializedUnitForWorkorder,
  updateSerializedUsageRepairOrderForWorkorder,
} from "./inventory-unit-workorder.service.js";

const COMPANY_ID = "00000000-0000-4000-8000-000000000001";
const LOCATION_ID = "00000000-0000-4000-8000-000000000002";
const ACTOR_ID = "00000000-0000-4000-8000-000000000003";
const WORKORDER_ID = "00000000-0000-4000-8000-000000000004";
const ASSET_ID = "00000000-0000-4000-8000-000000000005";
const UNIT_ID = "00000000-0000-4000-8000-000000000006";
const USAGE_ID = "00000000-0000-4000-8000-000000000007";

function context(role = "office", locationIds = new Set([LOCATION_ID])) {
  return {
    actor: { id: ACTOR_ID, role },
    companyIds: new Set([COMPANY_ID]),
    locationIds,
  };
}

function workorder(patch = {}) {
  return {
    id: WORKORDER_ID,
    serial: "WO-100",
    companyId: COMPANY_ID,
    locationId: LOCATION_ID,
    assetId: ASSET_ID,
    asset: { id: ASSET_ID, unitNo: "T-10", name: "Truck 10" },
    status: "in_progress",
    ...patch,
  };
}

function unit(patch = {}) {
  return {
    id: UNIT_ID,
    serialNumber: "WG-L-TEST-1",
    status: "in_stock",
    catalogPartId: "00000000-0000-4000-8000-000000000008",
    partNumber: "FILTER-1",
    description: "Filter",
    uomCode: "ea",
    locationId: LOCATION_ID,
    locationName: "Main shop",
    provider: "local",
    ...patch,
  };
}

function dependencies(overrides = {}) {
  return {
    authorize: async (_context, id, request) => {
      assert.equal(id, WORKORDER_ID);
      assert.equal(request.moduleKey, "partsScanning");
      return { workorder: workorder(), companyId: COMPANY_ID, locationId: LOCATION_ID };
    },
    tokenFromCode: (value) => value,
    readToken: () => UNIT_ID,
    resolveUnit: async () => unit(),
    ...overrides,
  };
}

test("Office resolve re-derives exact workorder scope and returns one eligible application-owned unit", async () => {
  let received;
  const result = await resolveSerializedUnitForWorkorder(WORKORDER_ID, { code: "inventory-code" }, context(), dependencies({
    resolveUnit: async (input) => { received = input; return unit(); },
  }));
  assert.equal(result.eligibility.canIssue, true);
  assert.equal(result.workorder.asset.unitNo, "T-10");
  assert.deepEqual(received, {
    workorderId: WORKORDER_ID,
    unitId: UNIT_ID,
    actorId: ACTOR_ID,
    companyId: COMPANY_ID,
    locationId: LOCATION_ID,
    actorRole: "office",
  });
});

test("all application-owned receipt providers are eligible while Odoo remains blocked", async () => {
  for (const provider of ["local", "local_count", "local_serialization"]) {
    const result = await resolveSerializedUnitForWorkorder(WORKORDER_ID, { code: "inventory-code" }, context(), dependencies({
      resolveUnit: async () => unit({ provider }),
    }));
    assert.equal(result.eligibility.canIssue, true, provider);
  }
  const external = await resolveSerializedUnitForWorkorder(WORKORDER_ID, { code: "inventory-code" }, context(), dependencies({
    resolveUnit: async () => unit({ provider: "odoo" }),
  }));
  assert.equal(external.eligibility.code, "INVENTORY_UNIT_PROVIDER_NOT_LOCAL");
});

test("resolve reports local-policy, workorder, provider, and stale-unit blocks without mutating", async () => {
  const cases = [
    { workorder: workorder({ assetId: null, asset: null }), unit: unit(), code: "WORKORDER_ASSET_REQUIRED" },
    { workorder: workorder({ status: "mechanic_done" }), unit: unit(), code: "WORKORDER_INVENTORY_NOT_ACTIVE" },
    { workorder: workorder(), unit: unit({ provider: "odoo" }), code: "INVENTORY_UNIT_PROVIDER_NOT_LOCAL" },
    { workorder: workorder(), unit: unit({ status: "issued" }), code: "INVENTORY_UNIT_NOT_AVAILABLE" },
  ];
  for (const example of cases) {
    const result = await resolveSerializedUnitForWorkorder(WORKORDER_ID, { code: "inventory-code" }, context(), dependencies({
      authorize: async () => ({ workorder: example.workorder, companyId: COMPANY_ID, locationId: LOCATION_ID }),
      resolveUnit: async () => example.unit,
    }));
    assert.equal(result.eligibility.canIssue, false);
    assert.equal(result.eligibility.code, example.code);
  }
});

test("module denial, empty location scope, invalid identities, and cross-scope misses fail closed", async () => {
  await assert.rejects(
    resolveSerializedUnitForWorkorder(WORKORDER_ID, { code: "inventory-code" }, context("mechanic"), dependencies({
      authorize: async () => { throw Object.assign(new Error("Forbidden"), { statusCode: 403 }); },
    })),
    (error) => error.statusCode === 403,
  );
  await assert.rejects(
    resolveSerializedUnitForWorkorder(WORKORDER_ID, { code: "inventory-code" }, context("office", new Set()), dependencies()),
    (error) => error.statusCode === 403,
  );
  await assert.rejects(
    resolveSerializedUnitForWorkorder(WORKORDER_ID, { code: "inventory-code" }, context(), dependencies({ readToken: () => null })),
    (error) => error.statusCode === 404 && error.code === "inventory_not_found",
  );
  await assert.rejects(
    resolveSerializedUnitForWorkorder(WORKORDER_ID, { code: "inventory-code" }, context(), dependencies({ resolveUnit: async () => null })),
    (error) => error.statusCode === 404 && error.code === "inventory_not_found",
  );
});

test("issue passes only server-derived identity and returns exact idempotent replay", async () => {
  let command;
  const usage = { id: USAGE_ID, status: "issued" };
  const result = await issueSerializedUnitForWorkorder(
    WORKORDER_ID,
    { code: "inventory-code", idempotencyKey: "issue-key-123" },
    context(),
    dependencies({ issueUnit: async (input) => { command = input; return { kind: "replay", usage }; } }),
  );
  assert.equal(result.replayed, true);
  assert.equal(result.usage, usage);
  assert.equal(command.unitId, UNIT_ID);
  assert.equal(command.actorId, ACTOR_ID);
  assert.match(command.requestHash, /^[0-9a-f]{64}$/);
  assert.equal(command.companyId, COMPANY_ID);
  assert.equal(command.locationId, LOCATION_ID);
  assert.equal("companyIds" in command, false);
  assert.equal("locationIds" in command, false);
});

test("issue accepts an exact unit id without decoding a client code", async () => {
  let command;
  await issueSerializedUnitForWorkorder(
    WORKORDER_ID,
    { unitId: UNIT_ID, idempotencyKey: "issue-unit-id-key" },
    context(),
    dependencies({
      readToken: () => { throw new Error("must not decode"); },
      issueUnit: async (input) => { command = input; return { kind: "reserved", usage: { id: USAGE_ID } }; },
    }),
  );
  assert.equal(command.unitId, UNIT_ID);
});

test("available-child read returns safe bounded workorder-scoped metadata", async () => {
  let received;
  const repositoryResult = {
    kind: "found",
    part: { catalogPartId: unit().catalogPartId, partNumber: "FILTER-1", description: "Filter", uomCode: "ea" },
    location: { locationId: LOCATION_ID, name: "Main shop" },
    canCreateSerializedUnits: true,
    units: [{ id: UNIT_ID, serialNumber: "WG-S-1", eligible: true }],
    nextCursor: "WG-S-1",
  };
  const result = await readAvailableSerializedUnitsForWorkorder(WORKORDER_ID, {
    catalogPartId: unit().catalogPartId,
    q: " WG-S ",
    after: "WG-S-0",
    limit: "25",
  }, context(), dependencies({
    listAvailableUnits: async (input) => { received = input; return repositoryResult; },
  }));
  assert.deepEqual(result, {
    part: repositoryResult.part,
    location: repositoryResult.location,
    canCreateSerializedUnits: true,
    units: repositoryResult.units,
    nextCursor: "WG-S-1",
  });
  assert.deepEqual(received, {
    workorderId: WORKORDER_ID,
    catalogPartId: unit().catalogPartId,
    queryText: "WG-S",
    after: "WG-S-0",
    limit: 25,
    companyId: COMPANY_ID,
    locationId: LOCATION_ID,
    actorRole: "office",
  });
});

test("workorder intake passes its identity to the locked repository path and denies mechanics", async () => {
  let createInput;
  let createDependencies;
  const result = await createSerializedUnitsForWorkorder(WORKORDER_ID, {
    catalogPartId: unit().catalogPartId,
    quantity: 2,
    confirmation: "physically_present_at_location",
    idempotencyKey: "workorder-create-two",
  }, context(), dependencies({
    createUnits: async (_partId, locationId, input, _context, receivedDependencies) => {
      createInput = { locationId, ...input };
      createDependencies = receivedDependencies;
      return { batch: { itemCount: 2, printUrl: "/labels/1" }, units: [] };
    },
  }));
  assert.equal(result.batch.itemCount, 2);
  assert.equal(createInput.locationId, LOCATION_ID);
  assert.equal(createDependencies.workorderId, WORKORDER_ID);
  await assert.rejects(
    createSerializedUnitsForWorkorder(WORKORDER_ID, {
      catalogPartId: unit().catalogPartId,
      quantity: 1,
      confirmation: "physically_present_at_location",
      idempotencyKey: "mechanic-create-denied",
    }, context("mechanic"), dependencies()),
    (error) => error.code === "INVENTORY_CREATE_FORBIDDEN" && error.statusCode === 403,
  );
});

test("workorder intake rejects stale lifecycle before calling creation", async () => {
  let wrote = false;
  await assert.rejects(
    createSerializedUnitsForWorkorder(WORKORDER_ID, {
      catalogPartId: unit().catalogPartId,
      quantity: 1,
      confirmation: "physically_present_at_location",
      idempotencyKey: "closed-create-denied",
    }, context(), dependencies({
      authorize: async () => ({ workorder: workorder({ status: "mechanic_done" }), companyId: COMPANY_ID, locationId: LOCATION_ID }),
      createUnits: async () => { wrote = true; },
    })),
    (error) => error.code === "WORKORDER_INVENTORY_NOT_ACTIVE",
  );
  assert.equal(wrote, false);
});

test("issue maps stale, Odoo, disabled-policy, balance, and changed-hash outcomes", async () => {
  const expected = {
    idempotency_conflict: "INVENTORY_UNIT_REPLAY_CONFLICT",
    workorder_state: "WORKORDER_INVENTORY_NOT_ACTIVE",
    asset_required: "WORKORDER_ASSET_REQUIRED",
    provider_not_local: "INVENTORY_UNIT_PROVIDER_NOT_LOCAL",
    unit_state: "INVENTORY_UNIT_NOT_AVAILABLE",
    stock_mismatch: "INVENTORY_SERIAL_BALANCE_MISMATCH",
    missing: "inventory_not_found",
  };
  for (const [kind, code] of Object.entries(expected)) {
    await assert.rejects(
      issueSerializedUnitForWorkorder(
        WORKORDER_ID,
        { code: "inventory-code", idempotencyKey: "issue-key-123" },
        context(),
        dependencies({ issueUnit: async () => ({ kind, usage: null }) }),
      ),
      (error) => error.code === code,
    );
  }
});

test("finalization freezes usage, disposition, tenant scope, and request hash", async () => {
  let installed;
  const usage = { id: USAGE_ID, status: "installed" };
  const result = await finalizeSerializedUnitForWorkorder(
    WORKORDER_ID,
    USAGE_ID,
    { disposition: "installed", idempotencyKey: "finish-key-123" },
    context(),
    dependencies({ finalizeUnit: async (input) => { installed = input; return { kind: "finalized", usage }; } }),
  );
  assert.equal(result.replayed, false);
  assert.equal(installed.disposition, "installed");
  assert.equal(installed.usageId, USAGE_ID);
  assert.equal(installed.companyId, COMPANY_ID);
  assert.equal(installed.locationId, LOCATION_ID);
  assert.equal(installed.actorRole, "office");
  assert.match(installed.requestHash, /^[0-9a-f]{64}$/);
});

test("stable refresh projection is bounded and scoped to the authorized actor", async () => {
  let request;
  const usages = [{ id: USAGE_ID, status: "returned" }];
  const result = await readSerializedUnitUsagesForWorkorder(WORKORDER_ID, context(), dependencies({
    listUsages: async (input) => { request = input; return usages; },
  }));
  assert.equal(result.usages, usages);
  assert.equal(request.actorId, ACTOR_ID);
  assert.equal(request.actorRole, "office");
  assert.equal(request.companyId, COMPANY_ID);
  assert.equal(request.locationId, LOCATION_ID);
  assert.equal(request.limit, 100);
});

test("a granted Mechanic carries a server-derived role for assignment revalidation", async () => {
  let command;
  await issueSerializedUnitForWorkorder(
    WORKORDER_ID,
    { code: "inventory-code", idempotencyKey: "mechanic-issue-key" },
    context("mechanic"),
    dependencies({ issueUnit: async (input) => { command = input; return { kind: "issued", usage: { id: USAGE_ID } }; } }),
  );
  assert.equal(command.actorRole, "mechanic");
  assert.equal(command.companyId, COMPANY_ID);
  assert.equal(command.locationId, LOCATION_ID);
});

test("serialized repair wording is scoped to the authorized installed usage and validates before mutation", async () => {
  let command;
  const usage = { id: USAGE_ID, status: "installed_pending_approval", repairOrder: "Replace filter" };
  const result = await updateSerializedUsageRepairOrderForWorkorder(
    WORKORDER_ID,
    { operation: "serializedUsageRepairOrder", usageId: USAGE_ID, repairOrder: "Install and inspect for leaks" },
    context(),
    dependencies({
      authorizeParts: async () => ({ workorder: workorder(), companyId: COMPANY_ID, locationId: LOCATION_ID }),
      updateRepairOrder: async (input) => { command = input; return { kind: "updated", usage }; },
    }),
  );
  assert.equal(result.usage, usage);
  assert.deepEqual(command, {
    workorderId: WORKORDER_ID,
    usageId: USAGE_ID,
    repairOrder: "Install and inspect for leaks",
    actorId: ACTOR_ID,
    allowedWorkorderStatuses: ["open", "accepted", "in_progress", "mechanic_done"],
    companyId: COMPANY_ID,
    locationId: LOCATION_ID,
    actorRole: "office",
  });
  await updateSerializedUsageRepairOrderForWorkorder(
    WORKORDER_ID,
    { operation: "serializedUsageRepairOrder", usageId: USAGE_ID, repairOrder: " " },
    context(),
    dependencies({
      authorizeParts: async () => ({ workorder: workorder(), companyId: COMPANY_ID, locationId: LOCATION_ID }),
      updateRepairOrder: async (input) => { command = input; return { kind: "updated", usage }; },
    }),
  );
  assert.equal(command.repairOrder, "");
  await assert.rejects(updateSerializedUsageRepairOrderForWorkorder(
    WORKORDER_ID,
    { operation: "serializedUsageRepairOrder", usageId: USAGE_ID, repairOrder: "x".repeat(2001) },
    context(),
    dependencies(),
  ));
});

test("mechanic serialized repair wording preserves the mechanic parts policy and active lifecycle", async () => {
  let command;
  await updateSerializedUsageRepairOrderForWorkorder(
    WORKORDER_ID,
    { operation: "serializedUsageRepairOrder", usageId: USAGE_ID, repairOrder: "Install filter" },
    context("mechanic"),
    dependencies({
      authorizeParts: async () => ({ workorder: workorder(), companyId: COMPANY_ID, locationId: LOCATION_ID }),
      getMechanicPartsPolicy: async () => ({ mechanicCanRecordParts: true }),
      updateRepairOrder: async (input) => { command = input; return { kind: "unchanged", usage: { id: USAGE_ID } }; },
    }),
  );
  assert.deepEqual(command.allowedWorkorderStatuses, ["accepted", "in_progress"]);
  await assert.rejects(
    updateSerializedUsageRepairOrderForWorkorder(
      WORKORDER_ID,
      { operation: "serializedUsageRepairOrder", usageId: USAGE_ID, repairOrder: "Install filter" },
      context("mechanic"),
      dependencies({
        authorizeParts: async () => ({ workorder: workorder(), companyId: COMPANY_ID, locationId: LOCATION_ID }),
        getMechanicPartsPolicy: async () => ({ mechanicCanRecordParts: false }),
      }),
    ),
    (error) => error.code === "MECHANIC_PARTS_ENTRY_DISABLED",
  );
});
