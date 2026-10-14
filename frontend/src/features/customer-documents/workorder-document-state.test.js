import assert from "node:assert/strict";
import test from "node:test";
import { shouldReviewInvoice } from "./workorder-document-state.js";

test("only completed, server-reconciled work opens an unissued invoice", () => {
  const ready = { status: "mechanic_done", reconciliation: { invoiceEligible: true }, documents: {} };
  assert.equal(shouldReviewInvoice(ready), true);
  assert.equal(shouldReviewInvoice({ ...ready, status: "in_progress" }), false);
  assert.equal(shouldReviewInvoice({ ...ready, reconciliation: { invoiceEligible: false } }), false);
  assert.equal(shouldReviewInvoice({ ...ready, reconciliation: { invoiceEligible: "true" } }), false);
  assert.equal(shouldReviewInvoice({ ...ready, documents: { invoice: { id: "issued" } } }), false);
  assert.equal(shouldReviewInvoice(null), false);
});
