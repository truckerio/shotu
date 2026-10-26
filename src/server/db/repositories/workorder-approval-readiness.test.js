import assert from "node:assert/strict";
import test from "node:test";
import { assertWorkorderApprovalReadiness } from "./operational-workorders.repo.js";
import { closeWorkorderSchema } from "../../modules/workorders/workorder.schemas.js";

const productId = "11111111-1111-4111-8111-111111111111";

function partPrice(overrides = {}) {
  return {
    selection: "selling_price",
    quantity: "1.000",
    totalPrice: "10.0000",
    currency: "USD",
    ...overrides,
  };
}

function laborPrice(overrides = {}) {
  return {
    productId,
    selection: "selling_price",
    hours: "2.00",
    uomCode: "hr",
    totalPrice: "100.0000",
    currency: "USD",
    ...overrides,
  };
}

function pricing(overrides = {}) {
  return {
    workorder: {
      formData: {
        laborHours: "2",
        laborProduct: { productId, uomCode: "hr" },
        parts: [],
      },
    },
    installedSerializedParts: [],
    aggregatePartUsages: [],
    noStockPartPrices: [],
    laborPrice: laborPrice(),
    ...overrides,
  };
}

function rejectsCode(run, code) {
  assert.throws(run, (error) => error.code === code && error.statusCode === 409);
}

test("close schema contains only the optional approval note", () => {
  assert.deepEqual(closeWorkorderSchema.parse({}), { note: "" });
  assert.deepEqual(closeWorkorderSchema.parse({ note: " Approved " }), { note: "Approved" });
});

test("approval requires valid positive labor with a current price even after a full discount", () => {
  rejectsCode(
    () => assertWorkorderApprovalReadiness(pricing({ laborPrice: null })),
    "WORKORDER_APPROVAL_LABOR_PRICE_REQUIRED",
  );
  for (const laborHours of ["", "0", "-1", "not-a-quantity", "1.5"]) {
    const value = pricing({
      workorder: { formData: {
        laborHours,
        laborProduct: { productId, uomCode: laborHours === "1.5" ? "ea" : "hr" },
        parts: [],
        customerDocumentAdjustments: { discountKind: "percentage", discountValue: "100" },
      } },
      laborPrice: null,
    });
    rejectsCode(() => assertWorkorderApprovalReadiness(value), "WORKORDER_APPROVAL_LABOR_INVALID");
  }
});

test("approval rejects missing, stale and manual actual-part prices", () => {
  const missing = pricing({
    installedSerializedParts: [{ quantity: 1, price: null }],
  });
  rejectsCode(() => assertWorkorderApprovalReadiness(missing), "WORKORDER_APPROVAL_PART_PRICE_REQUIRED");

  const stale = pricing({
    aggregatePartUsages: [{ effectiveQuantity: "2", status: "installed_pending_approval", price: partPrice({ quantity: "1.000" }) }],
  });
  rejectsCode(() => assertWorkorderApprovalReadiness(stale), "WORKORDER_APPROVAL_PART_PRICE_REQUIRED");

  const manual = pricing({
    workorder: {
      formData: {
        laborHours: "2",
        laborProduct: { productId, uomCode: "hr" },
        parts: [{ evidenceId: "22222222-2222-4222-8222-222222222222", partNo: "MANUAL", qty: "1", uomCode: "ea" }],
      },
    },
  });
  rejectsCode(() => assertWorkorderApprovalReadiness(manual), "WORKORDER_APPROVAL_PART_PRICE_REQUIRED");

  for (const qty of ["", "0", "invalid"]) {
    const invalidQuantity = pricing({
      workorder: {
        formData: {
          laborHours: "2",
          laborProduct: { productId, uomCode: "hr" },
          parts: [{ catalogPartId: "33333333-3333-4333-8333-333333333333", partNo: "ACTUAL", qty, uomCode: "ea" }],
        },
      },
    });
    rejectsCode(
      () => assertWorkorderApprovalReadiness(invalidQuantity),
      "WORKORDER_APPROVAL_PART_QUANTITY_INVALID",
    );
  }
});

test("approval accepts explicitly selected zero and independent price sources but rejects mixed currencies", () => {
  const zero = pricing({
    installedSerializedParts: [{ quantity: 1, price: partPrice({ totalPrice: "0.0000" }) }],
    laborPrice: laborPrice({ totalPrice: "0.0000" }),
  });
  assert.equal(assertWorkorderApprovalReadiness(zero).grandTotal, "0.0000");

  const mixedCurrency = pricing({
    installedSerializedParts: [{ quantity: 1, price: partPrice({ currency: "CAD" }) }],
  });
  rejectsCode(() => assertWorkorderApprovalReadiness(mixedCurrency), "WORKORDER_APPROVAL_PRICING_MIXED");

  const mixedBasis = pricing({
    installedSerializedParts: [{ quantity: 1, price: partPrice({ selection: "batch_cost" }) }],
  });
  assert.equal(assertWorkorderApprovalReadiness(mixedBasis).grandTotal, "110.0000");
});

test("approval accepts current labor and exact part prices with a separate customer discount", () => {
  const ready = pricing({
    workorder: { formData: {
      laborHours: "2",
      laborProduct: { productId, uomCode: "hr" },
      parts: [],
      customerDocumentAdjustments: { discountKind: "percentage", discountValue: "100" },
    } },
    installedSerializedParts: [{ quantity: 1, price: partPrice() }],
    aggregatePartUsages: [{
      effectiveQuantity: "2",
      status: "installed_pending_approval",
      price: partPrice({ quantity: "2.000", totalPrice: "30.0000" }),
    }],
  });
  assert.deepEqual(assertWorkorderApprovalReadiness(ready), {
    status: "complete",
    currency: "USD",
    partsTotal: "40.0000",
    laborTotal: "100.0000",
    grandTotal: "140.0000",
    missingCount: 0,
    rowCount: 3,
  });

});
