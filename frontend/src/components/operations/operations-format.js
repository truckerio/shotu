import {
  WORKORDER_LIFECYCLES,
  formatLifecycleLabel,
  formatUiDateTime,
} from "../../lib/workorder-presentation.js";

export const OPERATION_CATEGORIES = [
  { id: "needs_attention", label: "Needs attention", countKey: "needsAttention" },
  { id: "unassigned", label: "Unassigned", countKey: "unassigned" },
  { id: "active", label: "Active", countKey: "active" },
  { id: "parts", label: "Parts", countKey: "parts" },
  { id: "ready_review", label: "Ready review", countKey: "readyReview" },
  { id: "drafts", label: "Drafts", countKey: "drafts" },
  { id: "odoo_backlog", label: "Odoo backlog", countKey: "odooBacklog" },
  { id: "all", label: "All", countKey: "all" },
];

export const LIFECYCLE_OPTIONS = [
  ["", "All lifecycle states"],
  ...WORKORDER_LIFECYCLES.map((lifecycle) => [lifecycle, formatLifecycleLabel(lifecycle)]),
];

export const ATTENTION_OPTIONS = [
  ["", "All attention reasons"],
  ["parts", "Parts"],
  ["office_help", "Office help"],
  ["missing_info", "Missing information"],
  ["revision_requested", "Mechanic changes requested"],
  ["overdue", "Overdue"],
];

export const SORT_OPTIONS = [
  ["timeInStatus:desc", "Longest waiting"],
  ["lastActivityAt:desc", "Recent activity"],
  ["lastActivityAt:asc", "Oldest activity"],
  ["createdAt:desc", "Newest created"],
  ["age:desc", "Oldest created"],
];

const attentionLabelLookup = Object.fromEntries(ATTENTION_OPTIONS);

export function operationLabel(value, fallback = "Unknown") {
  return attentionLabelLookup[value] || formatLifecycleLabel(value, { fallback });
}

export function formatDuration(seconds) {
  const total = Math.max(0, Number(seconds) || 0);
  if (total < 60) return "Less than 1 min";
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60 ? `${minutes % 60}m` : ""}`.trim();
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24 ? `${hours % 24}h` : ""}`.trim();
}

export function formatActivity(value) {
  if (!value) return { relative: "No activity", absolute: "" };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { relative: "No activity", absolute: "" };
  const elapsed = Math.max(0, (Date.now() - date.getTime()) / 1000);
  return {
    relative: `${formatDuration(elapsed)} ago`,
    absolute: formatUiDateTime(date),
  };
}

export function buildOperationsQuery(filters, page, pageSize = 50) {
  const [sortBy, sortDirection] = filters.sort.split(":");
  const params = new URLSearchParams({
    category: filters.category,
    page: String(page),
    pageSize: String(pageSize),
    sortBy,
    sortDirection,
  });
  if (filters.locationId) params.set("locationId", filters.locationId);
  if (filters.lifecycle) params.set("lifecycle", filters.lifecycle);
  if (filters.attentionReason) params.set("attentionReason", filters.attentionReason);
  if (filters.search.trim()) params.set("search", filters.search.trim());
  return params;
}

export function normalizeOperationsCategoryFilters(category, filters = {}) {
  const compatibleLifecycle = {
    active: ["accepted", "in_progress", "mechanic_done"],
    odoo_backlog: ["closed"],
    ready_review: ["mechanic_done"],
    unassigned: ["open"],
  }[category];
  const lifecycle = String(filters.lifecycle || "");
  return {
    ...filters,
    category,
    lifecycle: lifecycle && compatibleLifecycle && !compatibleLifecycle.includes(lifecycle)
      ? ""
      : lifecycle,
  };
}
