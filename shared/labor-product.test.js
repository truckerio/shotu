import assert from "node:assert/strict";
import test from "node:test";

import {
  configuredLaborProduct,
  laborProductLabel,
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
