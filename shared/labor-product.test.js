import assert from "node:assert/strict";
import test from "node:test";

import {
  configuredLaborProduct,
  laborProductLabel,
  localLaborProductSnapshot,
  normalizeLaborProduct,
} from "./labor-product.js";

test("labor product label uses the Admin-selected code and name", () => {
  assert.equal(laborProductLabel({ code: "LAB200", name: "Shop labor" }), "[LAB200] Shop labor");
  assert.equal(laborProductLabel({ code: "PTR001", name: "[PTR001] LABOR HOURS" }), "[PTR001] LABOR HOURS");
  assert.equal(laborProductLabel(null), "Labor hours");
});

test("labor product normalization accepts database field names", () => {
  assert.deepEqual(normalizeLaborProduct({
    external_id: "91",
    default_code: "LAB200",
    display_name: "Shop labor",
  }), {
    externalId: "91",
    code: "LAB200",
    name: "Shop labor",
    uomCode: "hr",
  });
});

test("configured labor product requires a provider identity", () => {
  assert.equal(configuredLaborProduct({ code: "LAB", name: "Labor" }), null);
  assert.equal(configuredLaborProduct({ externalId: "91", code: "LAB", name: "Labor" }).externalId, "91");
});

test("local labor snapshot keeps its local identity separate from Odoo", () => {
  assert.deepEqual(localLaborProductSnapshot({
    id: "11111111-1111-4111-8111-111111111111",
    code: "DIAG",
    name: "Diagnostics",
    externalId: "unsafe-client-value",
  }), {
    productId: "11111111-1111-4111-8111-111111111111",
    externalId: "",
    code: "DIAG",
    name: "Diagnostics",
    uomCode: "hr",
  });
});

test("local labor snapshot preserves its repair-order description", () => {
  assert.deepEqual(localLaborProductSnapshot({
    id: "11111111-1111-4111-8111-111111111111",
    code: "DIAG",
    name: "Diagnostics",
    description: " Diagnose the no-start condition and verify the repair. ",
  }), {
    productId: "11111111-1111-4111-8111-111111111111",
    externalId: "",
    code: "DIAG",
    name: "Diagnostics",
    uomCode: "hr",
    description: "Diagnose the no-start condition and verify the repair.",
  });
});
