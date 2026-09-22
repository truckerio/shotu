import assert from "node:assert/strict";
import test from "node:test";
import {
  addBlankInvoiceLine,
  confidenceState,
  invoiceFieldNeedsReview,
  invoiceDeliveryFullyReceived,
  invoiceLineNeedsReview,
  invoiceReviewErrorMessage,
  invoicePostingPayload,
  invoicePostingSelectionReady,
  initialInvoicePostingSelection,
  nextReviewableBatchIndex,
  nextInvoiceLineIdAfterRemoval,
  orderInvoiceLinesForReview,
  orderInvoiceReviewSections,
  firstInvoiceLineId,
  parseReviewNumber,
  removeInvoiceLine,
  shouldConfirmInvoiceReviewLeave,
  suggestedAllocationPlan,
  updateInvoiceField,
  updateInvoiceLineField,
  validateInvoiceSelection,
} from "./invoice-extraction-model.js";

const field = (value, confidence = 50) => ({ value, confidence, evidence: "AI evidence" });
const draft = { vendorName: field("Fleet Pride"), lines: [{ id: "line-1", partNumber: field("LF-9009") }] };

test("human field edits become explicit 100-confidence reviewed evidence", () => {
  assert.deepEqual(updateInvoiceField(draft, "vendorName", "FleetPride").vendorName, {
    value: "FleetPride", confidence: 100, evidence: "Reviewed by user.",
  });
  assert.equal(updateInvoiceLineField(draft, "line-1", "partNumber", "LF9009").lines[0].partNumber.value, "LF9009");
});

test("review model preserves low-confidence text, nullable numbers, and stable line removal", () => {
  assert.equal(confidenceState(89), "Review");
  assert.equal(confidenceState(90), "Confident");
  assert.equal(parseReviewNumber(""), null);
  assert.equal(parseReviewNumber("12.5"), 12.5);
  assert.equal(removeInvoiceLine(draft, "line-1").lines.length, 0);
  const added = addBlankInvoiceLine(draft, "manual-1");
  assert.equal(added.lines[1].id, "manual-1");
  assert.equal(added.lines[1].partNumber.confidence, 0);
  assert.match(added.lines[1].partNumber.evidence, /enter a value/i);
});

test("blank optional invoice fields do not create false review work", () => {
  assert.equal(invoiceFieldNeedsReview(field("", 0), { optional: true }), false);
  assert.equal(invoiceFieldNeedsReview(field("PO-9", 20), { optional: true }), true);
  assert.equal(invoiceFieldNeedsReview(field("", 0)), true);
});

test("invoice review orders unresolved lines first and keeps selection keyed by line id", () => {
  const confident = { id: "ready", partNumber: field("A", 100), description: field("Ready", 100), quantity: field(1, 100), unitOfMeasure: field("ea", 100), unitPrice: field(2, 100), lineTotal: field(2, 100) };
  const unresolved = { ...confident, id: "review", description: field("Check me", 40) };
  assert.equal(invoiceLineNeedsReview(confident), false);
  assert.equal(invoiceLineNeedsReview(unresolved), true);
  assert.deepEqual(orderInvoiceLinesForReview([confident, unresolved]).map((line) => line.id), ["review", "ready"]);
  assert.equal(firstInvoiceLineId([confident, unresolved]), "review");
  assert.equal(firstInvoiceLineId([confident]), "");
  assert.equal(nextInvoiceLineIdAfterRemoval([confident, unresolved], "ready"), "review");
  assert.equal(nextInvoiceLineIdAfterRemoval([confident, unresolved], "review"), "ready");
});

test("invoice review sections put unresolved work first without changing peer order", () => {
  const sections = [
    { id: "details", unresolved: false },
    { id: "items", unresolved: true },
    { id: "totals", unresolved: true },
    { id: "delivery", unresolved: false },
  ];
  assert.deepEqual(orderInvoiceReviewSections(sections).map((section) => section.id), ["items", "totals", "details", "delivery"]);
});

test("a posted partial receipt does not complete delivery while zero outstanding does", () => {
  const postedReceipt = { status: "posted" };
  assert.equal(invoiceDeliveryFullyReceived({ receipt: postedReceipt, suggestion: { receiptLines: [{ invoiceOutstandingQuantity: 2 }] } }), false);
  assert.equal(invoiceDeliveryFullyReceived({ receipt: postedReceipt, suggestion: { receiptLines: [{ invoiceOutstandingQuantity: 0 }] } }), true);
  assert.equal(invoiceDeliveryFullyReceived({ receipt: null, suggestion: { reason: "invoice_fully_received" } }), true);
});

test("review validation exposes the actionable server issue", () => {
  const error = new Error("Invalid invoice extraction request.");
  error.code = "validation_error";
  error.details = { issues: [
    { message: "Enter a non-zero quantity for every invoice line." },
    { message: "Enter a part number or description for every invoice line." },
  ] };
  assert.equal(invoiceReviewErrorMessage(error), "Enter a non-zero quantity for every invoice line. Enter a part number or description for every invoice line.");
  assert.equal(invoiceReviewErrorMessage(new Error("Network unavailable")), "Network unavailable");
});

