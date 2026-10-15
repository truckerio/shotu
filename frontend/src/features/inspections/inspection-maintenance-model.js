export const MAINTENANCE_LABELS = Object.freeze({
  upcoming: "Upcoming", due_soon: "Due soon — consider this visit", due: "Due for review",
  overdue: "Overdue", needs_reading: "Mileage needs verification", repair_planned: "Repair planned",
  verification_required: "Repair completed — verify resolution",
});

export function emptyDeferral() {
  return { reason: "", nextVisit: true, dueDate: null, dueMiles: null, baselineMiles: null, additionalMiles: null, earlyMiles: 200 };
}

function numberOrNull(value) {
  return value === "" || value == null ? null : Number(value);
}

export function deferralPayload(value = {}) {
  const baselineMiles = numberOrNull(value.baselineMiles);
  const additionalMiles = numberOrNull(value.additionalMiles);
  const dueMiles = baselineMiles !== null && additionalMiles !== null ? Math.round((baselineMiles + additionalMiles) * 10) / 10 : numberOrNull(value.dueMiles);
  return {
    reason: String(value.reason || "").trim(), nextVisit: value.nextVisit === true,
    dueDate: value.dueDate || null, dueMiles,
    baselineMiles, additionalMiles,
    earlyMiles: numberOrNull(value.earlyMiles) ?? 200,
  };
}

export function deferralIsComplete(value = {}, unitType = "Truck") {
  if (value.dueMiles === "" || value.additionalMiles === "" || (value.additionalMiles != null && value.baselineMiles === "")) return false;
  const policy = deferralPayload(value);
  if (policy.reason.length < 2 || policy.reason.length > 2000) return false;
  if (!Number.isFinite(policy.earlyMiles) || policy.earlyMiles < 0 || policy.earlyMiles > 10000) return false;
  if (policy.dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(policy.dueDate)) return false;
  if ([policy.dueMiles, policy.baselineMiles, policy.additionalMiles].some(n => n !== null && (!Number.isFinite(n) || n < 0 || n > 99999999.9))) return false;
  const additional = policy.additionalMiles !== null;
  if (additional && (policy.additionalMiles <= 0 || policy.baselineMiles === null)) return false;
  if (unitType === "Trailer" && (policy.dueMiles !== null || additional)) return false;
  return policy.nextVisit || Boolean(policy.dueDate) || policy.dueMiles !== null || additional;
}

export function maintenanceEndpoint(kind, id) {
  if (!id) return "";
  const encoded = encodeURIComponent(id);
  if (kind === "inspection") return `/api/inspections/${encoded}/maintenance`;
  if (kind === "workorder") return `/api/inspections/workorders/${encoded}/maintenance`;
  if (kind === "unit") return `/api/vehicles/${encoded}/maintenance`;
  return "";
}

export function maintenanceTriggerLabel(policy = {}) {
  const triggers = [];
  if (policy.nextVisit) triggers.push("Next shop visit");
  if (policy.dueDate) triggers.push(`By ${policy.dueDate}`);
  if (policy.dueMiles != null) triggers.push(`At ${Number(policy.dueMiles).toLocaleString()} mi`);
  else if (policy.additionalMiles != null) triggers.push(`After ${Number(policy.additionalMiles).toLocaleString()} mi`);
  return triggers.join(" · ") + (triggers.length > 1 ? " · whichever comes first" : "");
}
