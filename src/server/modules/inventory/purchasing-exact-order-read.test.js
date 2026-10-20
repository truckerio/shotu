import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { handleInventoryApi } from "./inventory.routes.js";

const COMPANY_ID = "00000000-0000-4000-8000-000000000001";
const FOREIGN_COMPANY_ID = "00000000-0000-4000-8000-000000000002";
const LOCATION_ID = "00000000-0000-4000-8000-000000000011";
const OTHER_LOCATION_ID = "00000000-0000-4000-8000-000000000012";
const ORDER_ID = "00000000-0000-4000-8000-000000000021";
const UNKNOWN_ORDER_ID = "00000000-0000-4000-8000-000000000022";
const ACTOR_ID = "00000000-0000-4000-8000-000000000031";

function context(role = "office", overrides = {}) {
  return {
    actor: { id: ACTOR_ID, role },
    companyIds: new Set([COMPANY_ID]),
    companyRoles: new Map([[COMPANY_ID, role]]),
    locationIds: new Set([LOCATION_ID]),
    ...overrides,
  };
}

async function request(path, dependencies, requestContext = context()) {
  const response = {};
  const handled = await handleInventoryApi(
    { method: "GET" },
    response,
    new URL(path, "http://localhost"),
    {
      requestContext,
      sendJson: (res, status, payload) => Object.assign(res, { status, payload }),
    },
    dependencies,
  );
  assert.equal(handled, true);
  return response;
}

const payload = (items) => ({
  suppliers: [], items, demand: [], receipts: [], total: items.length,
  pageCount: items.length ? 1 : 0, hasMore: false, page: 1,
  purchaseDefaults: { currency: "USD", approvalConfigured: false }, canApprove: false,
});

test("exact purchase order read crosses route, validation, and Office location scope", async () => {
  let readInput;
  const response = await request(
    `/api/office/inventory/purchasing?locationId=${LOCATION_ID}&orderId=${ORDER_ID}&page=99&view=receiving&status=cancelled&query=no-match`,
    {
      loadLocation: async (id, companyIds) => {
        assert.equal(id, LOCATION_ID);
        assert.deepEqual(companyIds, [COMPANY_ID]);
        return { id: LOCATION_ID, company_id: COMPANY_ID };
      },
      readPurchasing: async (input) => {
        readInput = input;
        return payload([{ id: input.orderId, number: "PO-EXACT" }]);
      },
    },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(response.payload.items, [{ id: ORDER_ID, number: "PO-EXACT" }]);
  assert.equal(readInput.orderId, ORDER_ID);
  assert.equal(readInput.locationId, LOCATION_ID);
  assert.deepEqual(readInput.companyIds, [COMPANY_ID]);
  assert.deepEqual(readInput.locationIds, [LOCATION_ID]);
  assert.equal(readInput.effectiveRole, "office");
  assert.equal(readInput.page, 1);
  assert.equal(readInput.view, "receiving");
  assert.equal(readInput.status, "cancelled");
  assert.equal(readInput.query, "no-match");
});

test("malformed exact order id is rejected before scope or repository reads", async () => {
  const response = await request(
    `/api/office/inventory/purchasing?locationId=${LOCATION_ID}&orderId=not-a-uuid`,
    {
      loadLocation: async () => assert.fail("Malformed order id reached location scope"),
      readPurchasing: async () => assert.fail("Malformed order id reached purchasing read"),
    },
  );
  assert.equal(response.status, 400);
  assert.equal(response.payload.code, "validation_error");
});

test("unknown exact order id keeps the list response shape with an empty result", async () => {
  const response = await request(
    `/api/office/inventory/purchasing?locationId=${LOCATION_ID}&orderId=${UNKNOWN_ORDER_ID}`,
    {
      loadLocation: async () => ({ id: LOCATION_ID, company_id: COMPANY_ID }),
      readPurchasing: async (input) => {
        assert.equal(input.orderId, UNKNOWN_ORDER_ID);
        return payload([]);
      },
    },
  );
  assert.equal(response.status, 200);
  assert.deepEqual(response.payload, payload([]));
});

test("omitted or empty order id preserves existing purchasing list defaults", async () => {
  for (const suffix of ["", "&orderId="]) {
    let readInput;
    const response = await request(
      `/api/office/inventory/purchasing?locationId=${LOCATION_ID}${suffix}`,
      {
        loadLocation: async () => ({ id: LOCATION_ID, company_id: COMPANY_ID }),
        readPurchasing: async (input) => { readInput = input; return payload([]); },
      },
    );
    assert.equal(response.status, 200);
    assert.equal(readInput.orderId, "");
    assert.equal(readInput.page, 1);
    assert.equal(readInput.view, "purchases");
    assert.equal(readInput.status, "all");
  }
});

test("Office exact reads cannot cross assigned locations", async () => {
  const response = await request(
    `/api/office/inventory/purchasing?locationId=${OTHER_LOCATION_ID}&orderId=${ORDER_ID}`,
    {
      loadLocation: async () => ({ id: OTHER_LOCATION_ID, company_id: COMPANY_ID }),
      readPurchasing: async () => assert.fail("Cross-location request reached purchasing read"),
    },
  );
  assert.equal(response.status, 404);
  assert.equal(response.payload.code, "inventory_not_found");
});

test("denied roles and foreign locations stop before the purchasing read", async () => {
  const denied = await request(
    `/api/office/inventory/purchasing?locationId=${LOCATION_ID}&orderId=${ORDER_ID}`,
    {
      loadLocation: async () => ({ id: LOCATION_ID, company_id: COMPANY_ID }),
      readPurchasing: async () => assert.fail("Denied role reached purchasing read"),
    },
    context("mechanic"),
  );
  assert.equal(denied.status, 403);
  assert.equal(denied.payload.code, "PURCHASING_FORBIDDEN");

  const foreign = await request(
    `/api/office/inventory/purchasing?locationId=${OTHER_LOCATION_ID}&orderId=${ORDER_ID}`,
    {
      loadLocation: async (_id, companyIds) => {
        assert.deepEqual(companyIds, [COMPANY_ID]);
        assert.equal(companyIds.includes(FOREIGN_COMPANY_ID), false);
        return null;
      },
      readPurchasing: async () => assert.fail("Foreign location reached purchasing read"),
    },
  );
  assert.equal(foreign.status, 404);
  assert.equal(foreign.payload.code, "inventory_not_found");
});

test("repository exact-id predicate is parameterized inside company and location scope", async () => {
  const source = await readFile(new URL("../../db/repositories/inventory-purchasing.repo.js", import.meta.url), "utf8");
  assert.match(source, /orderParams=\[shop\.company_id,shop\.id,[^\]]+input\.orderId\|\|''\]/);
  assert.match(source, /inventory_purchase_orders where company_id=\$1 and location_id=\$2 and \(\(\$8<>'' and id=nullif\(\$8,''\)::uuid\) or \(\$8='' and /);
  assert.doesNotMatch(source, /inventory_purchase_orders[^\n]+\$\{input\.orderId/);
});
