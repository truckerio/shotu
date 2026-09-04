import assert from "node:assert/strict";
import test from "node:test";
import { handleInventoryUnitWorkorderApi } from "./inventory-unit-workorder.routes.js";

const WORKORDER_ID = "00000000-0000-4000-8000-000000000001";
const USAGE_ID = "00000000-0000-4000-8000-000000000002";
const UNIT_ID = "00000000-0000-4000-8000-000000000003";

function helpers(body = null, role = "office") {
  return {
    requestContext: {
      actor: { id: "00000000-0000-4000-8000-000000000004", role },
      companyIds: new Set(["00000000-0000-4000-8000-000000000005"]),
      locationIds: new Set(["00000000-0000-4000-8000-000000000006"]),
    },
    readBody: async () => body,
    sendJson: (res, status, payload) => Object.assign(res, { status, payload }),
  };
}

function dependencies(overrides = {}) {
  return {
    authorize: async () => ({
      companyId: "00000000-0000-4000-8000-000000000005",
      locationId: "00000000-0000-4000-8000-000000000006",
      workorder: {
        id: WORKORDER_ID,
        serial: "WO-1",
        assetId: "00000000-0000-4000-8000-000000000007",
        asset: { id: "00000000-0000-4000-8000-000000000007", unitNo: "T-1" },
        locationId: "00000000-0000-4000-8000-000000000006",
        status: "in_progress",
      },
    }),
    tokenFromCode: (value) => value,
    readToken: () => UNIT_ID,
    resolveUnit: async () => ({
      id: UNIT_ID, provider: "local", status: "in_stock", partNumber: "P-1",
      locationName: "Shop", serialNumber: "SERIAL-1",
    }),
    ...overrides,
  };
}

test("standalone handler ignores unrelated paths", async () => {
  assert.equal(await handleInventoryUnitWorkorderApi(
    { method: "GET" }, {}, new URL("http://localhost/api/other"), helpers(), dependencies(),
  ), false);
});

test("resolve, issue, list, and finalize routes cross the service boundary", async () => {
  const resolveResponse = {};
  await handleInventoryUnitWorkorderApi(
    { method: "POST" }, resolveResponse,
    new URL(`http://localhost/api/workorders/${WORKORDER_ID}/inventory-units/resolve`),
    helpers({ code: "inventory-code" }), dependencies(),
  );
  assert.equal(resolveResponse.status, 200);
  assert.equal(resolveResponse.payload.eligibility.canIssue, true);

  const usage = { id: USAGE_ID, status: "issued" };
  const issueResponse = {};
  await handleInventoryUnitWorkorderApi(
    { method: "POST" }, issueResponse,
    new URL(`http://localhost/api/workorders/${WORKORDER_ID}/inventory-units/issue`),
    helpers({ code: "inventory-code", idempotencyKey: "issue-key-123" }),
    dependencies({ issueUnit: async () => ({ kind: "issued", usage }) }),
  );
  assert.equal(issueResponse.status, 201);
  assert.equal(issueResponse.payload.usage.id, USAGE_ID);

  const listResponse = {};
  await handleInventoryUnitWorkorderApi(
    { method: "GET" }, listResponse,
    new URL(`http://localhost/api/workorders/${WORKORDER_ID}/inventory-unit-usages`),
    helpers(), dependencies({ listUsages: async () => [usage] }),
  );
  assert.equal(listResponse.status, 200);
  assert.equal(listResponse.payload.usages.length, 1);

  const finalResponse = {};
  await handleInventoryUnitWorkorderApi(
    { method: "POST" }, finalResponse,
    new URL(`http://localhost/api/workorders/${WORKORDER_ID}/inventory-unit-usages/${USAGE_ID}/finalize`),
    helpers({ disposition: "installed", idempotencyKey: "finish-key-123" }),
    dependencies({ finalizeUnit: async () => ({ kind: "finalized", usage: { ...usage, status: "installed" } }) }),
  );
  assert.equal(finalResponse.status, 200);
  assert.equal(finalResponse.payload.usage.status, "installed");
});

test("workorder part-unit routes list safe children and create a printable batch", async () => {
  const catalogPartId = "00000000-0000-4000-8000-000000000008";
  let listed;
  const listResponse = {};
  await handleInventoryUnitWorkorderApi(
    { method: "GET" }, listResponse,
    new URL(`http://localhost/api/workorders/${WORKORDER_ID}/inventory-parts/${catalogPartId}/units?q=SERIAL&cursor=SERIAL-0`),
    helpers(), dependencies({
      listAvailableUnits: async (input) => {
        listed = input;
        return {
          kind: "found",
          part: { catalogPartId, partNumber: "P-1", description: "Part", uomCode: "ea" },
          location: { locationId: helpers().requestContext.locationIds.values().next().value, name: "Shop" },
          canCreateSerializedUnits: true,
          units: [{ id: UNIT_ID, serialNumber: "SERIAL-1", status: "in_stock", eligible: true }],
          nextCursor: null,
        };
      },
    }),
  );
  assert.equal(listResponse.status, 200);
  assert.equal(listResponse.payload.units[0].serialNumber, "SERIAL-1");
  assert.equal(listed.queryText, "SERIAL");
  assert.equal(listed.limit, 25);
  assert.equal(listed.after, "SERIAL-0");

  const createResponse = {};
  await handleInventoryUnitWorkorderApi(
    { method: "POST" }, createResponse,
    new URL(`http://localhost/api/workorders/${WORKORDER_ID}/inventory-parts/${catalogPartId}/units`),
    helpers({ quantity: 2, confirmation: "physically_present_at_location", idempotencyKey: "create-parts-key" }),
    dependencies({
      createUnits: async (_partId, _locationId, _input, _context, receivedDependencies) => ({
        batch: { id: "batch-1", itemCount: 2, printUrl: "/labels/batch-1" },
        units: [{ id: UNIT_ID, serialNumber: "SERIAL-1", status: "in_stock" }],
        workorderId: receivedDependencies.workorderId,
      }),
    }),
  );
  assert.equal(createResponse.status, 201);
  assert.equal(createResponse.payload.batch.itemCount, 2);
  assert.equal(createResponse.payload.workorderId, WORKORDER_ID);
});

