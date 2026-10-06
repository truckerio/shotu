import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui/Button.jsx";
import { CustomerDocumentReview } from "./CustomerDocumentReview.jsx";
import { CustomerDocumentDiscountEditor } from "./CustomerDocumentDiscountEditor.jsx";
import { WorkorderCustomerChat } from "./WorkorderCustomerChat.jsx";
import {
  createCustomerDocumentGrant,
  customerDocumentCommandKey,
  customerDocumentGrantLink,
  emptyCustomerDocumentAdjustments,
  issueWorkorderCustomerDocument,
  previewWorkorderCustomerDocument,
  readCustomerRevision,
  readWorkorderCustomerDocumentSummary,
} from "./customer-estimate-api.js";
import { customerDocumentProjection } from "./customer-document-model.js";
import "./workorder-customer-documents.css";

function revisionProjection(revision) {
  if (!revision) return null;
  const snapshot = revision.snapshot || revision.projection || {};
  return customerDocumentProjection({
    ...snapshot,
    response: revision.response || snapshot.response,
    eligibility: revision.eligibility || snapshot.eligibility,
  });
}

function reconciliationCopy(reconciliation, status) {
  if (!reconciliation) return "Checking the current Estimate against this Workorder.";
  if (reconciliation.invoiceEligible && status === "mechanic_done") return "Work done matches the accepted Estimate. The final Invoice is ready to preview.";
  if (reconciliation.requiresRevisedEstimate) return "Workorder scope or pricing changed. Send a revised Estimate and wait for acceptance before issuing the Invoice.";
  if (reconciliation.status === "financial_source_incomplete") return "Complete all selling prices and billable quantities before creating a customer document.";
  if (status !== "mechanic_done") return "The accepted Estimate stays current while work is in progress. Issue the Invoice only after Work done.";
  return "A current accepted Estimate is required before the final Invoice can be issued.";
}

