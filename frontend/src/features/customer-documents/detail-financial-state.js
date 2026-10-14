import { normalizeUsedParts } from "../../components/workorders/used-parts-model.js";

export function advanceDetailFinancialScope(previous, key) {
  return previous?.key === key ? previous : { key, generation: (previous?.generation || 0) + 1 };
}

export function detailDiscountRevisionRequired(adjustments, summary) {
  const estimate = summary?.documents?.estimate;
  if (!estimate) return false;
  const normalize = (discount) => discount ? {
    kind: discount.kind,
    value: String(Number(discount.value)),
    reason: String(discount.reason || "").trim(),
  } : null;
  const changed = JSON.stringify(normalize(adjustments?.documentDiscount))
    !== JSON.stringify(normalize(estimate.snapshot?.discountEvidence?.documentDiscount));
  const acceptedId = summary.reconciliation?.acceptedEstimateRevisionId;
  return changed || Boolean(summary.reconciliation?.invoiceEligible && acceptedId && acceptedId !== estimate.id);
}

export function detailDiscountIntent(formData = {}, estimate = null) {
  const empty = { lineDiscounts: [], documentDiscount: null, overrideReasons: [] };
  if (!estimate || formData.customerDocumentAdjustmentBaseRevisionId === estimate.id) {
    return formData.customerDocumentAdjustments || empty;
  }
  return { ...empty, documentDiscount: estimate.snapshot?.discountEvidence?.documentDiscount || null };
}

export function detailDiscountIntentForSummary(formData, summary) {
  return summary?.documents?.invoice
    ? { lineDiscounts: [], overrideReasons: [], documentDiscount: summary.documents.invoice.snapshot?.discountEvidence?.documentDiscount || null }
    : detailDiscountIntent(formData, summary?.documents?.estimate);
}

export function detailFinancialSourceDirty(form = {}, saved = {}) {
  const input = (value) => JSON.stringify({
    locationId: value.locationId || "",
    unitNo: value.unitNo || "", customerCompanyName: value.customerCompanyName || "",
    hours: String(value.laborHours || ""), product: value.laborProduct?.productId || "",
    unit: value.laborProduct?.uomCode || "hr", concern: value.mechanicConcern || "",
    repair: value.workPerformed || "", parts: normalizeUsedParts(value.parts),
  });
  return input(form) !== input(saved);
}
export function passiveFinancialErrorMessage(error) {
  if (error?.code === "CUSTOMER_DOCUMENT_EMPTY_ESTIMATE") return "";
  return error?.message || "Current charges could not be calculated.";
}
