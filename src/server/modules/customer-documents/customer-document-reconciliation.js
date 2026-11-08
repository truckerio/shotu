import { buildCustomerDocumentProjection } from "./customer-document-projection.js";
import { canonicalFinancialHash } from "./customer-financial-calculator.js";

function commercialScope(lines = []) {
  return lines.map((line) => ({
    type: line?.type || null,
    description: String(line?.description || "").trim(),
    quantity: String(line?.quantity ?? ""),
    unit: String(line?.unit || "").trim(),
    unitPrice: String(line?.unitPrice ?? ""),
  })).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

export function commercialScopeHash(snapshot) {
  return canonicalFinancialHash({ lines: commercialScope(snapshot?.lines) });
}

export function reconcileWorkorderEstimate({ actualSource, acceptedEstimate }) {
  const actualPricingFingerprint = actualSource?.sourceEvidence?.pricingFingerprint || null;
  const acceptedPricingFingerprint = acceptedEstimate?.snapshot?.sourceEvidence?.pricingFingerprint || null;
  const acceptedIsWorkorderSource = acceptedEstimate?.snapshot?.sourceEvidence?.kind === "workorder";
  const acceptedIsActivationDraft = acceptedEstimate?.snapshot?.sourceEvidence?.kind === "draft"
    && acceptedEstimate?.activationAuthorized === true;
  const actualScopeHash = commercialScopeHash(actualSource);
  const acceptedScopeHash = commercialScopeHash(acceptedEstimate?.snapshot);
  const sourceMatches = acceptedIsWorkorderSource
    ? Boolean(actualPricingFingerprint && actualPricingFingerprint === acceptedPricingFingerprint)
    : Boolean(acceptedIsActivationDraft && actualScopeHash === acceptedScopeHash);
  const sourceMatchMode = sourceMatches
    ? (acceptedIsWorkorderSource ? "workorder_pricing_fingerprint" : "activation_commercial_scope")
    : null;
  const profileMatches = Boolean(actualSource?.profileVersionId
    && actualSource.profileVersionId === acceptedEstimate?.snapshot?.profileVersionId
    && actualSource?.taxProfileVersionId === acceptedEstimate?.snapshot?.taxProfileVersionId);
  const matches = Boolean(
    acceptedEstimate?.id
    && sourceMatches
    && profileMatches,
  );
  const reconciliationHash = canonicalFinancialHash({
    workorderId: actualSource?.sourceEvidence?.id || null,
    workorderVersion: actualSource?.sourceEvidence?.version ?? null,
    actualPricingFingerprint,
    acceptedEstimateRevisionId: acceptedEstimate?.id || null,
    acceptedPricingFingerprint,
    acceptedSourceKind: acceptedEstimate?.snapshot?.sourceEvidence?.kind || null,
    activationAuthorized: acceptedEstimate?.activationAuthorized === true,
    actualScopeHash,
    acceptedScopeHash,
    sourceMatches,
    sourceMatchMode,
    acceptedFinancialFingerprint: acceptedEstimate?.financialFingerprint || acceptedEstimate?.snapshot?.financialFingerprint || null,
    profileVersionId: actualSource?.profileVersionId || null,
    taxProfileVersionId: actualSource?.taxProfileVersionId || null,
    profileMatches,
    matches,
  });
  return {
    status: matches ? "authorized" : "revised_estimate_required",
    invoiceEligible: matches,
    requiresRevisedEstimate: !matches,
    workorderId: actualSource?.sourceEvidence?.id || null,
    workorderVersion: actualSource?.sourceEvidence?.version ?? null,
    actualPricingFingerprint,
    actualScopeHash,
    acceptedScopeHash,
    sourceMatchMode,
    acceptedEstimateRevisionId: acceptedEstimate?.id || null,
    reconciliationHash,
  };
}

// Deliberately independent from invoice authorization: an unanswered issued
// Estimate can still exactly match the current customer-facing Workorder.
export function compareLatestIssuedEstimate({ sourceInput, latestEstimate }) {
  if (!latestEstimate?.snapshot) return { state: "not_issued", requiresUpdate: false, changedFields: [], latestEstimateRevisionId: null };
  const snapshot = latestEstimate.snapshot;
  // Compare undiscounted prices first. A reduced or removed line may no longer
  // support its old fixed discount; that is a changed Estimate, not a failed read.
  const undiscounted = buildCustomerDocumentProjection({
    ...sourceInput,
    financial: { ...sourceInput.financial, documentDiscount: null,
      lines: sourceInput.financial.lines.map((line) => ({ ...line, lineDiscount: null })) },
  }).projection;
  const priceScope = (projection) => (projection.lines || []).map((line) => ({
    ...commercialScope([line])[0], gross: line.gross,
  })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if (canonicalFinancialHash(priceScope(undiscounted)) !== canonicalFinancialHash(priceScope(snapshot))) {
    return { state: "changed", requiresUpdate: true, changedFields: ["lines", "totals"], latestEstimateRevisionId: latestEstimate.id };
  }
  const available = [...(snapshot.lines || [])];
  const lines = sourceInput.financial.lines.map((line) => {
    const matchingId = available.findIndex((issued) => issued.id === line.id);
    const index = matchingId >= 0 ? matchingId : available.findIndex((issued) => issued.type === line.type
      && String(issued.description || "").trim() === String(line.description || "").trim()
      && String(issued.unit || "").trim() === String(line.unit || "").trim()
      && Number(issued.quantity) === Number(line.quantity)
      && Number(issued.unitPrice) === Number(line.unitPrice));
    const issued = index >= 0 ? available.splice(index, 1)[0] : null;
    return {
      ...line,
      lineDiscount: Number(issued?.lineDiscount) > 0
        ? { kind: "fixed", value: issued.lineDiscount, reason: issued.source?.discountReason || "Issued estimate discount" }
        : null,
    };
  });
  const current = buildCustomerDocumentProjection({
    ...sourceInput,
    discountEvidence: snapshot.discountEvidence || { documentDiscount: null },
    financial: { ...sourceInput.financial, lines, documentDiscount: snapshot.discountEvidence?.documentDiscount || null },
  }).projection;
  const lineValues = (value) => (value.lines || []).map((line) => ({
    ...commercialScope([line])[0], gross: line.gross, lineDiscount: line.lineDiscount,
    documentDiscountAllocation: line.documentDiscountAllocation, net: line.net, tax: line.tax, total: line.total,
    taxCategory: line.taxCategory, taxTreatment: line.taxTreatment, taxComponents: line.taxComponents,
  })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const groups = (value) => ({
    lines: lineValues(value), totals: value.totals,
    // Recipient contact details belong to delivery, not Workorder identity.
    customer: { company: value.customer?.company || value.customer?.name || "" },
    unit: { label: value.unit?.label || "", vin: value.unit?.vin || null, make: value.unit?.make || null, model: value.unit?.model || null, year: value.unit?.year || null },
    scope: { concern: value.concern || "", repairDescription: value.repairDescription || "" },
    terms: { terms: value.terms || "", authorizationText: value.authorizationText || "", warrantyText: value.warrantyText || "", footer: value.footer || "" },
    shop: value.shop,
  });
  const actualGroups = groups(current); const issuedGroups = groups(snapshot);
  const changedFields = Object.keys(actualGroups).filter((key) => canonicalFinancialHash(actualGroups[key]) !== canonicalFinancialHash(issuedGroups[key]));
  return { state: changedFields.length ? "changed" : "current", requiresUpdate: changedFields.length > 0, changedFields, latestEstimateRevisionId: latestEstimate.id };
}
