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
