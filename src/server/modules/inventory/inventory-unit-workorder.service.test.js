import assert from "node:assert/strict";
import test from "node:test";
import {
  finalizeSerializedUnitForWorkorder,
  issueSerializedUnitForWorkorder,
  readSerializedUnitUsagesForWorkorder,
  resolveSerializedUnitForWorkorder,
} from "./inventory-unit-workorder.service.js";

const COMPANY_ID = "00000000-0000-4000-8000-000000000001";
const LOCATION_ID = "00000000-0000-4000-8000-000000000002";
const ACTOR_ID = "00000000-0000-4000-8000-000000000003";
const WORKORDER_ID = "00000000-0000-4000-8000-000000000004";
const ASSET_ID = "00000000-0000-4000-8000-000000000005";
const UNIT_ID = "00000000-0000-4000-8000-000000000006";
const USAGE_ID = "00000000-0000-4000-8000-000000000007";

function context(role = "mechanic") {
  return {
    actor: { id: ACTOR_ID, role },
    companyIds: new Set([COMPANY_ID]),
    locationIds: new Set([LOCATION_ID]),
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
      assert.deepEqual(request, { moduleKey: "parts", capability: "write", action: "record" });
      return { workorder: workorder() };
    },
    tokenFromCode: (value) => value,
    readToken: () => UNIT_ID,
    resolveUnit: async () => unit(),
    loadPartsPolicy: async () => ({ mechanicCanRecordParts: true }),
    ...overrides,
  };
}

test("contextual resolve re-derives workorder scope and returns one eligible local unit", async () => {
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
    companyIds: [COMPANY_ID],
    locationIds: [LOCATION_ID],
  });
});

test("resolve reports local-policy, workorder, provider, and stale-unit blocks without mutating", async () => {
  const cases = [
    { workorder: workorder({ assetId: null, asset: null }), unit: unit(), policy: true, code: "WORKORDER_ASSET_REQUIRED" },
    { workorder: workorder({ status: "mechanic_done" }), unit: unit(), policy: true, code: "WORKORDER_INVENTORY_NOT_ACTIVE" },
    { workorder: workorder(), unit: unit(), policy: false, code: "MECHANIC_PARTS_ENTRY_DISABLED" },
    { workorder: workorder(), unit: unit({ provider: "odoo" }), policy: true, code: "INVENTORY_UNIT_PROVIDER_NOT_LOCAL" },
    { workorder: workorder(), unit: unit({ status: "issued" }), policy: true, code: "INVENTORY_UNIT_NOT_AVAILABLE" },
  ];
  for (const example of cases) {
    const result = await resolveSerializedUnitForWorkorder(WORKORDER_ID, { code: "inventory-code" }, context(), dependencies({
      authorize: async () => ({ workorder: example.workorder }),
      resolveUnit: async () => example.unit,
      loadPartsPolicy: async () => ({ mechanicCanRecordParts: example.policy }),
    }));
    assert.equal(result.eligibility.canIssue, false);
    assert.equal(result.eligibility.code, example.code);
  }
});

test("non-mechanics, invalid identities, and cross-scope misses fail closed", async () => {
  await assert.rejects(
    resolveSerializedUnitForWorkorder(WORKORDER_ID, { code: "inventory-code" }, context("office"), dependencies()),
    (error) => error.statusCode === 403 && error.code === "INVENTORY_UNIT_MECHANIC_REQUIRED",
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
  assert.equal("companyId" in command, false);
});

test("issue maps stale, Odoo, disabled-policy, balance, and changed-hash outcomes", async () => {
  const expected = {
    idempotency_conflict: "INVENTORY_UNIT_REPLAY_CONFLICT",
    workorder_state: "WORKORDER_INVENTORY_NOT_ACTIVE",
    asset_required: "WORKORDER_ASSET_REQUIRED",
    parts_disabled: "MECHANIC_PARTS_ENTRY_DISABLED",
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
  assert.deepEqual(installed.companyIds, [COMPANY_ID]);
  assert.match(installed.requestHash, /^[0-9a-f]{64}$/);
});

test("stable refresh projection is bounded and scoped to the assigned mechanic", async () => {
  let request;
  const usages = [{ id: USAGE_ID, status: "returned" }];
  const result = await readSerializedUnitUsagesForWorkorder(WORKORDER_ID, context(), dependencies({
    listUsages: async (input) => { request = input; return usages; },
  }));
  assert.equal(result.usages, usages);
  assert.equal(request.actorId, ACTOR_ID);
  assert.equal(request.limit, 100);
});
