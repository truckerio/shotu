import assert from "node:assert/strict";
import test from "node:test";
import { assertWorkorderLaborQuantity } from "./workorder-labor-quantity.js";

test("labor quantity guard preserves legacy hourly quantities and empty drafts", () => {
  for (const laborHours of ["", "1", "1.25", "9999"]) assert.doesNotThrow(() => assertWorkorderLaborQuantity({ laborHours }));
});

test("flat service quantities require whole positive counts on persisted mutation paths", () => {
  for (const laborHours of ["1", "12", "9999"]) assert.doesNotThrow(() => assertWorkorderLaborQuantity({ laborHours, laborProduct: { uomCode: "ea" } }));
  for (const laborHours of ["1.5", "0", "-1", "10000", "NaN"]) {
    assert.throws(() => assertWorkorderLaborQuantity({ laborHours, laborProduct: { uomCode: "ea" } }), (error) => error.code === "WORKORDER_LABOR_QUANTITY_INVALID");
  }
});
