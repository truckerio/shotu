import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const api = readFileSync(new URL("./customer-estimate-api.js", import.meta.url), "utf8");
const panel = readFileSync(new URL("./WorkorderCustomerDocumentsPanel.jsx", import.meta.url), "utf8");
const detail = readFileSync(new URL("../workorder-detail/WorkorderDetailPage.jsx", import.meta.url), "utf8");

test("Workorder customer documents use only exact server source, fingerprint, and reconciliation evidence", () => {
  assert.match(api, /source: \{ kind: "workorder", id: workorderId, expectedVersion \}/);
  assert.match(api, /expectedFinancialFingerprint: projection\.financialFingerprint/);
  assert.match(api, /expectedReconciliationHash: documentType === "invoice" \? reconciliation\?\.reconciliationHash/);
  assert.doesNotMatch(api, /totalAmount:|taxTotal:|unitPrice:/);
});

test("revised Estimates preserve original document, draft, and predecessor lineage", () => {
  assert.match(api, /documentId: documentType === "estimate" \? predecessor\?\.documentId/);
  assert.match(api, /predecessorRevisionId: documentType === "estimate" \? predecessor\?\.id/);
  assert.match(api, /draftId: documentType === "estimate" \? predecessor\?\.draftId/);
  assert.match(panel, /original Estimate lineage is unavailable/);
});

test("Invoice UI is gated by mechanic done plus server reconciliation and grants view plus customer chat", () => {
  assert.match(panel, /effectiveStatus === "mechanic_done" && reconciliation\?\.invoiceEligible === true/);
  assert.match(panel, /\["view_revision", "customer_chat", \.\.\.\(documentType === "estimate" && summary\?\.approvalRequired === true \? \["respond_revision"\] : \[\]\)\]/);
  assert.match(panel, /Preview final Invoice/);
  assert.match(panel, /Issue final Invoice/);
});

test("informational Estimate revisions never request a response capability", () => {
  assert.match(panel, /summary\?\.approvalRequired === true/);
  assert.match(panel, /documentType === "estimate"/);
  assert.doesNotMatch(panel, /documentType === "invoice" \? \["view_revision", "customer_chat"\] : \["view_revision", "respond_revision", "customer_chat"\]/);
});

test("Office Workorder tools expose the compact customer-document workspace", () => {
  assert.match(detail, /id: "customer-documents"/);
  assert.match(detail, /label: "Customer documents"/);
  assert.match(detail, /<WorkorderCustomerDocumentsPanel/);
});
