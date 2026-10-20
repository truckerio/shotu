import assert from "node:assert/strict";
import test from "node:test";
import { invoiceDocumentChoices, invoiceDocumentState, invoiceField, invoiceNumber, invoiceQuantity, preferredInvoiceChoice } from "./inbound-invoice-document-model.js";

test("missing bill values remain absent while zero and credit amounts remain visible", () => {
  for (const value of [undefined, null, ""]) {
    assert.equal(invoiceField({ value }), null);
    assert.equal(invoiceNumber(value), "Not read");
    assert.equal(invoiceQuantity(value), "Not read");
  }
  assert.equal(invoiceField({ value: 0 }), 0);
  assert.equal(invoiceNumber(0), "0.00");
  assert.equal(invoiceNumber(-12.5), "-12.50");
  assert.equal(invoiceQuantity(-2), "-2");
  assert.equal(invoiceField(undefined), null);
});

test("bill choices retain separate documents and deduplicate the same allocated run", () => {
  const item = { id: "po", poId: "po", invoiceRunId: "run-a" };
  const choices = invoiceDocumentChoices(item, {
    items: [{ id: "bill-a", file_name: "one.pdf", invoiceRunId: "run-a" }, { id: "bill-b", file_name: "two.pdf", invoiceRunId: "run-b" }],
    linkedInvoices: [{ invoiceRunId: "run-a", fileName: "one.pdf" }, { invoiceRunId: "run-c", fileName: "three.pdf" }],
  });
  assert.equal(choices.length, 3);
  assert.deepEqual(choices.map((entry) => entry.invoiceRunId), ["run-a", "run-b", "run-c"]);
  assert.equal(choices[0].sourceUrl, "/api/office/inventory/purchasing/po/bills/bill-a");
  assert.equal(preferredInvoiceChoice(choices, item, "bill:bill-b").invoiceRunId, "run-b");
});

test("exact delivery invoice is selected ahead of the PO aggregate invoice", () => {
  const item = { poId: "po", invoiceRunId: "aggregate-run", selectedDelivery: { invoiceRunId: "exact-run" } };
  const choices = invoiceDocumentChoices(item, { items: [{ id: "bill", file_name: "aggregate.pdf", invoiceRunId: "aggregate-run" }] });
  assert.equal(preferredInvoiceChoice(choices, item).invoiceRunId, "exact-run");
  assert.equal(preferredInvoiceChoice(choices, item, "bill:bill").invoiceRunId, "aggregate-run");
});

test("a legacy attachment has an explicit preparable identity without a guessed run", () => {
  const choices = invoiceDocumentChoices({ poId: "po", poNumber: "PO-123", supplier: "Supplier" }, { items: [{ id: "legacy", file_name: "PO-123.pdf" }] });
  assert.equal(choices[0].billId, "legacy");
  assert.equal(choices[0].invoiceRunId, "");
  assert.equal(invoiceDocumentChoices({ poId: "po", invoiceNumber: "INV-123" }).length, 0);
});

test("an exact delivery uses the latest reading of its bill instead of an older reviewed alias", () => {
  const item = { poId: "po", invoiceRunId: "old-reviewed", selectedDelivery: { invoiceRunId: "old-reviewed" } };
  const choices = invoiceDocumentChoices(item, {
    items: [{ id: "bill", file_name: "invoice.pdf", invoiceRunId: "new-failed", sourceRunIds: ["new-failed", "old-reviewed"] }],
    linkedInvoices: [{ invoiceRunId: "new-failed", sourceRunIds: ["new-failed", "old-reviewed"] }],
  });
  assert.equal(choices.length, 1);
  assert.equal(preferredInvoiceChoice(choices, item).invoiceRunId, "new-failed");
  assert.equal(preferredInvoiceChoice(choices, item, "run:old-reviewed").invoiceRunId, "new-failed");
});

test("generic allocated sources resolve historical aliases without merging unrelated bills", () => {
  const item = { poId: "po", invoiceRunId: "old", selectedDelivery: { invoiceRunId: "old" } };
  const choices = invoiceDocumentChoices(item, {
    linkedInvoices: [{ invoiceRunId: "unrelated" }, { invoiceRunId: "latest", sourceRunIds: ["latest", "old"] }],
  });
  assert.equal(choices.length, 2);
  assert.equal(preferredInvoiceChoice(choices, item).invoiceRunId, "latest");
});

test("a newer linked reading reconciles a concurrent older attachment read as one bill", () => {
  const item = { poId: "po", selectedDelivery: { invoiceRunId: "old" } };
  const choices = invoiceDocumentChoices(item, {
    items: [{ id: "bill", file_name: "invoice.pdf", invoiceRunId: "old", sourceRunIds: ["old"] }],
    linkedInvoices: [{ invoiceRunId: "new", sourceRunIds: ["new", "old"] }],
  });
  assert.equal(choices.length, 1);
  assert.equal(choices[0].billId, "bill");
  assert.equal(preferredInvoiceChoice(choices, item).invoiceRunId, "new");
});

test("new processing and failed attempts do not display an older or partial draft as ready", () => {
  assert.equal(invoiceDocumentState({ status: "processing", draft: { total: { value: 100 } } }), "processing");
  assert.equal(invoiceDocumentState({ status: "failed", draft: { total: { value: 100 } } }), "failed");
  assert.equal(invoiceDocumentState({ status: "completed", draft: null }), "empty");
  assert.equal(invoiceDocumentState({ status: "reviewed", draft: { lines: [] } }), "ready");
});
