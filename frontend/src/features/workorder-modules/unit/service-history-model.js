const HISTORY_STATES = new Set(["ready", "empty", "unlinked", "never_synced", "stale", "unavailable"]);

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function count(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

export function normalizeServiceHistoryResponse(payload = {}) {
  const rawState = text(payload.state).toLowerCase().replace(/-/g, "_");
  const items = list(payload.items).map((item, index) => ({
    id: text(item?.id) || `service-${index}`,
    reference: text(item?.reference) || "Service record",
    source: text(item?.source),
    serviceDate: text(item?.serviceDate || item?.completedAt || item?.date),
    dateKind: text(item?.dateKind),
    concern: text(item?.concern),
    diagnosis: text(item?.diagnosis),
    workPerformed: text(item?.workPerformed || item?.work_performed),
    serviceLines: list(item?.serviceLines).map(text).filter(Boolean),
    parts: list(item?.parts).map((part) => ({
      id: text(part?.id || part?.partId),
      name: text(part?.name || part?.description || part?.partNumber) || "Part",
      quantity: part?.quantity ?? part?.qty ?? "",
    })),
    truncated: Object.fromEntries([
      "reference", "status", "concern", "diagnosis", "workPerformed", "serviceLines", "parts",
    ].map((key) => [key, item?.truncated?.[key] === true])),
  }));
  const requestedState = HISTORY_STATES.has(rawState) ? rawState : "";
  const inferredState = rawState ? "unavailable" : (items.length ? "ready" : "empty");

  return {
    state: requestedState || inferredState,
    unit: payload.unit && typeof payload.unit === "object" ? payload.unit : null,
    summary: {
      historyCount: count(payload.summary?.historyCount ?? payload.historyCount ?? items.length),
      lastCompletedServiceAt: text(payload.summary?.lastCompletedServiceAt),
      latestRecordedServiceAt: text(payload.summary?.latestRecordedServiceAt),
    },
    freshness: {
      state: text(payload.freshness?.state).toLowerCase().replace(/-/g, "_"),
      lastSucceededAt: text(payload.freshness?.lastSucceededAt),
      warning: text(payload.freshness?.warning),
    },
    items,
    nextCursor: text(payload.nextCursor),
  };
}

export function serviceHistoryStatus(history) {
  if (!history) return { title: "Loading service history", message: "" };
  if (history.state === "unlinked") return { title: "Unit not matched", message: "This unit is not linked to an Odoo vehicle yet." };
  if (history.state === "never_synced") return { title: "Service history has not been synced", message: "Try again later or ask an admin to check the integration." };
  if (history.state === "stale") return { title: "History may be outdated", message: history.freshness.warning || "The latest available service history is shown." };
  if (history.state === "unavailable") return { title: "Service history is unavailable", message: history.freshness.warning || "Try again." };
  if (history.state === "empty") return { title: "No previous service found", message: "History is synchronized, but no earlier records exist for this unit." };
  return { title: "Service history", message: "" };
}

export function serviceHistoryDateLabel(dateKind) {
  return ({
    verified_completed: "Completed",
    work_done: "Work done",
    recorded: "Recorded",
    scheduled: "Scheduled",
  })[text(dateKind).toLowerCase()] || "Service date";
}

export function serviceHistorySourceLabel(source) {
  return ({
    odoo: "Odoo service order",
    local: "Local workorder",
  })[text(source).toLowerCase()] || text(source);
}

export function formatServiceHistoryDate(value) {
  if (!value) return "Date not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date);
}

export function serviceHistorySummaryLabel(history) {
  if (!history) return "Loading previous service";
  if (history.state === "unlinked" || history.state === "never_synced" || history.state === "unavailable") return serviceHistoryStatus(history).title;
  if (history.summary.lastCompletedServiceAt) {
    return `Last completed service · ${formatServiceHistoryDate(history.summary.lastCompletedServiceAt)}`;
  }
  if (history.summary.latestRecordedServiceAt) {
    return `Latest service record · ${formatServiceHistoryDate(history.summary.latestRecordedServiceAt)}`;
  }
  return history.state === "stale" ? "History may be outdated" : "No previous service found";
}
