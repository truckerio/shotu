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
