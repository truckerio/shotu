import assert from "node:assert/strict";
import test from "node:test";
import {
  createLaborProductPayload,
  laborProductLabel,
  localLaborProductValue,
  normalizeLaborProductsResponse,
  orderedLaborProducts,
  productMatchesValue,
} from "./labor-product-selector-model.js";

test("normalizes only usable local labor products and capability flags", () => {
  assert.deepEqual(normalizeLaborProductsResponse({
    canCreate: 1,
    canPin: true,
    items: [{ id: "labor-1", name: " Shop labor ", code: " LAB ", uomCode: "ea", pinned: true }, { id: "", name: "Ignore" }],
  }), {
    canCreate: true,
    canPin: true,
    items: [{ id: "labor-1", name: "Shop labor", code: "LAB", uomCode: "hr", pinned: true }],
  });
});

test("places pins first without making them mandatory selection rows", () => {
  const ordered = orderedLaborProducts([
    { id: "2", name: "Zulu", code: "", pinned: false },
    { id: "3", name: "Beta", code: "", pinned: true },
    { id: "1", name: "Alpha", code: "", pinned: true },
  ]);
  assert.deepEqual(ordered.map((item) => item.id), ["1", "3", "2"]);
});

test("local selection preserves the product id while legacy values remain displayable", () => {
  const value = localLaborProductValue({ id: "labor-1", name: "Shop labor", code: "LAB" });
  assert.deepEqual(value, { productId: "labor-1", externalId: "", name: "Shop labor", code: "LAB", uomCode: "hr" });
  assert.equal(productMatchesValue({ id: "labor-1" }, value), true);
  assert.equal(productMatchesValue({ id: "labor-2" }, { externalId: "old" }), false);
  assert.equal(laborProductLabel({ externalId: "old", name: "Legacy labor", code: "L-1" }), "[L-1] Legacy labor");
  assert.equal(laborProductLabel(null), "Labor hours");
});

test("create payload trims optional values and rejects missing local context", () => {
  assert.deepEqual(createLaborProductPayload({ locationId: " loc-1 ", name: " Shop labor ", code: " LAB " }), {
    locationId: "loc-1", name: "Shop labor", code: "LAB",
  });
  assert.equal(createLaborProductPayload({ locationId: "loc-1", name: " " }), null);
});
