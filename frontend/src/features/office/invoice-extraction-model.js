export const INVOICE_HEADER_FIELDS = Object.freeze([
  ["documentType", "Document type", "select"],
  ["vendorName", "Vendor", "text"],
  ["vendorAccount", "Vendor account", "text"],
  ["invoiceNumber", "Invoice number", "text"],
  ["invoiceDate", "Invoice date", "text"],
  ["purchaseOrderNumber", "PO number", "text", { optional: true, secondary: true }],
  ["currency", "Currency", "currency"],
  ["subtotal", "Subtotal", "number"],
  ["tax", "Tax", "number"],
  ["shipping", "Shipping", "number"],
  ["total", "Total", "number"],
]);

export function validateInvoiceSelection(files, { acceptedTypes, maxBytes, maxFiles = 10 }) {
  const selected = Array.from(files || []);
  if (selected.length > maxFiles) {
    return { files: [], error: `Choose no more than ${maxFiles} invoices at a time.` };
  }
  for (const file of selected) {
    if (!acceptedTypes.has(file.type)) {
      return { files: [], error: `${file.name || "One file"} is not a PNG, JPEG, WebP, or PDF invoice.` };
    }
    if (!file.size) {
      return { files: [], error: `${file.name || "One file"} appears to be empty.` };
    }
    if (file.size > maxBytes) {
      return { files: [], error: `${file.name || "One file"} must be smaller than 10 MB.` };
    }
  }
  return { files: selected, error: "" };
}

export function reviewedEvidenceField(field, value) {
  return { ...field, value, confidence: 100, evidence: "Reviewed by user." };
}

export function updateInvoiceField(draft, fieldName, value) {
  return { ...draft, [fieldName]: reviewedEvidenceField(draft[fieldName], value) };
}

export function updateInvoiceLineField(draft, lineId, fieldName, value) {
  return {
    ...draft,
    lines: draft.lines.map((line) => line.id === lineId
      ? { ...line, [fieldName]: reviewedEvidenceField(line[fieldName], value) }
      : line),
  };
}

export function removeInvoiceLine(draft, lineId) {
  return { ...draft, lines: draft.lines.filter((line) => line.id !== lineId) };
}

export function addBlankInvoiceLine(draft, lineId) {
  const blankText = { value: "", confidence: 0, evidence: "Added by reviewer; enter a value." };
  const blankNumber = { value: null, confidence: 0, evidence: "Added by reviewer; enter a value." };
  return {
    ...draft,
    lines: [...draft.lines, {
      id: lineId,
      partNumber: { ...blankText },
      description: { ...blankText },
      quantity: { ...blankNumber },
      unitOfMeasure: { ...blankText },
      unitPrice: { ...blankNumber },
      lineTotal: { ...blankNumber },
    }],
  };
}

export function confidenceState(confidence, threshold = 90) {
  return Number(confidence) < threshold ? "Review" : "Confident";
}

export function invoiceFieldNeedsReview(field, { optional = false } = {}, threshold = 90) {
  if (optional && !String(field?.value ?? "").trim()) return false;
  return Number(field?.confidence) < threshold;
}

export const INVOICE_LINE_FIELDS = Object.freeze(["partNumber", "description", "quantity", "unitOfMeasure", "unitPrice", "lineTotal"]);

export function invoiceLineNeedsReview(line, threshold = 90) {
  return INVOICE_LINE_FIELDS.some((fieldName) => Number(line?.[fieldName]?.confidence) < threshold);
}

export function orderInvoiceLinesForReview(lines = []) {
  return [...lines].sort((left, right) => Number(invoiceLineNeedsReview(right)) - Number(invoiceLineNeedsReview(left)));
}

export function firstInvoiceLineId(lines = []) {
  return lines.find((line) => invoiceLineNeedsReview(line))?.id || "";
}

export function nextInvoiceLineIdAfterRemoval(lines = [], removedId = "") {
  const index = lines.findIndex((line) => line.id === removedId);
  if (index < 0) return firstInvoiceLineId(lines);
  return lines[index + 1]?.id || lines[index - 1]?.id || "";
}

export function orderInvoiceReviewSections(sections = []) {
  return sections
    .map((section, index) => ({ section, index }))
    .sort((left, right) => Number(Boolean(right.section.unresolved)) - Number(Boolean(left.section.unresolved)) || left.index - right.index)
    .map(({ section }) => section);
}

export function invoiceDeliveryFullyReceived({ suggestion } = {}) {
  return suggestion?.reason === "invoice_fully_received"
    || (suggestion?.receiptLines?.length > 0
      && suggestion.receiptLines.every((line) => Number(line.invoiceOutstandingQuantity) <= 0));
}

export function invoiceReviewErrorMessage(error) {
  const issues = Array.isArray(error?.details?.issues) ? error.details.issues : [];
  const messages = [...new Set(issues.map((issue) => String(issue?.message || "").trim()).filter(Boolean))];
  if (error?.code === "validation_error" && messages.length) return messages.join(" ");
  return error?.message || "The invoice review could not be saved.";
}

export function shouldConfirmInvoiceReviewLeave({ dirty = false, status = "" } = {}) {
  return Boolean(dirty) && status !== "reviewed";
}

export function nextReviewableBatchIndex(entries, currentIndex = -1) {
  const reviewable = (entry) => Boolean(entry?.run?.draft)
    && !entry.error
    && !["processing", "failed", "reviewed"].includes(entry.run.status);
  for (let offset = 1; offset <= entries.length; offset += 1) {
    const index = (currentIndex + offset) % entries.length;
    if (reviewable(entries[index])) return index;
  }
  return -1;
}

export function parseReviewNumber(value) {
  if (value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function extractedPurchaseOrderNumber(draft) {
  return String(draft?.purchaseOrderNumber?.value || "").trim();
}

export function suggestedAllocationPlan(suggestion) {
  if (suggestion?.kind !== "suggestions") return [];
  return (suggestion.candidates || []).map((entry) => ({
    invoiceLineIndex: Number(entry.invoiceLineIndex),
    purchaseLineId: entry.purchaseLineId,
    quantity: Number(entry.quantity),
  }));
}

export function initialInvoicePostingSelection(suggestion, draft) {
  const hasExtractedPurchaseOrder = Boolean(extractedPurchaseOrderNumber(draft));
  if (suggestion?.kind === "none" && suggestion.reason === "no_purchase_order" && !hasExtractedPurchaseOrder) {
    return { postingRoute: "no_purchase_order", allocationPlan: [], noPurchaseOrderReason: "" };
  }
  return { postingRoute: "", allocationPlan: [], noPurchaseOrderReason: "" };
}

export function invoicePostingSelectionReady(selection, suggestion, draft) {
  if (!suggestion || suggestion.kind === "review_required") return false;
  if (selection?.postingRoute === "purchase_order") {
    return suggestion.kind === "suggestions" && suggestedAllocationPlan(suggestion).length > 0 && selection.allocationPlan?.length === suggestedAllocationPlan(suggestion).length;
  }
  if (selection?.postingRoute !== "no_purchase_order") return false;
  return Boolean(String(selection.noPurchaseOrderReason || "").trim());
}

export function invoicePostingPayload(selection) {
  return {
    postingRoute: selection.postingRoute,
    allocationPlan: selection.postingRoute === "purchase_order" ? selection.allocationPlan : [],
    noPurchaseOrderReason: selection.postingRoute === "no_purchase_order" ? String(selection.noPurchaseOrderReason || "").trim() : "",
  };
}
