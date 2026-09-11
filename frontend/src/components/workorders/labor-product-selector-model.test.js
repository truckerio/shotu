import assert from "node:assert/strict";
import test from "node:test";
import {
  createLaborProductPayload,
  laborProductLabel,
  laborProductSelectionPatch,
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


test("labor description survives creation payload, response, and selected snapshot", () => {
  const payload = createLaborProductPayload({ locationId: "loc-1", name: "Diagnostics", description: "  Inspect wiring and replace sensor  " });
  assert.equal(payload.description, "Inspect wiring and replace sensor");
  const response = normalizeLaborProductsResponse({ items: [{ id: "labor-1", ...payload }] });
  const selected = localLaborProductValue(response.items[0]);
  assert.equal(selected.description, "Inspect wiring and replace sensor");
});


test("labour selection seeds only blank repair text and never overwrites user edits", () => {
  const product = { productId: "labor-1", description: "Inspect wiring" };
  assert.deepEqual(laborProductSelectionPatch({ workPerformed: "" }, product), { laborProduct: product, workPerformed: "Inspect wiring" });
  assert.deepEqual(laborProductSelectionPatch({ workPerformed: "Custom repair  " }, product), { laborProduct: product });
  assert.deepEqual(laborProductSelectionPatch({ workPerformed: "" }, null), { laborProduct: null });
});


test("reselecting labour preserves a cleared Repair order while new selections get their own default", () => {
  const product = { productId: "labor-1", description: "Inspect wiring" };
  const form = { laborProduct: product, workPerformed: "" };
  assert.deepEqual(laborProductSelectionPatch(form, product), { laborProduct: product });
  const next = { productId: "labor-2", description: "Replace sensor" };
  assert.deepEqual(laborProductSelectionPatch(form, next), { laborProduct: next, workPerformed: "Replace sensor" });
});
