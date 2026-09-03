import assert from "node:assert/strict";
import test from "node:test";
import { handleVehiclesApi } from "./vehicles.routes.js";

const input = { companyId: "11111111-1111-4111-8111-111111111111", locationId: "22222222-2222-4222-8222-222222222222", unitType: "Truck", unitNo: "LOCAL-1" };
function harness(body = input) { const sent = []; return { sent, helpers: { requestContext: { companyIds: new Set([input.companyId]) }, readBody: async () => body, sendJson: (_res, status, value) => sent.push({ status, value }) } }; }

test("manual vehicle route validates input and returns a canonical asset", async () => {
  const h = harness();
  let received;
  const handled = await handleVehiclesApi({ method: "POST" }, {}, new URL("http://x/api/vehicles/manual"), h.helpers, { createManual: async (_context, value) => (received = value, { id: "asset-1" }) });
  assert.equal(handled, true);
  assert.equal(received.unitNo, "LOCAL-1");
  assert.deepEqual(h.sent[0], { status: 201, value: { vehicle: { id: "asset-1" } } });
});

test("manual vehicle route rejects non-canonical unit types before delegation", async () => {
  const h = harness({ ...input, unitType: "Other" });
  await assert.rejects(handleVehiclesApi({ method: "POST" }, {}, new URL("http://x/api/vehicles/manual"), h.helpers, { createManual: async () => assert.fail("must not delegate") }), /Invalid enum value|Invalid option/i);
});
