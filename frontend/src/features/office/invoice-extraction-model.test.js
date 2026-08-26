import assert from "node:assert/strict";
import test from "node:test";
import {
  addBlankInvoiceLine,
  confidenceState,
  invoiceFieldNeedsReview,
  invoiceReviewErrorMessage,
  parseReviewNumber,
  removeInvoiceLine,
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

test("invoice selection validates every file and caps a batch at ten", () => {
  const acceptedTypes = new Set(["image/png", "application/pdf"]);
  const valid = { name: "invoice.pdf", type: "application/pdf", size: 100 };
  assert.deepEqual(validateInvoiceSelection([valid], { acceptedTypes, maxBytes: 1_000 }), { files: [valid], error: "" });
  assert.match(validateInvoiceSelection(Array(11).fill(valid), { acceptedTypes, maxBytes: 1_000 }).error, /no more than 10/i);
  assert.match(validateInvoiceSelection([{ ...valid, name: "invoice.txt", type: "text/plain" }], { acceptedTypes, maxBytes: 1_000 }).error, /not a PNG/i);
  assert.match(validateInvoiceSelection([{ ...valid, size: 0 }], { acceptedTypes, maxBytes: 1_000 }).error, /empty/i);
  assert.match(validateInvoiceSelection([{ ...valid, size: 1_001 }], { acceptedTypes, maxBytes: 1_000 }).error, /smaller than 10 MB/i);
});
