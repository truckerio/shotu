export function directReceiptApprovalUrl(requestId) {
  return `/api/office/inventory/direct-receipt-approvals/${encodeURIComponent(requestId)}`;
}

export function directReceiptApprovalDecisionUrl(requestId) {
  return `${directReceiptApprovalUrl(requestId)}/decision`;
}

export function directReceiptApprovalDecision(action, detail, reason = "") {
  return { action, expectedVersion: Number(detail?.approvalRequest?.version), reason: String(reason || "").trim() };
}

export function directReceiptApprovalStatus(status) {
  return ({ pending: "Approval needed", approved: "Approved", rejected: "Rejected", cancelled: "Cancelled" })[status] || "Approval request";
}

export function directReceiptApprovalPresentation(detail) {
  const held = detail?.arrival?.disposition === "held";
  return held ? {
    held: true,
    dispositionLabel: "Held for inspection",
    confirmationLabel: "Goods received and placed on hold",
    destinationLabel: "Not applicable — held for inspection",
    successHeading: "Held for inspection",
    successNotice: "Arrival approved and entered the damage inspection workflow.",
  } : {
    held: false,
    dispositionLabel: "Available for use",
    confirmationLabel: "Goods physically received",
    destinationLabel: detail?.destination?.path || "No storage position",
    successHeading: "Stock received",
    successNotice: "Arrival approved and usable stock received.",
  };
}

export function directReceiptApprovalCost(value, currency = "USD") {
  if (value === null || value === undefined || value === "") return "Not provided";
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "Not provided";
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount);
}

export function isDirectReceiptApprovalRefreshError(error) {
  return ["INVENTORY_DIRECT_RECEIPT_APPROVAL_STALE", "INVENTORY_CATALOG_PART_CHANGED", "INVENTORY_RECEIPT_POSITION_INVALID"].includes(error?.code);
}
