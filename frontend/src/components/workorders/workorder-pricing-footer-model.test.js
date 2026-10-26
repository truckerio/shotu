import assert from "node:assert/strict";
import test from "node:test";
import { workorderPricingFooterPresentation } from "./workorder-pricing-footer-model.js";

const pricing = {
  status: "complete",
  currency: "USD",
  partsTotal: "25",
  laborTotal: "75",
  grandTotal: "100",
};

test("raw server pricing fills only Parts & labor until a current projection exists", () => {
  assert.deepEqual(workorderPricingFooterPresentation(pricing), {
    partsLabor: "$100.00",
    discount: "—",
    tax: "—",
    total: "—",
    hasProjection: false,
    hasRawPartsLabor: true,
    message: "",
  });
});

test("a fingerprinted server projection owns all customer-facing financial totals", () => {
  assert.deepEqual(workorderPricingFooterPresentation(pricing, {
    financialFingerprint: "current",
    currency: "USD",
    subtotal: "100",
    discount: "10",
    tax: "7.2",
    total: "97.2",
  }), {
    partsLabor: "$100.00",
    discount: "$10.00",
    tax: "$7.20",
    total: "$97.20",
    hasProjection: true,
    hasRawPartsLabor: true,
    message: "",
  });
});

test("stale and incomplete summaries fail closed while a complete mixed-source summary displays", () => {
  const staleProjection = { currency: "USD", subtotal: "9", discount: "1", tax: "1", total: "9" };
  const incomplete = workorderPricingFooterPresentation({ status: "incomplete", currency: "USD", grandTotal: "100", missingCount: 1 }, staleProjection);
  assert.equal(incomplete.partsLabor, "—");
  assert.equal(incomplete.total, "—");
  assert.equal(incomplete.message, "");

  const mixedBasis = workorderPricingFooterPresentation({ ...pricing, reason: "mixed_price_basis" });
  assert.equal(mixedBasis.partsLabor, "$100.00");
  assert.equal(mixedBasis.hasRawPartsLabor, true);
});

test("messages are caller-controlled and do not reinterpret server pricing status", () => {
  assert.equal(workorderPricingFooterPresentation({ status: "incomplete", missingCount: 2 }, null, "Updating prices…").message, "Updating prices…");
  assert.equal(workorderPricingFooterPresentation({ status: "incomplete", missingCount: 2 }).message, "");
});
