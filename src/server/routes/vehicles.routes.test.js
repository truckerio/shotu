import assert from "node:assert/strict";
import test from "node:test";
import { handleVehiclesApi } from "./vehicles.routes.js";

const input = { companyId: "11111111-1111-4111-8111-111111111111", locationId: "22222222-2222-4222-8222-222222222222", unitType: "Truck", unitNo: "LOCAL-1" };
for (const query of ["limit=101", "type=Other", `q=${"x".repeat(121)}`]) {
  test(`directory maps invalid query to HTTP 400: ${query.slice(0, 20)}`, async () => {
    const h = harness();
    await assert.rejects(
      handleVehiclesApi({ method: "GET" }, {}, new URL(`http://x/api/vehicles/directory?${query}`), h.helpers),
      (error) => error.statusCode === 400 && error.code === "INVALID_UNITS_DIRECTORY_QUERY",
    );
  });
}
function harness(body = input, role = "office") { const sent = []; return { sent, helpers: { requestContext: { actor: { id: "actor-1", role }, companyIds: new Set([input.companyId]), locationIds: new Set([input.locationId]) }, readBody: async () => body, sendJson: (_res, status, value) => sent.push({ status, value }) } }; }

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

test("directory returns the stable identity page and passes validated query fields", async () => {
  const h = harness();
  let received;
  await handleVehiclesApi({ method: "GET" }, {}, new URL("http://x/api/vehicles/directory?q=TRK&type=Truck&limit=30&cursor=next"), h.helpers, {
    directory: async (context, raw) => (received = { context, raw }, { items: [{ id: "asset-1", companyId: input.companyId, unitNo: "TRK-1", unitType: "Truck" }], nextCursor: "later" }),
  });
  assert.deepEqual(received.raw, { q: "TRK", type: "Truck", limit: "30", cursor: "next" });
  assert.equal(received.context.actor.role, "office");
  assert.deepEqual(h.sent[0], { status: 200, value: { items: [{ id: "asset-1", companyId: input.companyId, unitNo: "TRK-1", unitType: "Truck" }], nextCursor: "later" } });
});

test("directory does not fall through to the generic vehicle id route", async () => {
  const h = harness();
  await handleVehiclesApi({ method: "GET" }, {}, new URL("http://x/api/vehicles/directory"), h.helpers, {
    directory: async () => ({ items: [], nextCursor: null }),
  });
  assert.deepEqual(h.sent[0], { status: 200, value: { items: [], nextCursor: null } });
});

test("directory rejects unauthorized roles at the route boundary", async () => {
  const h = harness(input, "mechanic");
  await assert.rejects(
    handleVehiclesApi({ method: "GET" }, {}, new URL("http://x/api/vehicles/directory"), h.helpers),
    (error) => error.statusCode === 403,
  );
});

test("directory rejects an invalid cursor before a database query", async () => {
  const h = harness();
  await assert.rejects(
    handleVehiclesApi({ method: "GET" }, {}, new URL("http://x/api/vehicles/directory?cursor=bad"), h.helpers, {
      directoryDependencies: { repositoryDependencies: { query: async () => assert.fail("must not query") } },
    }),
    (error) => error.statusCode === 400 && error.code === "INVALID_UNITS_DIRECTORY_CURSOR",
  );
});
