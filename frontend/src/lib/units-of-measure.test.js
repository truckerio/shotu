import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_UOM_CODE,
  UNITS_OF_MEASURE,
  convertQuantity,
  formatQuantity,
  normalizeQuantity,
  normalizeUomCode,
  quantityStep,
} from "../../../shared/units-of-measure.js";

test("unit codes are unique and unknown values resolve to the piece default", () => {
  const codes = UNITS_OF_MEASURE.map((unit) => unit.code);

  assert.equal(new Set(codes).size, codes.length);
  assert.equal(normalizeUomCode("GAL"), "gal");
  assert.equal(normalizeUomCode("not-a-unit"), DEFAULT_UOM_CODE);
});

test("count and packaging quantities stay whole while measured quantities allow decimals", () => {
  assert.equal(normalizeQuantity("2", "ea"), "2");
  assert.equal(normalizeQuantity("2.5", "ea"), "");
  assert.equal(normalizeQuantity("3", "case"), "3");
  assert.equal(normalizeQuantity("2.5", "gal"), "2.5");
  assert.equal(normalizeQuantity("12.7504", "lb"), "12.75");
  assert.equal(normalizeQuantity("0.50", "hr"), "0.5");
  assert.equal(normalizeQuantity("0.505", "hr"), "0.51");
  assert.equal(quantityStep("ea"), "1");
  assert.equal(quantityStep("gal"), "0.001");
  assert.equal(quantityStep("hr"), "0.01");
});

test("formatting and compatible conversions use canonical symbols", () => {
  assert.equal(formatQuantity("2.5", "gal"), "2.5 gal");
  assert.equal(formatQuantity("12.75", "lb"), "12.75 lb");
  assert.equal(formatQuantity("80", "ft3"), "80 ft³");
  assert.equal(formatQuantity("1.25", "hr"), "1.25 hr");
  assert.ok(Math.abs(convertQuantity(1, "gal", "l") - 3.785411784) < 0.0000001);
  assert.equal(convertQuantity(1, "gal", "lb"), null);
  assert.equal(convertQuantity(1, "case", "ea"), null);
});
