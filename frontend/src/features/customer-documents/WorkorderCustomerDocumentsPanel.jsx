import { Button } from "../../components/ui/Button.jsx";
import { CustomerDocumentReview } from "./CustomerDocumentReview.jsx";
import { CustomerDocumentDiscountEditor } from "./CustomerDocumentDiscountEditor.jsx";
import { WorkorderCustomerChat } from "./WorkorderCustomerChat.jsx";
import { revisionProjection, useWorkorderCustomerDocuments } from "./useWorkorderCustomerDocuments.js";
import "./workorder-customer-documents.css";

function reconciliationCopy(reconciliation, status) {
  if (!reconciliation) return "Checking the current Estimate against this Workorder.";
  if (reconciliation.invoiceEligible && status === "mechanic_done") return "Work done matches the accepted Estimate. The final Invoice is ready to preview.";
  if (reconciliation.requiresRevisedEstimate) return "Workorder scope or pricing changed. Send a revised Estimate and wait for acceptance before issuing the Invoice.";
  if (reconciliation.status === "financial_source_incomplete") return "Complete all selling prices and billable quantities before creating a customer document.";
  if (status !== "mechanic_done") return "The accepted Estimate stays current while work is in progress. Issue the Invoice only after Work done.";
  return "A current accepted Estimate is required before the final Invoice can be issued.";
}

export function WorkorderCustomerDocumentsPanel(props) {
  return props.controller ? <DocumentsBody {...props} controller={props.controller} /> : <StandaloneDocuments {...props} />;
}

function StandaloneDocuments(props) {
  const controller = useWorkorderCustomerDocuments(props);
  return <DocumentsBody {...props} controller={controller} />;
}

function DocumentsBody({ companyId, locationId, workorderId, controller }) {
  const { summary, projection, previewType, shareLink, adjustments, busy, error, setError, refresh, preview, issue, createReplacementGrant, updateAdjustments, effectiveStatus, estimate, invoice, reconciliation, canPreviewInvoice, canPreviewRevision } = controller;
  return <section className="workorder-customer-documents" aria-labelledby="workorder-customer-documents-title">
    <header><div><h2 id="workorder-customer-documents-title">Customer documents</h2><p>{controller.discountRevisionRequired ? "Discount terms changed. Issue a revised Estimate before preparing the Invoice." : reconciliationCopy(reconciliation, effectiveStatus)}</p></div><Button variant="secondary" type="button" onClick={refresh} disabled={busy}>Refresh</Button></header>
    <dl className="workorder-customer-document-status"><div><dt>Estimate</dt><dd>{estimate ? `${estimate.documentNumber} · R${estimate.revisionNumber} · ${estimate.response?.status || "pending"}` : "Not linked"}</dd></div><div><dt>Invoice</dt><dd>{invoice ? invoice.documentNumber : effectiveStatus === "mechanic_done" ? "Not issued" : "Available after Work done"}</dd></div></dl>
    {error ? <p role="alert" className="workorder-customer-document-error">{error}</p> : null}
    {!projection && busy ? <p role="status">Loading customer documents…</p> : null}
    {canPreviewRevision ? <details className="workorder-customer-document-revision">
      <summary>Revise estimate</summary>
      <CustomerDocumentDiscountEditor adjustments={adjustments} onChange={updateAdjustments} disabled={busy || !controller.canAdjustDiscount} maximumOfficePercentage={controller.maximumOfficePercentage} />
      <Button variant="secondary" type="button" onClick={() => preview("estimate")} disabled={busy}>Review revised Estimate</Button>
    </details> : null}
    <div className="workorder-customer-document-actions">
      {canPreviewInvoice && previewType !== "invoice" ? <Button variant="primary" type="button" onClick={() => preview("invoice")} disabled={busy}>Review Invoice</Button> : null}
    </div>
    {projection ? <CustomerDocumentReview
      projection={projection}
      previousRevision={previewType === "estimate" ? revisionProjection(estimate) : null}
      issueAvailable={Boolean(previewType && projection.financialFingerprint && (previewType !== "invoice" || canPreviewInvoice))}
      issueLabel={previewType === "invoice" ? "Issue final Invoice" : "Issue revised Estimate"}
      onIssue={previewType ? issue : undefined}
      issueBusy={busy}
      shareLink={shareLink}
      onCopyLink={shareLink ? () => navigator.clipboard.writeText(shareLink).catch(() => setError("Copy failed. Open the customer link and copy it from the address bar.")) : undefined}
      onCreateReplacementGrant={!shareLink && (estimate || invoice) ? createReplacementGrant : undefined}
      onRefreshResponse={projection.revisionId ? refresh : undefined}
      actionError=""
    /> : null}
    <WorkorderCustomerChat
      companyId={companyId}
      locationId={locationId}
      workorderId={workorderId}
      document={invoice || estimate}
    />
  </section>;
}
