import assert from "node:assert/strict";
import test from "node:test";
import { calculateInventoryPricingPreview, inventoryCurrencyMinorDigits, isSupportedInventoryCurrency } from "./inventory-pricing.js";

test("official ISO currency metadata validates supported codes and 0, 2, 3 and 4 digit precision", () => {
  assert.equal(inventoryCurrencyMinorDigits("JPY"), 0);
  assert.equal(inventoryCurrencyMinorDigits("USD"), 2);
  assert.equal(inventoryCurrencyMinorDigits("KWD"), 3);
  assert.equal(inventoryCurrencyMinorDigits("CLF"), 4);
  assert.equal(inventoryCurrencyMinorDigits("UYI"), 0);
  assert.equal(isSupportedInventoryCurrency("XXX"), false);
  assert.equal(isSupportedInventoryCurrency("XTS"), false);
  assert.equal(isSupportedInventoryCurrency("BGN"), false);
});
test("exclusive preview rounds subtotal and discount first and compounds from prior rounded tax", () => {
  const result = calculateInventoryPricingPreview({
    amount: "10", currency: "USD", quantity: "2", discountPercent: "10", taxTreatment: "exclusive",
    components: [{ name: "Local", rate: "5", compound: false }, { name: "Federal", rate: "10", compound: true }],
  });
  assert.deepEqual({ subtotal: result.subtotal, discount: result.discountAmount, net: result.net, taxes: result.components.map((entry) => entry.tax), tax: result.tax, total: result.total },
    { subtotal: "20.00", discount: "2.00", net: "18.00", taxes: ["0.90", "1.89"], tax: "2.79", total: "20.79" });
});

test("inclusive compound allocation preserves gross exactly, including tiny multi-component amounts", () => {
  const result = calculateInventoryPricingPreview({
    amount: "18", currency: "USD", quantity: "1", discountPercent: "0", taxTreatment: "inclusive",
    components: [{ name: "Local", rate: "5", compound: false }, { name: "Federal", rate: "10", compound: true }],
  });
  const cents = (value) => BigInt(value.replace(".", ""));
  assert.equal(cents(result.net) + result.components.reduce((sum, entry) => sum + cents(entry.tax), 0n), cents(result.total));
  assert.equal(result.total, "18.00");

  const tiny = calculateInventoryPricingPreview({
    amount: "0.01", currency: "USD", quantity: "1", taxTreatment: "inclusive", discountPercent: "0",
    components: Array.from({ length: 5 }, (_, index) => ({ name: `Tax ${index}`, rate: "100", compound: index > 0 })),
  });
  const pieces = [tiny.net, ...tiny.components.map((entry) => entry.tax)].map(cents);
  assert.equal(pieces.every((value) => value >= 0n), true);
  assert.equal(pieces.reduce((sum, value) => sum + value, 0n), 1n);
  assert.equal(cents(tiny.tax) <= cents(tiny.total), true);
});

test("currency minor-unit HALF_UP rules and explicit non-tax treatments are deterministic", () => {
  const jpy = calculateInventoryPricingPreview({ amount: "100.5", currency: "JPY", quantity: "1", discountPercent: "0", taxTreatment: "zero_rated" });
  const usd = calculateInventoryPricingPreview({ amount: "1.005", currency: "USD", quantity: "1", discountPercent: "0", taxTreatment: "exempt" });
  const kwd = calculateInventoryPricingPreview({ amount: "1.2345", currency: "KWD", quantity: "1", discountPercent: "0", taxTreatment: "out_of_scope" });
  assert.deepEqual([jpy.subtotal, usd.subtotal, kwd.subtotal], ["101", "1.01", "1.235"]);
  assert.deepEqual([jpy.net, jpy.tax, jpy.total], ["101", "0", "101"]);
});

test("unknown tax treatment does not fabricate a before-tax amount or total", () => {
  const result = calculateInventoryPricingPreview({ amount: "10", currency: "USD", quantity: "2", discountPercent: "10", taxTreatment: "not_configured" });
  assert.equal(result.subtotal, "20.00");
  assert.equal(result.discountAmount, "2.00");
  assert.equal(result.net, null);
  assert.equal(result.tax, null);
  assert.equal(result.total, null);
  assert.deepEqual(result.blockers, ["tax_treatment_required"]);
});
