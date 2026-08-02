export const WORKORDER_LIFECYCLE_LABELS = Object.freeze({
  open: "Open",
  accepted: "Accepted",
  in_progress: "In progress",
  mechanic_done: "Work done",
  closed: "Closed",
  odoo_entered: "Entered in Odoo",
  cancelled: "Cancelled",
});

export const WORKORDER_LIFECYCLES = Object.freeze(Object.keys(WORKORDER_LIFECYCLE_LABELS));

export function formatLifecycleLabel(value, {
  openAsUnassigned = false,
  fallback = "Unknown",
} = {}) {
  const lifecycle = String(value || "").trim();
  if (lifecycle === "open" && openAsUnassigned) return "Unassigned";
  return WORKORDER_LIFECYCLE_LABELS[lifecycle] || fallback;
}

function parseUiDate(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "string") {
    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
    if (dateOnly) {
      const [, year, month, day] = dateOnly.map(Number);
      const date = new Date(year, month - 1, day);
      if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
      return date;
    }
  }
  if (value === null || value === undefined || value === "") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatUiDate(value, { locale, ...options } = {}) {
  const date = parseUiDate(value);
  if (!date) return "";
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
    ...options,
  }).format(date);
}

export function formatUiDateTime(value, { locale, ...options } = {}) {
  const date = parseUiDate(value);
  if (!date) return "";
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    ...options,
  }).format(date);
}

export function formatUiDateRange(startValue, endValue, options = {}) {
  const start = formatUiDate(startValue, options);
  const end = formatUiDate(endValue, options);
  if (!start) return end;
  if (!end || start === end) return start;
  return `${start} – ${end}`;
}
