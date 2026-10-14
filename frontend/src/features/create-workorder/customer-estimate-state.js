import { emptyCustomerDocumentAdjustments } from "../customer-documents/customer-estimate-api.js";

export function customerEstimateActionPending({ busy, draft, draftStatus }) {
  return Boolean(busy || (draft?.id && draft.status === "active" && ["dirty", "saving"].includes(draftStatus)));
}

export function customerDocumentAdjustmentsFromForm(value) {
  const empty = emptyCustomerDocumentAdjustments();
  return {
    ...empty,
    ...(value && typeof value === "object" ? value : {}),
    lineDiscounts: Array.isArray(value?.lineDiscounts) ? value.lineDiscounts : empty.lineDiscounts,
    documentDiscount: value?.documentDiscount || null,
    overrideReasons: Array.isArray(value?.overrideReasons) ? value.overrideReasons : empty.overrideReasons,
  };
}

export function customerEstimateSourceKey({ companyId, locationId, draft, adjustments, ready }) {
  return JSON.stringify({
    adjustments: customerDocumentAdjustmentsFromForm(adjustments),
    companyId: companyId || "",
    draftId: draft?.id || "",
    draftVersion: Number.isInteger(draft?.version) ? draft.version : 0,
    locationId: locationId || "",
    ready: Boolean(ready),
  });
}

export function isCurrentCustomerEstimateRequest(requestKey, currentKey) {
  return requestKey === currentKey;
}

function canonicalDocumentDiscount(discount) {
  if (!discount || typeof discount !== "object") return null;
  return {
    kind: String(discount.kind || "").trim(),
    value: String(discount.value ?? "").trim(),
    reason: String(discount.reason || "").trim(),
  };
}

export function recoveredEstimateMatchesSavedDraft({ revision, draft, adjustments }) {
  const snapshot = revision?.snapshot || revision?.projection || {};
  const source = snapshot.sourceEvidence;
  if (source?.kind !== "draft" || String(source.id || "") !== String(draft?.id || "") || Number(source.version) !== Number(draft?.version)) return false;
  return JSON.stringify(canonicalDocumentDiscount(snapshot.discountEvidence?.documentDiscount))
    === JSON.stringify(canonicalDocumentDiscount(customerDocumentAdjustmentsFromForm(adjustments).documentDiscount));
}

export function customerEstimateErrorMessage(error, fallback) {
  const message = typeof error?.message === "string" ? error.message : "";
  try {
    const parsed = JSON.parse(message);
    if (Array.isArray(parsed)) {
      const firstMessage = parsed.find((entry) => typeof entry?.message === "string" && entry.message.trim())?.message;
      if (firstMessage) return firstMessage;
    }
  } catch {
    // Ordinary API errors are already human-readable.
  }
  return message || fallback;
}
