import assert from "node:assert/strict";
import test from "node:test";

import {
  addLaborProduct,
  changeLaborProductPin,
  readLaborProducts,
  readLaborProductRates,
  reviseLaborProductRate,
  trustedLocalLaborProduct,
} from "./labor-products.service.js";

const COMPANY_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_COMPANY_ID = "22222222-2222-4222-8222-222222222222";
const LOCATION_ID = "33333333-3333-4333-8333-333333333333";
const PRODUCT_ID = "44444444-4444-4444-8444-444444444444";

function context(role = "office") {
  return {
    actor: { id: "actor-1", role },
    companyIds: new Set([COMPANY_ID]),
    locationIds: new Set([LOCATION_ID]),
  };
}

const location = { id: LOCATION_ID, company_id: COMPANY_ID };

test("list is location scoped and reports role capabilities", async () => {
  let scoped;
  const result = await readLaborProducts(new URLSearchParams({
    locationId: LOCATION_ID,
    q: "diag",
  }), context(), {
    findLocation: async (input) => { scoped = input; return location; },
    listProducts: async () => [{ id: PRODUCT_ID, name: "Diagnostics", code: "DIAG", uomCode: "hr", pinned: true }],
  });
  assert.deepEqual(scoped.companyIds, [COMPANY_ID]);
  assert.deepEqual(scoped.locationIds, [LOCATION_ID]);
  assert.equal(scoped.isAdmin, false);
  assert.deepEqual(result, {
    items: [{ id: PRODUCT_ID, name: "Diagnostics", code: "DIAG", uomCode: "hr", pinned: true }],
    canCreate: true,
    canPin: false,
  });
});

test("labor commercial facts are visible to office but redacted from mechanics", async () => {
  const priced = { id: PRODUCT_ID, name: "Diagnostics", code: "DIAG", uomCode: "hr", pinned: false, source: { provider: "odoo", externalId: "7" }, odooPricing: { selling: { status: "known", amount: "120", currency: "USD" } } };
  const dependencies = { findLocation: async () => location, listProducts: async () => [priced] };
  const office = await readLaborProducts(new URLSearchParams({ locationId: LOCATION_ID }), context("office"), dependencies);
  assert.equal(office.items[0].odooPricing.selling.amount, "120");
  const mechanic = await readLaborProducts(new URLSearchParams({ locationId: LOCATION_ID }), context("mechanic"), dependencies);
  assert.equal(mechanic.items[0].odooPricing, undefined);
  assert.equal(mechanic.items[0].source, undefined);
});

test("service requires authentication and prevents unauthorized creation", async () => {
  await assert.rejects(readLaborProducts(new URLSearchParams({ locationId: LOCATION_ID }), null), (error) => error.statusCode === 401);
  await assert.rejects(addLaborProduct({ locationId: LOCATION_ID, name: "Diagnostics" }, context("mechanic")), (error) => error.statusCode === 403);
});

test("cross-tenant location is hidden before catalog access", async () => {
  await assert.rejects(readLaborProducts(new URLSearchParams({ locationId: LOCATION_ID }), context(), {
    findLocation: async () => null,
    listProducts: async () => assert.fail("catalog must not run"),
  }), (error) => error.statusCode === 404);
  await assert.rejects(trustedLocalLaborProduct({
    productId: PRODUCT_ID,
    companyId: COMPANY_ID,
    locationId: LOCATION_ID,
  }, context(), {
    findLocation: async () => ({ id: LOCATION_ID, company_id: OTHER_COMPANY_ID }),
    findProduct: async () => assert.fail("product must not run"),
  }), (error) => error.statusCode === 404);
});

test("mixed roles use the location company role for commercial data and mutations", async () => {
  const mixed = {
    actor: { id: "actor-1", role: "admin" },
    companyIds: new Set([COMPANY_ID, OTHER_COMPANY_ID]),
    companyRoles: new Map([[COMPANY_ID, "admin"], [OTHER_COMPANY_ID, "mechanic"]]),
    locationIds: new Set([LOCATION_ID]),
  };
  const otherLocation = { id: LOCATION_ID, company_id: OTHER_COMPANY_ID };
  const priced = { id: PRODUCT_ID, name: "Diagnostics", source: { provider: "odoo" }, odooPricing: { selling: { amount: "120" } } };
  const result = await readLaborProducts(new URLSearchParams({ locationId: LOCATION_ID }), mixed, {
    findLocation: async () => otherLocation,
    listProducts: async () => [priced],
  });
  assert.equal(result.canCreate, false);
  assert.equal(result.canPin, false);
  assert.equal(result.items[0].odooPricing, undefined);
  let created = false;
  await assert.rejects(addLaborProduct({ locationId: LOCATION_ID, name: "Diagnostics" }, mixed, {
    findLocation: async () => otherLocation,
    createProduct: async () => { created = true; },
  }), (error) => error.statusCode === 403);
  assert.equal(created, false);
});

