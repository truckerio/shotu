export const INBOUND_VIEWS = [
  { id: "my_work", label: "My work" },
  { id: "expected", label: "Expected" },
  { id: "attention", label: "Needs attention" },
  { id: "complete", label: "Complete" },
];

export function inboundRequestUrl({ view, locationId, query, page = 1 }) {
  const params = new URLSearchParams({ view, page: String(page) });
  if (locationId) params.set("locationId", locationId);
  if (query?.trim()) params.set("q", query.trim());
  return `/api/office/inventory/inbound?${params}`;
}

export function inboundCount(counts, view) {
  const key = view === "my_work" ? "myWork" : view;
  return Number(counts?.[key] ?? counts?.[view] ?? 0);
}

export function inboundReference(item) {
  if (item.kind === "invoice_intake") return item.invoiceNumber ? `Invoice ${item.invoiceNumber}` : "Invoice upload";
  if (item.kind === "invoice" && item.nextAction === "resolve_no_po") {
    return item.poNumber ? `PO reference ${item.poNumber} · Needs resolution` : "PO decision needed";
  }
  if (item.poNumber) return `PO ${item.poNumber}`;
  if (item.noPoUsed) return item.noPoReason ? `No PO used · ${item.noPoReason}` : "No PO used";
  return "No PO used";
}

export function inboundProgress(item) {
  if (item.kind === "invoice_intake" || item.invoiceStatus) {
    return {
      added: "Inventory entry completed",
      reviewed: "Ready for inventory review",
      needs_review: "Review extracted fields",
      processing: "Extraction in progress",
      reversed: "Inventory entry reversed",
      failed: "Open to retry extraction",
    }[String(item.invoiceStatus || "").toLowerCase()] || "Invoice uploaded";
  }
  const units = item.uomCodes?.filter(Boolean) || [];
  if (units.length > 1) return `${units.length} unit types`;
  const unit = units.length === 1 ? ` ${units[0]}` : "";
  if (item.kind === "invoice" && !item.expectedQuantity) return "Ready for receiving review";
  return `${Number(item.receivedQuantity || 0)} received of ${Number(item.expectedQuantity || 0)}${unit}`;
}

export function inboundInvoiceStatus(status) {
  return {
    added: "Added to inventory",
    reviewed: "Ready to add",
    needs_review: "Needs review",
    processing: "Extracting",
    reversed: "Reversed",
    failed: "Extraction failed",
  }[String(status || "").toLowerCase()] || "Invoice uploaded";
}

export function inboundStatus(item) {
  if (item.kind === "invoice_intake" || item.invoiceStatus) return inboundInvoiceStatus(item.invoiceStatus);
  if (item.nextAction === "receive_goods") return "Awaiting receipt";
  if (item.nextAction === "resolve_no_po") return "PO decision needed";
  if (item.nextAction === "review_invoice") return "Invoice needed";
  if (item.nextAction === "review_exception") return "Needs attention";
  return "Complete";
}

export function inboundAction(item) {
  const action = String(item.nextAction || "").toLowerCase();
  if (item.invoiceRunId && ["added", "reversed"].includes(String(item.invoiceStatus || "").toLowerCase())) return { id: "invoice", label: "Open invoice" };
  if (item.kind === "invoice_intake") {
    if (["reviewed", "needs_review", "failed", "added", "reversed"].includes(action)) return { id: "invoice", label: action === "reviewed" ? "Add inventory" : "Open invoice" };
    return null;
  }
  if (action === "receive_goods" && item.poId) return { id: "purchase_order", label: "Receive PO" };
  if (["receive_invoice", "resolve_no_po"].includes(action) && item.invoiceRunId) return { id: "invoice", label: "Open invoice" };
  if (action === "review_invoice") return { id: "invoice_upload", label: "Upload invoice" };
  return null;
}

export function inboundActionLabel(value) {
  if (["added", "reviewed", "needs_review", "processing", "reversed", "failed"].includes(String(value || "").toLowerCase())) return inboundInvoiceStatus(value);
  return String(value || "No action").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
