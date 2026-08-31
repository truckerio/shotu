import assert from "node:assert/strict";
import test from "node:test";
import { handleMechanicApi } from "./mechanic.routes.js";

const context = {
  actor: { id: "11111111-1111-4111-8111-111111111111", role: "mechanic" },
  companyIds: new Set(["22222222-2222-4222-8222-222222222222"]),
  locationIds: new Set(["33333333-3333-4333-8333-333333333333"]),
};

function helpers(responses) {
  return {
    requestContext: context,
    sendJson: (_res, status, value) => responses.push({ status, value }),
    readBody: async () => ({}),
  };
}

test("legacy Mechanic detail includes installed serialized summaries and restricted role detail", async () => {
  const responses = [];
  let installedScope;
  await handleMechanicApi(
    { method: "GET" }, {}, new URL("http://example.test/api/mechanic/workorders/workorder-1"), helpers(responses), {
      resolveModules: async () => ({ decisions: { parts: { access: "write", source: "default" } } }),
      loadDetail: async () => ({
        user: context.actor,
        workorder: {
          id: "workorder-1",
          companyId: "22222222-2222-4222-8222-222222222222",
          locationId: "33333333-3333-4333-8333-333333333333",
          formData: {},
        },
        policy: { mechanicCanRecordParts: true },
        allowedActions: { recordUsedParts: true },
      }),
      listInstalledParts: async (scope) => {
        installedScope = scope;
        return [{ catalogPartId: "catalog-1", partNumber: "LF9009", quantity: 2, uomCode: "ea" }];
      },
    },
  );

  const detail = responses[0].value;
  assert.equal(responses[0].status, 200);
  assert.equal(detail.user.role, "mechanic");
  assert.equal(detail.policy.mechanicCanRecordParts, true);
  assert.equal(detail.allowedActions.recordUsedParts, true);
  assert.equal(detail.modules.parts.data.installedSerializedParts[0].quantity, 2);
  assert.deepEqual(installedScope, {
    workorderId: "workorder-1",
    companyId: "22222222-2222-4222-8222-222222222222",
    locationId: "33333333-3333-4333-8333-333333333333",
    limit: 2000,
  });
});

test("legacy Mechanic detail does not query or expose summaries when Parts is hidden", async () => {
  const responses = [];
  let queried = false;
  await handleMechanicApi(
    { method: "GET" }, {}, new URL("http://example.test/api/mechanic/workorders/workorder-1"), helpers(responses), {
      resolveModules: async () => ({ decisions: { parts: { access: "hidden", source: "user" } } }),
      loadDetail: async () => ({ workorder: { id: "workorder-1", companyId: "company-1", locationId: "location-1", formData: {} } }),
      listInstalledParts: async () => { queried = true; return []; },
    },
  );
  assert.equal(queried, false);
  assert.equal("parts" in responses[0].value.modules, false);
  assert.equal("installedSerializedParts" in responses[0].value.workorder, false);
});

test("legacy mechanic part-usage PATCH propagates the read-only lifecycle guard without a success response", async () => {
  const responses = [];
  const calls = [];
  const lifecycleError = Object.assign(new Error("Part lifecycle status is read-only."), {
    code: "MECHANIC_PART_USAGE_READ_ONLY",
    statusCode: 403,
  });
  const routeHelpers = {
    ...helpers(responses),
    readBody: async () => ({ usageStatus: "installed", note: "Attempt direct lifecycle jump" }),
  };

  await assert.rejects(
    handleMechanicApi(
      { method: "PATCH" },
      {},
      new URL("http://example.test/api/mechanic/workorders/workorder-1/parts/request-1/usage"),
      routeHelpers,
      {
        runAction: async (...args) => {
          calls.push(args);
          throw lifecycleError;
        },
      },
    ),
    (error) => error === lifecycleError,
  );

  assert.equal(responses.length, 0);
  assert.deepEqual(calls[0].slice(1, 5), ["workorder-1", "parts", "record", {
    operation: "usage",
    requestId: "request-1",
    usageStatus: "installed",
    note: "Attempt direct lifecycle jump",
  }]);
});
