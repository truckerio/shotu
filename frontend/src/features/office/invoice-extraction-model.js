export const INVOICE_HEADER_FIELDS = Object.freeze([
  ["documentType", "Document type", "select"],
  ["vendorName", "Vendor", "text"],
  ["vendorAccount", "Vendor account", "text"],
  ["invoiceNumber", "Invoice number", "text"],
  ["invoiceDate", "Invoice date", "text"],
  ["purchaseOrderNumber", "PO number", "text", { optional: true, secondary: true }],
  ["currency", "Currency", "text"],
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

export function invoiceReviewErrorMessage(error) {
  const issues = Array.isArray(error?.details?.issues) ? error.details.issues : [];
  const messages = [...new Set(issues.map((issue) => String(issue?.message || "").trim()).filter(Boolean))];
  if (error?.code === "validation_error" && messages.length) return messages.join(" ");
  return error?.message || "The invoice review could not be saved.";
}

export function parseReviewNumber(value) {
  if (value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
