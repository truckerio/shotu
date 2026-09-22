import assert from "node:assert/strict";
import test from "node:test";
import { validatePurchaseOrder } from "./purchase-order-validation.js";

const base = { draft: { supplierId: "supplier", currency: "USD", lines: [{ catalogPartId: "part", partNumber: "FILTER", unitPrice: null }] }, query: "", part: null, amount: "1", price: "", placeOrder: true };

test("routine demand orders allow unknown prices and an omitted expected date", () => {
  assert.deepEqual(validatePurchaseOrder(base), []);
});

test("routine and exceptional orders still require a supplier", () => {
  assert.deepEqual(validatePurchaseOrder({ ...base, draft: { ...base.draft, supplierId: "" } }), [{ field: "supplier", message: "Choose a supplier." }]);
});

test("an entered exceptional line still rejects an invalid price", () => {
  assert.equal(validatePurchaseOrder({ ...base, query: "NEW FILTER", price: "bad" }).some((issue) => issue.field === "price"), true);
});

test("a saved demand line rejects invalid price text while preserving blank Unknown", () => {
  assert.deepEqual(validatePurchaseOrder({ ...base, draft: { ...base.draft, lines: [{ ...base.draft.lines[0], unitPrice: "bad" }] } }), [{ field: "lines", message: "Enter a valid unit price for each priced line, or leave it blank as Unknown." }]);
});
