export const WORKORDER_ACTIVITY_STATUSES = Object.freeze([
  Object.freeze({ value: "ready", label: "Ready to start" }),
  Object.freeze({ value: "active", label: "Active" }),
  Object.freeze({ value: "on_hold", label: "On hold" }),
  Object.freeze({ value: "waiting_parts", label: "Waiting for parts" }),
  Object.freeze({ value: "waiting_office", label: "Waiting for office" }),
]);

const STATUS_LABELS = new Map(WORKORDER_ACTIVITY_STATUSES.map((entry) => [entry.value, entry.label]));

export function normalizeWorkLogView(value = {}) {
  const statusOptions = Array.isArray(value.statusOptions) && value.statusOptions.length
    ? value.statusOptions.map((entry) => {
      const status = typeof entry === "string" ? entry : entry?.value || entry?.id || "";
      return {
        value: status,
        label: typeof entry === "object" && entry?.label ? entry.label : STATUS_LABELS.get(status) || status,
      };
    }).filter((entry) => entry.value)
    : WORKORDER_ACTIVITY_STATUSES;
  return {
    activityStatus: value.activityStatus || statusOptions[0]?.value || "ready",
    version: Number(value.version) || 1,
    canChangeStatus: value.canChangeStatus === true,
    canLogLabor: value.canLogLabor === true,
    canManageLabor: value.canManageLabor === true,
    entries: Array.isArray(value.entries) ? value.entries : [],
    totalHours: Number(value.totalHours) || 0,
    statusOptions,
  };
}

export function laborEntryCanEdit(view, entry, actorId) {
  return Boolean(view?.canManageLabor || (
    view?.canLogLabor
    && actorId
    && (entry?.mechanicUserId === actorId || entry?.mechanicId === actorId)
  ));
}

export function laborCorrectionNeedsReason(view, entry, actorId) {
  return laborEntryCanEdit(view, entry, actorId);
}

export function workLogRequestError(error, fallback = "Work log is unavailable.") {
  if (error?.status === 409) return "This work log changed elsewhere. Refresh it and try again.";
  return error?.message || fallback;
}

export function todayInputValue(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}