test("create-workorder part route lists exact units using location and catalog scope", async () => {
  const locationId = "00000000-0000-4000-8000-000000000006";
  const catalogPartId = "00000000-0000-4000-8000-000000000008";
  const response = {};
  let listed;
  await handleInventoryUnitWorkorderApi(
    { method: "GET" }, response,
    new URL(`http://localhost/api/workorders/create-inventory/locations/${locationId}/parts/${catalogPartId}/units?limit=100`),
    helpers(), dependencies({
      getLocation: async () => ({ id: locationId, company_id: "00000000-0000-4000-8000-000000000005" }),
      authorizeCreate: async () => {},
      listAvailableUnits: async (input) => {
        listed = input;
        return {
          kind: "found",
          serialRequired: true,
          units: [{ id: UNIT_ID, serialNumber: "SERIAL-1" }],
        };
      },
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(response.payload.units[0].serialNumber, "SERIAL-1");
  assert.equal(listed.locationId, locationId);
  assert.equal(listed.catalogPartId, catalogPartId);
  assert.equal(listed.limit, 100);
});

test("mechanics can list units but are not offered the inventory-creation action", async () => {
  const catalogPartId = "00000000-0000-4000-8000-000000000008";
  const response = {};
  await handleInventoryUnitWorkorderApi(
    { method: "GET" }, response,
    new URL(`http://localhost/api/workorders/${WORKORDER_ID}/inventory-parts/${catalogPartId}/units`),
    helpers(null, "mechanic"), dependencies({
      listAvailableUnits: async () => ({
        kind: "found",
        part: { catalogPartId, partNumber: "P-1", description: "Part", uomCode: "ea" },
        location: { locationId: "00000000-0000-4000-8000-000000000006", name: "Shop" },
        canCreateSerializedUnits: true,
        units: [],
        nextCursor: null,
      }),
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(response.payload.canCreateSerializedUnits, false);
});

test("handler returns stable validation and inventory errors", async () => {
  const invalid = {};
  await handleInventoryUnitWorkorderApi(
    { method: "POST" }, invalid,
    new URL(`http://localhost/api/workorders/${WORKORDER_ID}/inventory-units/issue`),
    helpers({ code: "x", idempotencyKey: "short" }), dependencies(),
  );
  assert.equal(invalid.status, 400);
  assert.equal(invalid.payload.code, "validation_error");

  const ambiguous = {};
  await handleInventoryUnitWorkorderApi(
    { method: "POST" }, ambiguous,
    new URL(`http://localhost/api/workorders/${WORKORDER_ID}/inventory-units/issue`),
    helpers({ unitId: UNIT_ID, code: "inventory-code", idempotencyKey: "issue-key-123" }), dependencies(),
  );
  assert.equal(ambiguous.status, 400);
  assert.equal(ambiguous.payload.code, "validation_error");

  const conflict = {};
  await handleInventoryUnitWorkorderApi(
    { method: "POST" }, conflict,
    new URL(`http://localhost/api/workorders/${WORKORDER_ID}/inventory-units/issue`),
    helpers({ code: "inventory-code", idempotencyKey: "issue-key-123" }),
    dependencies({ issueUnit: async () => ({ kind: "provider_not_local", usage: null }) }),
  );
  assert.equal(conflict.status, 409);
  assert.equal(conflict.payload.code, "INVENTORY_UNIT_PROVIDER_NOT_LOCAL");
});

test("matched routes reject unsupported methods without reading a body", async () => {
  const response = {};
  await handleInventoryUnitWorkorderApi(
    { method: "DELETE" }, response,
    new URL(`http://localhost/api/workorders/${WORKORDER_ID}/inventory-unit-usages`),
    helpers(), dependencies(),
  );
  assert.equal(response.status, 405);
});

test("unshipped mechanic-prefixed scanner routes are not retained as an authorization bypass", async () => {
  assert.equal(await handleInventoryUnitWorkorderApi(
    { method: "POST" }, {},
    new URL(`http://localhost/api/mechanic/workorders/${WORKORDER_ID}/inventory-units/issue`),
    helpers({ code: "inventory-code", idempotencyKey: "issue-key-123" }), dependencies(),
  ), false);
});