test("invoice review asks before discarding only unsaved editable changes", () => {
  assert.equal(shouldConfirmInvoiceReviewLeave({ dirty: true, status: "needs_review" }), true);
  assert.equal(shouldConfirmInvoiceReviewLeave({ dirty: false, status: "needs_review" }), false);
  assert.equal(shouldConfirmInvoiceReviewLeave({ dirty: true, status: "reviewed" }), false);
});

test("invoice selection validates every file and caps a batch at ten", () => {
  const acceptedTypes = new Set(["image/png", "application/pdf"]);
  const valid = { name: "invoice.pdf", type: "application/pdf", size: 100 };
  assert.deepEqual(validateInvoiceSelection([valid], { acceptedTypes, maxBytes: 1_000 }), { files: [valid], error: "" });
  assert.match(validateInvoiceSelection(Array(11).fill(valid), { acceptedTypes, maxBytes: 1_000 }).error, /no more than 10/i);
  assert.match(validateInvoiceSelection([{ ...valid, name: "invoice.txt", type: "text/plain" }], { acceptedTypes, maxBytes: 1_000 }).error, /not a PNG/i);
  assert.match(validateInvoiceSelection([{ ...valid, size: 0 }], { acceptedTypes, maxBytes: 1_000 }).error, /empty/i);
  assert.match(validateInvoiceSelection([{ ...valid, size: 1_001 }], { acceptedTypes, maxBytes: 1_000 }).error, /smaller than 10 MB/i);
});

test("batch review advances to the next ready unreviewed invoice and wraps around", () => {
  const entries = [
    { run: { status: "reviewed", draft: {} } },
    { run: { status: "processing", draft: null } },
    { run: { status: "needs_review", draft: {} } },
    { run: { status: "completed", draft: {} }, error: "stale failure" },
    { run: { status: "completed", draft: {} } },
  ];
  assert.equal(nextReviewableBatchIndex(entries, 0), 2);
  assert.equal(nextReviewableBatchIndex(entries, 2), 4);
  assert.equal(nextReviewableBatchIndex(entries, 4), 2);
  assert.equal(nextReviewableBatchIndex(entries.map((entry) => ({ ...entry, run: { ...entry.run, status: "reviewed" } })), 0), -1);
});

test("a true no-PO invoice defaults to the direct route but extracted PO evidence never does", () => {
  const noPo = { kind: "none", reason: "no_purchase_order", version: 3 };
  assert.equal(initialInvoicePostingSelection(noPo, { purchaseOrderNumber: field("") }).postingRoute, "no_purchase_order");
  assert.equal(initialInvoicePostingSelection(noPo, { purchaseOrderNumber: field("PO-42") }).postingRoute, "");
  assert.equal(initialInvoicePostingSelection({ kind: "ambiguous" }, { purchaseOrderNumber: field("") }).postingRoute, "");
});

test("exact PO suggestions become a bounded allocation only after explicit selection", () => {
  const suggestion = { kind: "suggestions", candidates: [
    { invoiceLineIndex: 0, purchaseLineId: "line-1", quantity: "2", candidate: { number: "PO-42" } },
    { invoiceLineIndex: 1, purchaseLineId: "line-2", quantity: 1, candidate: { number: "PO-42" } },
  ] };
  const plan = suggestedAllocationPlan(suggestion);
  assert.deepEqual(plan, [
    { invoiceLineIndex: 0, purchaseLineId: "line-1", quantity: 2 },
    { invoiceLineIndex: 1, purchaseLineId: "line-2", quantity: 1 },
  ]);
  assert.equal(invoicePostingSelectionReady({ postingRoute: "", allocationPlan: [] }, suggestion, draft), false);
  assert.equal(invoicePostingSelectionReady({ postingRoute: "purchase_order", allocationPlan: plan }, suggestion, draft), true);
});

test("every no-PO receipt requires a concise explanation", () => {
  const suggestion = { kind: "none", reason: "no_exact_match" };
  assert.equal(invoicePostingSelectionReady({ postingRoute: "no_purchase_order", allocationPlan: [], noPurchaseOrderReason: "" }, suggestion, { purchaseOrderNumber: field("PO-42") }), false);
  assert.equal(invoicePostingSelectionReady({ postingRoute: "no_purchase_order", allocationPlan: [], noPurchaseOrderReason: "" }, suggestion, { purchaseOrderNumber: field("") }), false);
  const selection = { postingRoute: "no_purchase_order", allocationPlan: [], noPurchaseOrderReason: "Vendor invoice references the wrong PO." };
  assert.equal(invoicePostingSelectionReady(selection, suggestion, { purchaseOrderNumber: field("PO-42") }), true);
  assert.equal(invoicePostingSelectionReady({ ...selection, noPurchaseOrderReason: "Direct supplier purchase." }, suggestion, { purchaseOrderNumber: field("") }), true);
  assert.deepEqual(invoicePostingPayload(selection), selection);
  assert.deepEqual(invoicePostingPayload({ postingRoute: "purchase_order", allocationPlan: [{ invoiceLineIndex: 0 }], noPurchaseOrderReason: "ignored" }), { postingRoute: "purchase_order", allocationPlan: [{ invoiceLineIndex: 0 }], noPurchaseOrderReason: "" });
});
