export const DEFAULT_INSPECTION_EARLY_MILES = 200;
export const MAX_INSPECTION_EARLY_MILES = 10_000;

function maintenanceError(code, message) {
  return Object.assign(new Error(message), { code });
}

function optionalMileage(value, field) {
  if (value == null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 99_999_999.9) {
    throw maintenanceError("INSPECTION_DEFERRAL_MILEAGE_INVALID", `${field} must be a valid non-negative mileage.`);
  }
  return Math.round(value * 10) / 10;
}

function validCalendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function canonicalizeInspectionDeferral(value, { unitType } = {}) {
  const input = value || {};
  const reason = String(input.reason || "").trim();
  if (reason.length < 2 || reason.length > 2_000) {
    throw maintenanceError("INSPECTION_DEFERRAL_REASON_REQUIRED", "Explain why this issue can wait.");
  }
  const nextVisit = input.nextVisit === true;
  const dueDate = input.dueDate == null || input.dueDate === "" ? null : String(input.dueDate);
  if (dueDate && !validCalendarDate(dueDate)) {
    throw maintenanceError("INSPECTION_DEFERRAL_DATE_INVALID", "Review date must be a valid calendar date.");
  }
  const baselineMiles = optionalMileage(input.baselineMiles, "Baseline mileage");
  const additionalMiles = optionalMileage(input.additionalMiles, "Additional miles");
  let dueMiles = optionalMileage(input.dueMiles, "Due mileage");
  if (additionalMiles != null) {
    if (additionalMiles <= 0) throw maintenanceError("INSPECTION_DEFERRAL_ADDITIONAL_MILES_INVALID", "Additional miles must be greater than zero.");
    if (baselineMiles == null) throw maintenanceError("INSPECTION_DEFERRAL_BASELINE_REQUIRED", "Confirm current mileage before using an additional-miles trigger.");
    const calculated = Math.round((baselineMiles + additionalMiles) * 10) / 10;
    if (calculated > 99_999_999.9) throw maintenanceError("INSPECTION_DEFERRAL_MILEAGE_INVALID", "Due mileage exceeds the supported range.");
    if (dueMiles != null && dueMiles !== calculated) throw maintenanceError("INSPECTION_DEFERRAL_TARGET_CONFLICT", "Due mileage must match baseline plus additional miles.");
    dueMiles = calculated;
  }
  if (unitType === "Trailer" && (dueMiles != null || baselineMiles != null || additionalMiles != null)) {
    throw maintenanceError("INSPECTION_TRAILER_MILEAGE_UNSUPPORTED", "Trailer deferrals support next visit or date only.");
  }
  if (!nextVisit && !dueDate && dueMiles == null) {
    throw maintenanceError("INSPECTION_DEFERRAL_TRIGGER_REQUIRED", "Choose next shop visit, a date, or a mileage target.");
  }
  const earlyMiles = input.earlyMiles == null ? DEFAULT_INSPECTION_EARLY_MILES : input.earlyMiles;
  if (typeof earlyMiles !== "number" || !Number.isFinite(earlyMiles) || earlyMiles < 0 || earlyMiles > MAX_INSPECTION_EARLY_MILES) {
    throw maintenanceError("INSPECTION_DEFERRAL_EARLY_WINDOW_INVALID", `Early mileage must be between 0 and ${MAX_INSPECTION_EARLY_MILES}.`);
  }
  const reviewedAt = input.reviewedAt == null ? null : new Date(input.reviewedAt);
  if (reviewedAt && !Number.isFinite(reviewedAt.getTime())) throw maintenanceError("INSPECTION_DEFERRAL_REVIEW_TIME_INVALID", "Deferral review time is invalid.");
  return {
    reason,
    nextVisit,
    dueDate,
    dueMiles,
    baselineMiles: additionalMiles == null ? (baselineMiles ?? null) : baselineMiles,
    additionalMiles,
    earlyMiles: Math.round(earlyMiles * 10) / 10,
    ...(reviewedAt ? { reviewedAt:reviewedAt.toISOString() } : {}),
  };
}

export function shopCalendarDate(now = new Date(), timeZone = "America/Los_Angeles") {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year:"numeric", month:"2-digit", day:"2-digit" }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function evaluateInspectionMaintenance({ deferral, mileage, now = new Date(), timeZone, visitStartedAt = null, sourceCompletedAt = null, workorderStatus = null }) {
  const policy = canonicalizeInspectionDeferral(deferral);
  if (workorderStatus && workorderStatus !== "cancelled") {
    if (["closed", "odoo_entered"].includes(workorderStatus)) return { dueState:"verification_required", remainingMiles:null };
    return { dueState:"repair_planned", remainingMiles:null };
  }
  const states = [];
  const today = shopCalendarDate(now, timeZone);
  if (policy.dueDate) states.push(today > policy.dueDate ? "overdue" : today === policy.dueDate ? "due" : "upcoming");
  if (policy.nextVisit) {
    const visit = visitStartedAt ? new Date(visitStartedAt).getTime() : Number.NaN;
    const reviewedAt = policy.reviewedAt || sourceCompletedAt;
    const opened = reviewedAt ? new Date(reviewedAt).getTime() : Number.NaN;
    states.push(Number.isFinite(visit) && Number.isFinite(opened) && visit > opened ? "due" : "upcoming");
  }
  let remainingMiles = null;
  if (policy.dueMiles != null) {
    if (!mileage || mileage.miles == null) {
      states.push("needs_reading");
    } else {
      remainingMiles = Math.round((policy.dueMiles - Number(mileage.miles)) * 10) / 10;
      if (remainingMiles <= 0) states.push(remainingMiles < 0 ? "overdue" : "due");
      else if (mileage.state !== "fresh") states.push("needs_reading");
      else states.push(remainingMiles <= policy.earlyMiles ? "due_soon" : "upcoming");
    }
  }
  for (const state of ["overdue", "due", "due_soon", "needs_reading", "upcoming"]) if (states.includes(state)) return { dueState:state, remainingMiles };
  return { dueState:"upcoming", remainingMiles };
}
