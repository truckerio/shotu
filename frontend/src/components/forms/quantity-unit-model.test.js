import assert from "node:assert/strict";
import test from "node:test";
import {
  formatQuantityUnit,
  normalizeQuantityInput,
  normalizeQuantityUnit,
  quantityInputModel,
  unitOptionGroups,
} from "./quantity-unit-model.js";

test("count and packaging units reject decimal quantities", () => {
  assert.equal(normalizeQuantityInput("2.5", "ea"), "");
  assert.equal(normalizeQuantityInput("3", "case"), "3");
  assert.equal(quantityInputModel("3", "ea").step, "1");
});

test("liquid, mass, gas, and length units preserve up to three decimals", () => {
  for (const code of ["gal", "lb", "ft3", "ft"]) {
    assert.equal(normalizeQuantityInput("2.375", code), "2.375");
    assert.equal(quantityInputModel("2.375", code).step, "0.001");
  }
});

test("legacy and invalid units normalize to each", () => {
  assert.deepEqual(normalizeQuantityUnit("2", ""), { quantity: "2", uomCode: "ea" });
  assert.deepEqual(normalizeQuantityUnit("1", "not-real"), { quantity: "1", uomCode: "ea" });
  assert.equal(formatQuantityUnit("", ""), "1 ea");
});

test("search groups are sourced from the shared UoM catalog", () => {
  const groups = unitOptionGroups("gallon");
  assert.deepEqual(groups.flatMap((group) => group.units.map((unit) => unit.code)), ["gal"]);
  assert.equal(unitOptionGroups()[0].label, "Common");
});
