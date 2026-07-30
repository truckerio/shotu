export const OFFICE_PRIMARY_TABS = Object.freeze([
  { key: "needs", label: "Needs action" },
  { key: "active", label: "In progress" },
  { key: "doneOdoo", label: "Done / Odoo" },
]);

export const OFFICE_SECONDARY_TAB_KEYS = Object.freeze([
  "open",
  "parts",
  "drafts",
  "all",
  "closed",
]);

export const OFFICE_ATTENTION_LABELS = Object.freeze({
  missing_info: "Surveillance needs information",
  revision_requested: "Changes requested from mechanic",
});

export function officeAttentionReasons(row) {
  if (Array.isArray(row?.attentionReasons)) return row.attentionReasons;
  if (row?.status === "parts_requested") return ["parts"];
  if (row?.status === "waiting_office") return ["office_help"];
  return [];
}

export function officeLifecycle(row) {
  if (row?.lifecycle) return row.lifecycle;
  return ["parts_requested", "waiting_office"].includes(row?.status) ? "in_progress" : row?.status;
}

export function needsOfficeAction(row) {
  const reasons = officeAttentionReasons(row);
  return officeLifecycle(row) === "open"
    || officeLifecycle(row) === "mechanic_done"
    || reasons.some((reason) => [
      "parts",
      "office_help",
      "missing_info",
      "revision_requested",
      "overdue",
    ].includes(reason));
}

export function officeUrgency(row) {
  const reasons = officeAttentionReasons(row);
  if (reasons.includes("missing_info")) return 0;
  if (reasons.includes("revision_requested")) return 1;
  if (reasons.includes("overdue")) return 2;
  if (reasons.includes("parts") || reasons.includes("office_help")) return 3;
  if (officeLifecycle(row) === "mechanic_done") return 4;
  if (officeLifecycle(row) === "open") return 5;
  return 6;
}

export function officeHandoffSummary(row) {
  const reasons = officeAttentionReasons(row);
  const reason = ["missing_info", "revision_requested"].find((candidate) => reasons.includes(candidate));
  if (!reason) return null;
  const details = row?.attentionDetails?.[reason] || row?.attentionDetail?.[reason] || {};
  const note = details.note || row?.attentionNotes?.[reason] || "";
  return { reason, label: OFFICE_ATTENTION_LABELS[reason], note };
}

export function officeRowsForTab(activeTab, dashboard, allRows, needsRows) {
  if (activeTab === "needs") return needsRows;
  if (activeTab === "all") return allRows;
  if (activeTab === "doneOdoo") {
    const seen = new Set();
    return [...(dashboard?.done || []), ...(dashboard?.closed || [])].filter((row) => {
      if (!row || seen.has(row.id)) return false;
      seen.add(row.id);
      return true;
    });
  }
  return dashboard?.[activeTab] || [];
}
