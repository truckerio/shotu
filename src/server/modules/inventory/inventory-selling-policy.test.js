import assert from "node:assert/strict";
import test from "node:test";
import { calculateSellingUnitPrice, sellingPolicyCurrency } from "./inventory-selling-policy.js";

test("selling policies calculate fixed, percent markup, and amount markup from exact batch cost", () => {
  assert.equal(calculateSellingUnitPrice({ method: "fixed", value: "35" }, null), "35.0000");
  assert.equal(calculateSellingUnitPrice({ method: "markup_percent", value: "40" }, "20"), "28.0000");
  assert.equal(calculateSellingUnitPrice({ method: "markup_amount", value: "10" }, "25"), "35.0000");
  assert.equal(calculateSellingUnitPrice({ method: "markup_percent", value: "12.3456" }, "0.1000"), "0.1123");
  assert.equal(sellingPolicyCurrency({ method: "markup_percent" }, "USD"), "USD");
  assert.equal(sellingPolicyCurrency({ method: "fixed", currency: "CAD" }, "USD"), "CAD");
});

test("derived selling price refuses missing or invalid batch cost", () => {
  assert.throws(() => calculateSellingUnitPrice({ method: "markup_percent", value: "20" }, null), /Batch cost/);
  assert.throws(() => calculateSellingUnitPrice({ method: "markup_amount", value: "5" }, -1), /Batch cost/);
});