test("create rejects normalized duplicate input", async () => {
  await assert.rejects(addLaborProduct({
    locationId: LOCATION_ID,
    name: "  Diagnostics  ",
    code: " DIAG ",
  }, context(), {
    findLocation: async () => location,
    createProduct: async (input) => {
      assert.equal(input.name, "Diagnostics");
      assert.equal(input.code, "DIAG");
      return { kind: "duplicate" };
    },
  }), (error) => error.statusCode === 409 && error.code === "LABOR_PRODUCT_DUPLICATE");
});

test("create trims and persists the optional repair-order description", async () => {
  const result = await addLaborProduct({
    locationId: LOCATION_ID,
    name: "Diagnostics",
    description: " Diagnose the no-start condition. ",
  }, context(), {
    findLocation: async () => location,
    createProduct: async (input) => {
      assert.equal(input.description, "Diagnose the no-start condition.");
      return {
        kind: "created",
        product: { id: PRODUCT_ID, name: "Diagnostics", code: "", description: input.description, uomCode: "hr", pinned: false },
      };
    },
  });
  assert.equal(result.description, "Diagnose the no-start condition.");
});

test("pin is admin-only and validates the path id", async () => {
  await assert.rejects(changeLaborProductPin(PRODUCT_ID, {
    locationId: LOCATION_ID,
    pinned: true,
  }, context("office")), (error) => error.statusCode === 403);
  await assert.rejects(changeLaborProductPin("not-a-uuid", {
    locationId: LOCATION_ID,
    pinned: true,
  }, context("admin")), (error) => error.statusCode === 404);
});

test("trusted selection reloads the active record and emits a server snapshot", async () => {
  const result = await trustedLocalLaborProduct({
    productId: PRODUCT_ID,
    companyId: COMPANY_ID,
    locationId: LOCATION_ID,
  }, context(), {
    findLocation: async () => location,
    findProduct: async () => ({ id: PRODUCT_ID, name: "Diagnostics", code: "DIAG", description: "Diagnose the no-start condition.", uomCode: "hr", pinned: true }),
  });
  assert.deepEqual(result, {
    productId: PRODUCT_ID,
    externalId: "",
    name: "Diagnostics",
    code: "DIAG",
    uomCode: "hr",
    description: "Diagnose the no-start condition.",
  });
});

test("location-scoped labor rates are financial-role only and append exact versions", async () => {
  const dependencies = {
    findLocation: async () => location,
    findProduct: async () => ({ id: PRODUCT_ID }),
    readRates: async () => [{ id: PRODUCT_ID, labor_product_id: PRODUCT_ID, location_id: LOCATION_ID,
      price_kind: "selling_price", version: 2, amount: "125.0000", currency: "USD" }],
  };
  const read = await readLaborProductRates(PRODUCT_ID, { locationId: LOCATION_ID }, context(), dependencies);
  assert.equal(read.currentRates.selling_price.amount, "125.0000");
  let command;
  const saved = await reviseLaborProductRate(PRODUCT_ID, {
    locationId: LOCATION_ID, priceKind: "internal_cost", expectedVersion: 0,
    amount: "80.0000", currency: "USD", reason: "Approved shop cost", idempotencyKey: "labor-rate-create-1",
  }, context(), { ...dependencies, appendRate: async (value) => { command = value; return { kind: "saved", rate: { version: 1 } }; } });
  assert.equal(command.companyId, COMPANY_ID);
  assert.equal(command.locationId, LOCATION_ID);
  assert.match(command.requestHash, /^[0-9a-f]{64}$/);
  assert.equal(saved.rate.version, 1);
  await assert.rejects(readLaborProductRates(PRODUCT_ID, { locationId: LOCATION_ID }, context("mechanic"), dependencies),
    (error) => error.statusCode === 403);
});

test("labor rate write hides foreign locations and rejects stale versions", async () => {
  const body = { locationId: LOCATION_ID, priceKind: "selling_price", expectedVersion: 1,
    amount: "140.0000", currency: "USD", reason: "Approved update", idempotencyKey: "labor-rate-create-2" };
  await assert.rejects(reviseLaborProductRate(PRODUCT_ID, body, context(), {
    findLocation: async () => null,
    appendRate: async () => assert.fail("foreign location reached persistence"),
  }), (error) => error.statusCode === 404);
  await assert.rejects(reviseLaborProductRate(PRODUCT_ID, body, context(), {
    findLocation: async () => location,
    appendRate: async () => ({ kind: "version_conflict" }),
  }), (error) => error.statusCode === 409 && error.code === "LABOR_RATE_VERSION_CONFLICT");
});
