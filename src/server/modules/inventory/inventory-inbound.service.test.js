import assert from "node:assert/strict";
import test from "node:test";
import { inboundIdSchema, inboundQuerySchema } from "./inventory-inbound.schemas.js";
import { getInbound, getInboundDetail } from "./inventory-inbound.service.js";
import { InventoryError } from "./inventory.errors.js";

const COMPANY = "00000000-0000-4000-8000-000000000001";
const OTHER_COMPANY = "00000000-0000-4000-8000-000000000002";
const LOCATION = "00000000-0000-4000-8000-000000000011";
const OTHER_LOCATION = "00000000-0000-4000-8000-000000000012";
const INBOUND = "00000000-0000-4000-8000-000000000021";
const ACTOR = "00000000-0000-4000-8000-000000000031";

const officeContext = (overrides = {}) => ({
  actor: { id: ACTOR, role: "office" },
  companyIds: new Set([COMPANY, OTHER_COMPANY]),
  locationIds: new Set([LOCATION]),
  ...overrides,
});

test("inbound query and id schemas bound views, paging, search, and identifiers", () => {
  assert.deepEqual(inboundQuerySchema.parse({}), { view: "my_work", page: 1 });
  assert.deepEqual(inboundQuerySchema.parse({ view: "attention", page: "2", q: " filter " }), {
    view: "attention", page: 2, q: "filter",
  });
  for (const value of [{ view: "bad" }, { page: 0 }, { page: "nope" }, { q: "x".repeat(161) }]) {
    assert.equal(inboundQuerySchema.safeParse(value).success, false);
  }
  assert.equal(inboundIdSchema.safeParse(INBOUND).success, true);
  assert.equal(inboundIdSchema.safeParse("not-an-id").success, false);
});

test("list uses active locations and preserves the scoped company/location projection", async () => {
  let listed;
  const result = await getInbound(new URLSearchParams("view=expected&page=2&q=filter"), officeContext(), {
    query: async () => ({ rows: [
      { id: LOCATION, company_id: COMPANY },
      { id: OTHER_LOCATION, company_id: OTHER_COMPANY },
    ] }),
    listInbound: async (input) => { listed = input; return { items: [], page: input.page, hasMore: false, counts: {} }; },
  });
  assert.deepEqual(result, { items: [], page: 2, hasMore: false, counts: {} });
  assert.deepEqual(listed, {
    companyIds: [COMPANY], locationIds: [LOCATION],
    view: "expected", page: 2, q: "filter",
  });
});

test("explicit location scope delegates to authorization and preserves the company boundary", async () => {
  let requested;
  let listed;
  await getInbound(new URLSearchParams(`locationId=${LOCATION}`), officeContext(), {
    resolveLocationScope: async (context, locationId, options) => {
      requested = { context, locationId, options };
      return { companyIds: [COMPANY], locationIds: [LOCATION] };
    },
    listInbound: async (input) => { listed = input; return input; },
  });
  assert.equal(requested.locationId, LOCATION);
  assert.equal(requested.options.code, "INVENTORY_INBOUND_FORBIDDEN");
  assert.deepEqual(listed.locationIds, [LOCATION]);
  assert.deepEqual(listed.companyIds, [COMPANY]);
});

test("unauthorized role is rejected before any repository query", async () => {
  let queried = false;
  await assert.rejects(
    () => getInbound(new URLSearchParams(), officeContext({ actor: { id: ACTOR, role: "mechanic" } }), {
      query: async () => { queried = true; return { rows: [] }; },
    }),
    (error) => error instanceof InventoryError && error.statusCode === 403 && error.code === "INVENTORY_INBOUND_FORBIDDEN",
  );
  assert.equal(queried, false);
});

test("detail returns the scoped item and hides an out-of-scope or missing item as 404", async () => {
  let readInput;
  const detail = await getInboundDetail(INBOUND, new URLSearchParams(), officeContext(), {
    query: async () => ({ rows: [{ id: LOCATION, company_id: COMPANY }] }),
    readInbound: async (input) => { readInput = input; return { id: INBOUND, nextAction: "receive" }; },
  });
  assert.deepEqual(detail, { item: { id: INBOUND, nextAction: "receive" } });
  assert.deepEqual(readInput, { id: INBOUND, companyIds: [COMPANY], locationIds: [LOCATION] });

  await assert.rejects(
    () => getInboundDetail(INBOUND, new URLSearchParams(), officeContext(), {
      query: async () => ({ rows: [{ id: LOCATION, company_id: COMPANY }]}),
      readInbound: async () => null,
    }),
    (error) => error instanceof InventoryError && error.statusCode === 404 && error.code === "inventory_not_found",
  );
});
