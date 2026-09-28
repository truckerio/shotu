import assert from "node:assert/strict";
import test from "node:test";
import { formatWorkorderMoney, workorderLineTotal, workorderPricingPresentation } from "./workorder-pricing-model.js";

test("line pricing accepts an explicit zero but never treats an absent price as zero", () => {
  assert.equal(workorderLineTotal({ selection: "selling_price", unitPrice: "0", currency: "USD" }, "2"), "$0.00");
  assert.equal(workorderLineTotal({ selection: "selling_price", unitPrice: null, currency: "USD" }, "2"), null);
  assert.equal(workorderLineTotal({ selection: "selling_price", unitPrice: "7.5", currency: "USD" }, ""), null);
  assert.equal(workorderLineTotal({ unitPrice: "7.5", currency: "USD" }, "2"), null);
  assert.equal(workorderLineTotal({ selection: "selling_price", totalPrice: "18.5", unitPrice: "7.5", currency: "USD" }, "2"), "$18.50");
  assert.equal(workorderLineTotal({ selection: "selling_price", quantity: "2", totalPrice: "18.5", unitPrice: "7.5", currency: "USD" }, "3"), null);
  assert.equal(workorderLineTotal({ selection: "selling_price", quantity: "2.00", totalPrice: "18.5", unitPrice: "7.5", currency: "USD" }, "2"), "$18.50");
});

test("workorder totals appear only with a complete, single-currency server summary", () => {
  const amounts = { currency: "USD", partsTotal: "12.5", laborTotal: "15", grandTotal: "27.5" };
  assert.deepEqual(workorderPricingPresentation({ status: "complete", ...amounts }), {
    status: "complete", parts: "$12.50", labor: "$15.00", grand: "$27.50",
  });
  assert.equal(workorderPricingPresentation({ status: "incomplete", ...amounts, missingCount: 2 }).status, "incomplete");
  assert.equal(workorderPricingPresentation({ status: "complete", ...amounts, grandTotal: null }).status, "incomplete");
  assert.equal(workorderPricingPresentation({ status: "mixed_currency", ...amounts }).status, "mixed_currency");
  assert.equal(formatWorkorderMoney(null, "USD"), null);
});
