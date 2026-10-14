import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const api = readFileSync(new URL("./customer-estimate-api.js", import.meta.url), "utf8");
const panel = readFileSync(new URL("./WorkorderCustomerDocumentsPanel.jsx", import.meta.url), "utf8")
  + readFileSync(new URL("./useWorkorderCustomerDocuments.js", import.meta.url), "utf8");
const detail = readFileSync(new URL("../workorder-detail/WorkorderDetailPage.jsx", import.meta.url), "utf8");

test("the revised Estimate review binds its immutable predecessor projection", () => {
  const component = readFileSync(new URL("./WorkorderCustomerDocumentsPanel.jsx", import.meta.url), "utf8");
  assert.match(component, /import \{ revisionProjection, useWorkorderCustomerDocuments \} from "\.\/useWorkorderCustomerDocuments\.js"/);
  assert.match(component, /revisionProjection\(estimate\)/);
});

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
  assert.match(panel, /Review Invoice/);
  assert.match(panel, /Issue final Invoice/);
});

test("informational Estimate revisions never request a response capability", () => {
  assert.match(panel, /summary\?\.approvalRequired === true/);
  assert.match(panel, /documentType === "estimate"/);
  assert.doesNotMatch(panel, /documentType === "invoice" \? \["view_revision", "customer_chat"\] : \["view_revision", "respond_revision", "customer_chat"\]/);
});

test("Office Workorder tools expose the compact customer-document workspace", () => {
  assert.match(detail, /id: "customer-documents"/);
  assert.match(detail, /label: "Documents"/);
  assert.match(detail, /<WorkorderCustomerDocumentsPanel/);
});

test("documents load on demand and ignore results from a closed or changed source", () => {
  assert.match(panel, /if \(!active \|\| !companyId \|\| !locationId \|\| !workorderId\) return/);
  assert.match(panel, /if \(cancelled\) return;\s*setSummary\(next\)/);
  assert.match(panel, /autoReview && !sourceDirty && !detailDiscountRevisionRequired\(nextAdjustments, next\) && shouldReviewInvoice\(next\)/);
  assert.match(panel, /\[active, autoReview, autoReview && sourceDirty,/);
  assert.match(panel, /if \(cancelled\) return;\s*setProjection\(result\.projection\)/);
});

test("dirty and changed-discount work cannot enter the final Invoice review or issue path", () => {
  assert.match(panel, /const canPreviewInvoice = [^;]*!discountRevisionRequired/);
  assert.match(panel, /documentType === "invoice" && detailDiscountRevisionRequired\(adjustments, summary\)/);
  assert.match(panel, /previewType === "invoice" && detailDiscountRevisionRequired\(adjustments, summary\)/);
  assert.match(panel, /if \(invoice \|\| !canAdjustDiscount\) return/);
  assert.match(detail, /canAdjustDiscount: concernPolicy\.canWrite && activeWorkorder\.allowedActions\?\.update === true && activeWorkorder\.customerDocumentAccess\?\.canWrite === true/);
  assert.match(panel, /disabled=\{busy \|\| !controller\.canAdjustDiscount\}/);
  assert.match(detail, /const canReadCustomerDocuments = isOfficeDetail && activeWorkorder\.customerDocumentAccess\?\.canRead === true/);
  assert.match(detail, /active: canReadCustomerDocuments/);
  assert.match(detail, /\.\.\.\(canReadCustomerDocuments \? \[\{/);
  assert.match(detail, /\{canReadCustomerDocuments \? \(/);
});

test("refresh reconciles a newer issued Estimate using the current saved-intent reference", () => {
  assert.match(panel, /next\.documents\?\.estimate\?\.id !== summaryRef\.current\?\.documents\?\.estimate\?\.id/);
  assert.match(panel, /setAdjustments\(detailDiscountIntentForSummary\(formDataRef\.current, next\)\)/);
});
