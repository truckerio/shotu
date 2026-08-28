import assert from "node:assert/strict";
import test from "node:test";
import { handleInventoryUnitWorkorderApi } from "./inventory-unit-workorder.routes.js";

const WORKORDER_ID = "00000000-0000-4000-8000-000000000001";
const USAGE_ID = "00000000-0000-4000-8000-000000000002";
const UNIT_ID = "00000000-0000-4000-8000-000000000003";

function helpers(body = null) {
  return {
    requestContext: {
      actor: { id: "00000000-0000-4000-8000-000000000004", role: "mechanic" },
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
    loadPartsPolicy: async () => ({ mechanicCanRecordParts: true }),
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
    new URL(`http://localhost/api/mechanic/workorders/${WORKORDER_ID}/inventory-units/resolve`),
    helpers({ code: "inventory-code" }), dependencies(),
  );
  assert.equal(resolveResponse.status, 200);
  assert.equal(resolveResponse.payload.eligibility.canIssue, true);

  const usage = { id: USAGE_ID, status: "issued" };
  const issueResponse = {};
  await handleInventoryUnitWorkorderApi(
    { method: "POST" }, issueResponse,
    new URL(`http://localhost/api/mechanic/workorders/${WORKORDER_ID}/inventory-units/issue`),
    helpers({ code: "inventory-code", idempotencyKey: "issue-key-123" }),
    dependencies({ issueUnit: async () => ({ kind: "issued", usage }) }),
  );
  assert.equal(issueResponse.status, 201);
  assert.equal(issueResponse.payload.usage.id, USAGE_ID);

  const listResponse = {};
  await handleInventoryUnitWorkorderApi(
    { method: "GET" }, listResponse,
    new URL(`http://localhost/api/mechanic/workorders/${WORKORDER_ID}/inventory-unit-usages`),
    helpers(), dependencies({ listUsages: async () => [usage] }),
  );
  assert.equal(listResponse.status, 200);
  assert.equal(listResponse.payload.usages.length, 1);

  const finalResponse = {};
  await handleInventoryUnitWorkorderApi(
    { method: "POST" }, finalResponse,
    new URL(`http://localhost/api/mechanic/workorders/${WORKORDER_ID}/inventory-unit-usages/${USAGE_ID}/finalize`),
    helpers({ disposition: "installed", idempotencyKey: "finish-key-123" }),
    dependencies({ finalizeUnit: async () => ({ kind: "finalized", usage: { ...usage, status: "installed" } }) }),
  );
  assert.equal(finalResponse.status, 200);
  assert.equal(finalResponse.payload.usage.status, "installed");
});

test("handler returns stable validation and inventory errors", async () => {
  const invalid = {};
  await handleInventoryUnitWorkorderApi(
    { method: "POST" }, invalid,
    new URL(`http://localhost/api/mechanic/workorders/${WORKORDER_ID}/inventory-units/issue`),
    helpers({ code: "x", idempotencyKey: "short" }), dependencies(),
  );
  assert.equal(invalid.status, 400);
  assert.equal(invalid.payload.code, "validation_error");

  const conflict = {};
  await handleInventoryUnitWorkorderApi(
    { method: "POST" }, conflict,
    new URL(`http://localhost/api/mechanic/workorders/${WORKORDER_ID}/inventory-units/issue`),
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
    new URL(`http://localhost/api/mechanic/workorders/${WORKORDER_ID}/inventory-unit-usages`),
    helpers(), dependencies(),
  );
  assert.equal(response.status, 405);
});
