import assert from "node:assert/strict";
import test from "node:test";
import { advanceDetailFinancialScope, detailDiscountIntent, detailDiscountIntentForSummary, detailDiscountRevisionRequired, detailFinancialSourceDirty, passiveFinancialErrorMessage } from "./detail-financial-state.js";

test("passive totals omit document setup helpers but retain pricing and connection errors", () => {
  assert.equal(passiveFinancialErrorMessage({ code: "CUSTOMER_DOCUMENT_EMPTY_ESTIMATE", message: "Add priced labor or parts before previewing an Estimate." }), "");
  assert.equal(passiveFinancialErrorMessage({ code: "CUSTOMER_DOCUMENT_PROFILE_UNAVAILABLE", message: "Publish a commercial profile before issuing a priced Estimate." }), "");
  assert.equal(passiveFinancialErrorMessage({ code: "CUSTOMER_DOCUMENT_PROFILE_STALE", message: "Refresh the commercial profile before continuing." }), "");
  assert.equal(passiveFinancialErrorMessage({ code: "CUSTOMER_DOCUMENT_PRICE_MISSING", message: "A recorded part needs a price." }), "A recorded part needs a price.");
  assert.equal(passiveFinancialErrorMessage(new Error("Connection failed.")), "Connection failed.");
  assert.equal(passiveFinancialErrorMessage(null), "Current charges could not be calculated.");
});

const fixed = { kind: "fixed", value: "45", reason: "Courtesy" };
const percentage = { kind: "percentage", value: "14", reason: "Courtesy" };
const intent = (documentDiscount) => ({ lineDiscounts: [], documentDiscount, overrideReasons: [] });

test("scope generations reject an old request even after navigating A to B to A", () => {
  const first = advanceDetailFinancialScope(null, "A");
  assert.equal(advanceDetailFinancialScope(first, "A"), first);
  const second = advanceDetailFinancialScope(first, "B");
  const third = advanceDetailFinancialScope(second, "A");
  assert.notEqual(first.generation, third.generation);
  assert.notEqual(second.generation, third.generation);
});

test("location changes invalidate the current tax source immediately", () => {
  assert.equal(detailFinancialSourceDirty({ locationId: "new" }, { locationId: "old" }), true);
});

test("an invoice-ready Workorder requires a revised Estimate after a discount edit", () => {
  const summary = { status: "mechanic_done", documents: { estimate: { id: "accepted", snapshot: { discountEvidence: { documentDiscount: fixed } } } }, reconciliation: { invoiceEligible: true, acceptedEstimateRevisionId: "accepted" } };
  assert.equal(detailDiscountRevisionRequired(intent(fixed), summary), false);
  assert.equal(detailDiscountRevisionRequired(intent({ ...fixed, value: "45.00" }), summary), false);
  assert.equal(detailDiscountRevisionRequired(intent(percentage), summary), true);
  assert.equal(detailDiscountRevisionRequired(intent(null), summary), true);
  const pending = { ...summary, documents: { estimate: { ...summary.documents.estimate, id: "new-revision" } } };
  assert.equal(detailDiscountRevisionRequired(intent(fixed), pending), true);
});

test("unissued saved intent survives reload, including removing an existing discount", () => {
  const estimate = { id: "revision-a", snapshot: { discountEvidence: { documentDiscount: percentage } } };
  assert.deepEqual(detailDiscountIntent({ customerDocumentAdjustments: intent(fixed), customerDocumentAdjustmentBaseRevisionId: estimate.id }, estimate), intent(fixed));
  assert.deepEqual(detailDiscountIntent({ customerDocumentAdjustments: intent(null), customerDocumentAdjustmentBaseRevisionId: estimate.id }, estimate), intent(null));
  assert.deepEqual(detailDiscountIntent({ customerDocumentAdjustments: intent(fixed) }), intent(fixed));
});

test("a newer issued revision wins over older draft intent", () => {
  const estimate = { id: "revision-b", snapshot: { discountEvidence: { documentDiscount: percentage } } };
  assert.deepEqual(detailDiscountIntent({ customerDocumentAdjustments: intent(fixed), customerDocumentAdjustmentBaseRevisionId: "revision-a" }, estimate), intent(percentage));
  assert.deepEqual(detailDiscountIntent({}, estimate), intent(percentage));
  assert.deepEqual(detailDiscountIntentForSummary({ customerDocumentAdjustments: intent(fixed), customerDocumentAdjustmentBaseRevisionId: "revision-a" }, { documents: { estimate } }), intent(percentage));
});

test("an issued Invoice owns the discount even when saved intent and latest Estimate differ", () => {
  const summary = { documents: { invoice: { snapshot: { discountEvidence: { documentDiscount: fixed } } }, estimate: { snapshot: { discountEvidence: { documentDiscount: percentage } } } } };
  assert.deepEqual(detailDiscountIntentForSummary({ customerDocumentAdjustments: intent(null) }, summary), intent(fixed));
});

test("hydrated blank rows, numeric quantities and transient UI state do not mark charges dirty", () => {
  const saved = { laborHours: 2, parts: [{ partNo: "FILTER", qty: 1, uomCode: "pc", repairOrder: "Replace" }] };
  const form = { ...saved, laborHours: "2", parts: [{ ...saved.parts[0], qty: "1", searchOpen: true }, { partNo: "", qty: "", uomCode: "pc", repairOrder: "" }] };
  assert.equal(detailFinancialSourceDirty(form, saved), false);
  for (const patch of [{ laborHours: "3" }, { laborProduct: { productId: "different", uomCode: "ea" } }, { mechanicConcern: "New scope" }, { workPerformed: "New repair" }, { parts: [{ ...saved.parts[0], qty: "2" }] }]) {
    assert.equal(detailFinancialSourceDirty({ ...form, ...patch }, saved), true);
  }
  assert.equal(detailFinancialSourceDirty({ ...form, customerDocumentAdjustments: intent(fixed) }, saved), false);
});
