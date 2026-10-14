import { useCallback, useEffect, useRef, useState } from "react";
import { createCustomerDocumentGrant, customerDocumentCommandKey, customerDocumentGrantLink, emptyCustomerDocumentAdjustments, issueWorkorderCustomerDocument, previewWorkorderCustomerDocument, readCustomerRevision, readWorkorderCustomerDocumentSummary, readCustomerDocumentProfile } from "./customer-estimate-api.js";
import { customerDocumentProjection } from "./customer-document-model.js";
import { shouldReviewInvoice } from "./workorder-document-state.js";
import { advanceDetailFinancialScope, detailDiscountIntentForSummary, detailDiscountRevisionRequired, passiveFinancialErrorMessage } from "./detail-financial-state.js";

export function revisionProjection(revision) {
  if (!revision) return null;
  const snapshot = revision.snapshot || revision.projection || {};
  return customerDocumentProjection({
    ...snapshot,
    response: revision.response || snapshot.response,
    eligibility: revision.eligibility || snapshot.eligibility,
  });
}

export function useWorkorderCustomerDocuments({ companyId, locationId, workorderId, workorderVersion, workorderStatus, active = true, autoReview = false, currentFinancials = false, formData = {}, sourceDirty = false, sourceKey = "", canAdjustDiscount = false, onAdjustmentsChange }) {
  const [loadedSummary, setSummary] = useState(null);
  const summary = loadedSummary?.workorderId === workorderId ? loadedSummary : null;
  const summaryRef = useRef(summary);
  summaryRef.current = summary;
  const formDataRef = useRef(formData);
  formDataRef.current = formData;
  const [projection, setProjection] = useState(null);
  const [previewType, setPreviewType] = useState("");
  const [shareLink, setShareLink] = useState("");
  const [adjustments, setAdjustments] = useState(() => emptyCustomerDocumentAdjustments());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [currentFinancial, setCurrentFinancial] = useState(null);
  const [financialError, setFinancialError] = useState("");
  const [financialBusy, setFinancialBusy] = useState(false);
  const [maximumOfficePercentage, setMaximumOfficePercentage] = useState(null);
  const issueKeyRef = useRef("");
  const grantKeyRef = useRef("");
  const grantExpiresAtRef = useRef("");

  const loadSummary = useCallback(async ({ preservePreview = false } = {}) => {
    if (!companyId || !locationId || !workorderId) return null;
    const requestedScope = scopeRef.current;
    const next = await readWorkorderCustomerDocumentSummary({ companyId, locationId, workorderId });
    if (scopeRef.current !== requestedScope) return null;
    if (next.documents?.invoice || next.documents?.estimate?.id !== summaryRef.current?.documents?.estimate?.id) {
      setAdjustments(detailDiscountIntentForSummary(formDataRef.current, next));
    }
    setSummary(next);
    if (!preservePreview) {
      setProjection(revisionProjection(next.documents?.invoice || next.documents?.estimate));
      setPreviewType("");
    }
    return next;
  }, [companyId, locationId, workorderId]);

  useEffect(() => {
    if (!active || !companyId || !locationId || !workorderId) return;
    let cancelled = false;
    setBusy(true); setError(""); setProjection(null); setSummary(null); setShareLink("");
    async function openDocument() {
      const next = await readWorkorderCustomerDocumentSummary({ companyId, locationId, workorderId });
      if (cancelled) return;
      setSummary(next);
      const nextAdjustments = detailDiscountIntentForSummary(formDataRef.current, next);
      setAdjustments(nextAdjustments);
      setProjection(revisionProjection(next.documents?.invoice || next.documents?.estimate));
      setPreviewType("");
      if (autoReview && !sourceDirty && !detailDiscountRevisionRequired(nextAdjustments, next) && shouldReviewInvoice(next)) {
        const result = await previewWorkorderCustomerDocument({ companyId, locationId, workorderId,
          expectedVersion: Number(next.workorderVersion || workorderVersion), documentType: "invoice",
          adjustments: emptyCustomerDocumentAdjustments() });
        if (cancelled) return;
        setProjection(result.projection); setPreviewType("invoice");
        setSummary({ ...next, reconciliation: result.reconciliation || next.reconciliation });
        issueKeyRef.current = ""; grantKeyRef.current = ""; grantExpiresAtRef.current = "";
      }
    }
    openDocument().catch((nextError) => {
      if (!cancelled) setError(nextError.message || "Customer documents could not be loaded.");
    }).finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [active, autoReview, autoReview && sourceDirty, companyId, locationId, workorderId, workorderVersion, workorderStatus, sourceKey]);

  const generationRef = useRef(null);
  const scopeIdentity = JSON.stringify([companyId, locationId, workorderId, workorderVersion, sourceKey]);
  generationRef.current = advanceDetailFinancialScope(generationRef.current, scopeIdentity);
  const financialKey = JSON.stringify([scopeIdentity, generationRef.current.generation, adjustments]);
  const financialKeyRef = useRef(financialKey);
  financialKeyRef.current = financialKey;
  const scopeRef = useRef("");
  scopeRef.current = JSON.stringify([scopeIdentity, generationRef.current.generation]);
  const sourceDirtyRef = useRef(sourceDirty);
  sourceDirtyRef.current = sourceDirty;

  useEffect(() => {
    if (!active || !currentFinancials || !companyId || !locationId) return;
    let cancelled = false;
    readCustomerDocumentProfile({ companyId, locationId }).then((profile) => {
      if (!cancelled) setMaximumOfficePercentage(profile?.discountPolicy?.maxOfficePercentage ?? null);
    }).catch(() => { if (!cancelled) setMaximumOfficePercentage(null); });
    return () => { cancelled = true; };
  }, [active, currentFinancials, companyId, locationId]);

  useEffect(() => {
    if (summary?.documents?.invoice) { setFinancialBusy(false); setFinancialError(""); return; }
    if (!active || !currentFinancials || !summary || sourceDirty || summary.documents?.invoice) { setFinancialBusy(false); return; }
    let cancelled = false;
    setFinancialBusy(true); setFinancialError("");
    const timer = setTimeout(async () => {
      try {
        const result = await previewWorkorderCustomerDocument({ companyId, locationId, workorderId,
          expectedVersion: Number(workorderVersion), documentType: "estimate", adjustments });
        if (!cancelled && financialKeyRef.current === financialKey) setCurrentFinancial({ key: financialKey, projection: result.projection });
      } catch (nextError) {
        if (!cancelled && financialKeyRef.current === financialKey) {
          setCurrentFinancial(null); setFinancialError(passiveFinancialErrorMessage(nextError));
        }
      } finally { if (!cancelled) setFinancialBusy(false); }
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [active, currentFinancials, Boolean(summary), summary?.documents?.invoice?.id, financialKey, sourceDirty]);
  const currentFinancialProjection = summary?.documents?.invoice
    ? revisionProjection(summary.documents.invoice)
    : !sourceDirty && currentFinancial?.key === financialKey ? currentFinancial.projection : null;

  async function preview(documentType) {
    if (sourceDirty) { setError("Save changes before reviewing the document."); return; }
    if (documentType === "invoice" && detailDiscountRevisionRequired(adjustments, summary)) {
      setError("Review and issue the revised Estimate before preparing the Invoice."); return;
    }
    const requestedScope = scopeRef.current;
    const requestedFinancialKey = financialKeyRef.current;
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
      if (scopeRef.current !== requestedScope || financialKeyRef.current !== requestedFinancialKey || sourceDirtyRef.current) return;
      setProjection(result.projection);
      setPreviewType(documentType);
      setSummary((current) => ({ ...current, reconciliation: result.reconciliation || current?.reconciliation }));
      issueKeyRef.current = ""; grantKeyRef.current = ""; grantExpiresAtRef.current = "";
    } catch (nextError) {
      if (scopeRef.current === requestedScope) setError(nextError.message || `The ${documentType} preview could not be prepared.`);
    } finally { if (scopeRef.current === requestedScope) setBusy(false); }
  }

  async function grantForRevision(revisionId, documentType = previewType || projection?.type) {
    const requestedScope = scopeRef.current;
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
    if (scopeRef.current !== requestedScope) return;
    if (!grant.rawToken) throw new Error("The document is saved, but the secure link secret is no longer available. Create a replacement link.");
    setShareLink(customerDocumentGrantLink(grant.rawToken));
  }

  async function issue() {
    if (sourceDirty) { setError("Save changes before issuing the document."); return; }
    if (previewType === "invoice" && detailDiscountRevisionRequired(adjustments, summary)) {
      setError("Review and issue the revised Estimate before preparing the Invoice."); return;
    }
    if (!previewType || !projection?.financialFingerprint) return;
    const predecessor = summary?.documents?.estimate || null;
    if (previewType === "estimate" && (!predecessor?.documentId || !predecessor?.id || !predecessor?.draftId)) {
      setError("The original Estimate lineage is unavailable. Refresh this Workorder before issuing a revision.");
      return;
    }
    setBusy(true); setError("");
    const requestedScope = scopeRef.current;
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
      if (scopeRef.current !== requestedScope) return;
      const revisionId = issued?.revision?.id || issued?.id;
      if (!revisionId) throw new Error(`The issued ${previewType} did not include a revision identifier.`);
      await grantForRevision(revisionId, previewType);
      if (scopeRef.current !== requestedScope) return;
      const current = await readCustomerRevision(revisionId);
      if (scopeRef.current !== requestedScope) return;
      setProjection(current.projection);
      setPreviewType("");
      await loadSummary({ preservePreview: true });
    } catch (nextError) {
      if (scopeRef.current === requestedScope) setError(nextError.message || `The ${previewType} could not be issued.`);
    } finally { if (scopeRef.current === requestedScope) setBusy(false); }
  }

  async function createReplacementGrant() {
    const requestedScope = scopeRef.current;
    const revision = summary?.documents?.invoice || summary?.documents?.estimate;
    if (!revision?.id) return;
    setBusy(true); setError(""); grantKeyRef.current = ""; grantExpiresAtRef.current = "";
    try { await grantForRevision(revision.id, revision.documentType); }
    catch (nextError) { if (scopeRef.current === requestedScope) setError(nextError.message || "A replacement customer link could not be created."); }
    finally { if (scopeRef.current === requestedScope) setBusy(false); }
  }

  async function refresh() {
    const requestedScope = scopeRef.current;
    setBusy(true); setError("");
    try {
      const revisionId = projection?.revisionId;
      if (revisionId) {
        const current = await readCustomerRevision(revisionId);
        if (scopeRef.current !== requestedScope) return;
        setProjection(current.projection);
      }
      await loadSummary({ preservePreview: Boolean(revisionId) });
    } catch (nextError) { if (scopeRef.current === requestedScope) setError(nextError.message || "Customer document status could not be refreshed."); }
    finally { if (scopeRef.current === requestedScope) setBusy(false); }
  }

  const effectiveStatus = summary?.status || workorderStatus;
  const estimate = summary?.documents?.estimate || null;
  const invoice = summary?.documents?.invoice || null;
  const reconciliation = summary?.reconciliation || null;
  const discountRevisionRequired = detailDiscountRevisionRequired(adjustments, summary);
  const canPreviewInvoice = effectiveStatus === "mechanic_done" && reconciliation?.invoiceEligible === true && !invoice && !discountRevisionRequired;
  const canPreviewRevision = Boolean(estimate) && !invoice && !canPreviewInvoice;

  function updateAdjustments(next) {
    if (invoice || !canAdjustDiscount) return;
    setAdjustments(next);
    onAdjustmentsChange?.(next, estimate?.id || "");
    setError(""); setShareLink("");
    if (previewType) {
      setProjection(null); setPreviewType("");
      issueKeyRef.current = ""; grantKeyRef.current = ""; grantExpiresAtRef.current = "";
    }
  }

  return { summary, projection, previewType, shareLink, adjustments, busy, error, setError, refresh, preview, issue, createReplacementGrant, updateAdjustments, effectiveStatus, estimate, invoice, reconciliation, canPreviewInvoice, canPreviewRevision, currentFinancialProjection, financialBusy, financialError, maximumOfficePercentage, discountRevisionRequired, canAdjustDiscount };
}
