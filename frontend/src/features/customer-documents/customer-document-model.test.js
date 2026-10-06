import assert from "node:assert/strict";
import test from "node:test";
import { customerDocumentProjection, revisionDifference } from "./customer-document-model.js";

test("customer document projection keeps only renderer-owned display fields", () => {
  const projection = customerDocumentProjection({ type: "invoice", number: "INV-2", lines: [{ description: "Labor", amount: 10, internalCost: 4 }], internalCost: 99 });
  assert.equal(projection.type, "invoice");
  assert.deepEqual(projection.lines[0], { id: "line-1", description: "Labor", quantity: "", unit: "", unitPrice: null, amount: 10, change: "unchanged" });
  assert.equal("internalCost" in projection, false);
});

test("revision comparison only returns changed lines", () => {
  assert.deepEqual(revisionDifference({ lines: [{ id: "a", description: "Labor", amount: 10 }] }, { lines: [{ id: "a", description: "Labor", amount: 12 }, { id: "b", description: "Part", amount: 2 }] }).map((item) => item.id), ["a", "b"]);
});

test("backend projection shape maps only explicit customer-safe fields", () => {
  const projection = customerDocumentProjection({ document: { type: "invoice", number: "INV-9", revision: 2, state: "issued" }, shop: { legalName: "Legal", tradeName: "Shop" }, unit: { label: "Unit 3", year: 2020, make: "Freightliner", model: "Cascadia" }, lines: [{ id: "a", description: "Labor", quantity: "1", unit: "hr", unitPrice: "100", total: "100.00", internalCost: "1" }], totals: { currency: "USD", subtotal: "100", discountTotal: "0", tax: "8", total: "108" } });
  assert.equal(projection.number, "INV-9");
  assert.equal(projection.revision, "R2");
  assert.equal(projection.shop.name, "Shop");
  assert.equal(projection.unit.name, "Unit 3");
  assert.equal(projection.lines[0].amount, "100.00");
  assert.equal("internalCost" in projection.lines[0], false);
});

test("customer document projection is idempotent for visible revision labels", () => {
  const once = customerDocumentProjection({ document: { revision: 2 } });
  const twice = customerDocumentProjection(once);
  assert.equal(once.revision, "R2");
  assert.equal(twice.revision, "R2");
});
