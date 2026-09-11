import assert from "node:assert/strict";
import test from "node:test";

import {
  addLaborProduct,
  changeLaborProductPin,
  readLaborProducts,
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
  }), (error) => error.statusCode === 403);
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
