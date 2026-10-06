import assert from "node:assert/strict";
import test from "node:test";
import { calculateCustomerFinancials, canonicalFinancialHash, canonicalJson } from "./customer-financial-calculator.js";

const line = (overrides = {}) => ({
  id: "labor-1",
  type: "labor",
  description: "Diagnosis",
  quantity: "2.5",
  unit: "hr",
  unitPrice: "100",
  priceBasis: "selling_price",
  taxCategory: "labor",
  taxTreatment: "exclusive",
  taxComponents: [{ name: "Sales tax", rate: "10", compound: false }],
  discountEligible: true,
  lineDiscount: null,
  source: { kind: "labor_snapshot", id: "labor-source-1" },
  ...overrides,
});

test("calculator applies line then deterministic document discount before line tax", () => {
  const result = calculateCustomerFinancials({
    currency: "USD",
    basis: "estimated",
    lines: [
      line({ id: "b", quantity: "1", unitPrice: "60", lineDiscount: { kind: "fixed", value: "10", reason: "Courtesy" } }),
      line({ id: "a", type: "part", quantity: "1", unit: "ea", unitPrice: "50", source: { kind: "part_snapshot", id: "part-1" } }),
    ],
    documentDiscount: { kind: "fixed", value: "10.01", reason: "Fleet account" },
  });
  assert.deepEqual(result.lines.map((entry) => [entry.id, entry.documentDiscountAllocation]), [["b", "5.00"], ["a", "5.01"]]);
  assert.deepEqual(result.summary, {
    currency: "USD", minorDigits: 2, subtotal: "110.00", lineDiscount: "10.00",
    documentDiscount: "10.01", discountTotal: "20.01", net: "89.99", tax: "9.00", total: "98.99",
  });
});

test("calculator supports inclusive compound tax, credits, exempt lines, and four-digit currencies", () => {
  const inclusive = calculateCustomerFinancials({
    currency: "CLF",
    basis: "actual",
    lines: [
      line({ id: "part", type: "part", quantity: "1", unit: "ea", unitPrice: "115.5", taxTreatment: "inclusive",
        taxComponents: [{ name: "Local", rate: "5", compound: false }, { name: "Federal", rate: "10", compound: true }],
        source: { kind: "inventory_usage", id: "usage-1" } }),
      line({ id: "credit", type: "credit", quantity: "1", unit: "ea", unitPrice: "5.5", taxTreatment: "out_of_scope",
        taxComponents: [], discountEligible: false, source: { kind: "credit", id: "credit-1" } }),
    ],
    documentDiscount: null,
  });
  assert.equal(inclusive.summary.subtotal, "110.0000");
  assert.equal(inclusive.summary.total, "110.0000");
  assert.equal(inclusive.lines[1].total, "-5.5000");
  assert.equal(Number(inclusive.lines[0].net) + Number(inclusive.lines[0].tax), 115.5);
});

test("calculator rejects internal bases, unknown tax, duplicate IDs, mixed client currency, and excessive discounts", () => {
  assert.throws(() => calculateCustomerFinancials({ currency: "USD", basis: "estimated", lines: [line({ priceBasis: "internal_cost" })] }));
  assert.throws(() => calculateCustomerFinancials({ currency: "USD", basis: "estimated", lines: [line({ taxTreatment: "not_configured", taxComponents: [] })] }), /explicit tax treatment/i);
  assert.throws(() => calculateCustomerFinancials({ currency: "USD", basis: "estimated", lines: [line(), line()] }), /line IDs must be unique/i);
  assert.throws(() => calculateCustomerFinancials({ currency: "USD", basis: "estimated", lines: [line()], documentDiscount: { kind: "fixed", value: "999", reason: "Invalid" } }), /cannot exceed/i);
  assert.throws(() => calculateCustomerFinancials({ currency: "XXX", basis: "estimated", lines: [line()] }), /Unsupported currency/i);
});

test("canonical serialization and hash do not depend on object key insertion order", () => {
  assert.equal(canonicalJson({ b: 2, a: { d: 4, c: 3 } }), canonicalJson({ a: { c: 3, d: 4 }, b: 2 }));
  assert.equal(canonicalFinancialHash({ b: 2, a: 1 }), canonicalFinancialHash({ a: 1, b: 2 }));
});

test("zero-minor currency rounding is half-up and percentage discounts stay exact", () => {
  const result = calculateCustomerFinancials({
    currency: "JPY",
    basis: "estimated",
    lines: [line({ quantity: "1", unitPrice: "100.5", taxTreatment: "exempt", taxComponents: [],
      lineDiscount: { kind: "percentage", value: "10", reason: "Promotion" } })],
  });
  assert.deepEqual(result.summary, {
    currency: "JPY", minorDigits: 0, subtotal: "101", lineDiscount: "10", documentDiscount: "0",
    discountTotal: "10", net: "91", tax: "0", total: "91",
  });
});