export function WorkorderCustomerDocumentsPanel({ companyId, locationId, workorderId, workorderVersion, workorderStatus }) {
  const [summary, setSummary] = useState(null);
  const [projection, setProjection] = useState(null);
  const [previewType, setPreviewType] = useState("");
  const [shareLink, setShareLink] = useState("");
  const [adjustments, setAdjustments] = useState(() => emptyCustomerDocumentAdjustments());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const issueKeyRef = useRef("");
  const grantKeyRef = useRef("");
  const grantExpiresAtRef = useRef("");

  const loadSummary = useCallback(async ({ preservePreview = false } = {}) => {
    if (!companyId || !locationId || !workorderId) return null;
    const next = await readWorkorderCustomerDocumentSummary({ companyId, locationId, workorderId });
    setSummary(next);
    if (!preservePreview) {
      setProjection(revisionProjection(next.documents?.invoice || next.documents?.estimate));
      setPreviewType("");
    }
    return next;
  }, [companyId, locationId, workorderId]);

  useEffect(() => {
    let cancelled = false;
    setBusy(true); setError(""); setProjection(null); setSummary(null); setShareLink("");
    loadSummary().catch((nextError) => {
      if (!cancelled) setError(nextError.message || "Customer documents could not be loaded.");
    }).finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [loadSummary]);

  async function preview(documentType) {
    setBusy(true); setError(""); setShareLink("");
    try {
      const result = await previewWorkorderCustomerDocument({
        companyId,
        locationId,
        workorderId,
        expectedVersion: Number(summary?.workorderVersion || workorderVersion),
        documentType,
        adjustments: documentType === "estimate" ? adjustments : emptyCustomerDocumentAdjustments(),
      });
      setProjection(result.projection);
      setPreviewType(documentType);
      setSummary((current) => ({ ...current, reconciliation: result.reconciliation || current?.reconciliation }));
      issueKeyRef.current = ""; grantKeyRef.current = ""; grantExpiresAtRef.current = "";
    } catch (nextError) {
      setError(nextError.message || `The ${documentType} preview could not be prepared.`);
    } finally { setBusy(false); }
  }

  async function grantForRevision(revisionId, documentType = previewType || projection?.type) {
    grantKeyRef.current ||= customerDocumentCommandKey(`${documentType}-grant`);
    grantExpiresAtRef.current ||= new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const grant = await createCustomerDocumentGrant({
      companyId,
      locationId,
      revisionId,
      allowedActions: ["view_revision", "customer_chat", ...(documentType === "estimate" && summary?.approvalRequired === true ? ["respond_revision"] : [])],
      idempotencyKey: grantKeyRef.current,
      expiresAt: grantExpiresAtRef.current,
    });
    if (!grant.rawToken) throw new Error("The document is saved, but the secure link secret is no longer available. Create a replacement link.");
    setShareLink(customerDocumentGrantLink(grant.rawToken));
  }

  async function issue() {
    if (!previewType || !projection?.financialFingerprint) return;
    const predecessor = summary?.documents?.estimate || null;
    if (previewType === "estimate" && (!predecessor?.documentId || !predecessor?.id || !predecessor?.draftId)) {
      setError("The original Estimate lineage is unavailable. Refresh this Workorder before issuing a revision.");
      return;
    }
    setBusy(true); setError("");
    try {
      issueKeyRef.current ||= customerDocumentCommandKey(`${previewType}-issue`);
      const issued = await issueWorkorderCustomerDocument({
        companyId,
        locationId,
        workorderId,
        expectedVersion: Number(summary?.workorderVersion || workorderVersion),
        documentType: previewType,
        projection,
        reconciliation: summary?.reconciliation,
        adjustments: previewType === "estimate" ? adjustments : emptyCustomerDocumentAdjustments(),
        predecessor,
        recipient: projection.customer,
        idempotencyKey: issueKeyRef.current,
      });
      const revisionId = issued?.revision?.id || issued?.id;
      if (!revisionId) throw new Error(`The issued ${previewType} did not include a revision identifier.`);
      await grantForRevision(revisionId, previewType);
      const current = await readCustomerRevision(revisionId);
      setProjection(current.projection);
      setPreviewType("");
      await loadSummary({ preservePreview: true });
    } catch (nextError) {
      setError(nextError.message || `The ${previewType} could not be issued.`);
    } finally { setBusy(false); }
  }

  async function createReplacementGrant() {
    const revision = summary?.documents?.invoice || summary?.documents?.estimate;
    if (!revision?.id) return;
    setBusy(true); setError(""); grantKeyRef.current = ""; grantExpiresAtRef.current = "";
    try { await grantForRevision(revision.id, revision.documentType); }
    catch (nextError) { setError(nextError.message || "A replacement customer link could not be created."); }
    finally { setBusy(false); }
  }

  async function refresh() {
    setBusy(true); setError("");
    try {
      const revisionId = projection?.revisionId;
      if (revisionId) {
        const current = await readCustomerRevision(revisionId);
        setProjection(current.projection);
      }
      await loadSummary({ preservePreview: Boolean(revisionId) });
    } catch (nextError) { setError(nextError.message || "Customer document status could not be refreshed."); }
    finally { setBusy(false); }
  }

  const effectiveStatus = summary?.status || workorderStatus;
  const estimate = summary?.documents?.estimate || null;
  const invoice = summary?.documents?.invoice || null;
  const reconciliation = summary?.reconciliation || null;
  const canPreviewInvoice = effectiveStatus === "mechanic_done" && reconciliation?.invoiceEligible === true && !invoice;
  const canPreviewRevision = Boolean(estimate) && !invoice && !canPreviewInvoice;

  function updateAdjustments(next) {
    setAdjustments(next);
    setError(""); setShareLink("");
    if (previewType === "estimate") {
      setProjection(null); setPreviewType("");
      issueKeyRef.current = ""; grantKeyRef.current = ""; grantExpiresAtRef.current = "";
    }
  }

  return <section className="workorder-customer-documents" aria-labelledby="workorder-customer-documents-title">
    <header><div><h2 id="workorder-customer-documents-title">Customer documents</h2><p>{reconciliationCopy(reconciliation, effectiveStatus)}</p></div><Button variant="secondary" type="button" onClick={refresh} disabled={busy}>Refresh</Button></header>
    <dl className="workorder-customer-document-status"><div><dt>Estimate</dt><dd>{estimate ? `${estimate.documentNumber} · R${estimate.revisionNumber} · ${estimate.response?.status || "pending"}` : "Not linked"}</dd></div><div><dt>Invoice</dt><dd>{invoice ? invoice.documentNumber : effectiveStatus === "mechanic_done" ? "Not issued" : "Available after Work done"}</dd></div></dl>
    {error ? <p role="alert" className="workorder-customer-document-error">{error}</p> : null}
    {!projection && busy ? <p role="status">Loading customer documents…</p> : null}
    {canPreviewRevision ? <CustomerDocumentDiscountEditor adjustments={adjustments} onChange={updateAdjustments} disabled={busy} /> : null}
    <div className="workorder-customer-document-actions">
      {canPreviewRevision ? <Button variant="secondary" type="button" onClick={() => preview("estimate")} disabled={busy}>Preview revised Estimate</Button> : null}
      {canPreviewInvoice ? <Button variant="primary" type="button" onClick={() => preview("invoice")} disabled={busy}>Preview final Invoice</Button> : null}
      {(estimate || invoice) && !shareLink ? <Button variant="secondary" type="button" onClick={createReplacementGrant} disabled={busy}>Create customer link</Button> : null}
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
