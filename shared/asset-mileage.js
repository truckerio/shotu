export const ASSET_MILEAGE_FRESHNESS_MS = 24 * 60 * 60 * 1000;
export const ASSET_MILEAGE_FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

export function normalizeMileage(value) {
  if (value === null || value === undefined || typeof value === "boolean" || (typeof value === "string" && value.trim() === "")) return null;
  const miles = Number(value);
  if (!Number.isFinite(miles) || miles < 0 || miles > 10_000_000) return null;
  return Math.round(miles * 10) / 10;
}

export function mileageState({ miles, observedAt, conflict = false, now = new Date() }) {
  if (conflict) return "conflict";
  if (miles == null || !observedAt) return "unknown";
  const observed = new Date(observedAt).getTime();
  if (!Number.isFinite(observed)) return "unknown";
  if (observed > now.getTime() + ASSET_MILEAGE_FUTURE_TOLERANCE_MS) return "unknown";
  return now.getTime() - observed > ASSET_MILEAGE_FRESHNESS_MS ? "stale" : "fresh";
}

export function validateMileageReason(reason) {
  const normalizedReason = String(reason || "").trim();
  if (normalizedReason.length < 3 || normalizedReason.length > 1000) throw Object.assign(new Error("A reason between 3 and 1,000 characters is required."), { code: "ASSET_MILEAGE_REASON_INVALID" });
  return normalizedReason;
}

export function validateManualMileage({ miles, observedAt, reason, currentMiles = null, now = new Date() }) {
  const normalizedMiles = normalizeMileage(miles);
  if (normalizedMiles == null) throw Object.assign(new Error("Mileage must be between 0 and 10,000,000 miles."), { code: "ASSET_MILEAGE_INVALID" });
  const observed = new Date(observedAt);
  if (!observedAt || !Number.isFinite(observed.getTime())) throw Object.assign(new Error("A valid mileage observation time is required."), { code: "ASSET_MILEAGE_TIME_INVALID" });
  if (observed.getTime() > now.getTime() + ASSET_MILEAGE_FUTURE_TOLERANCE_MS) throw Object.assign(new Error("Mileage observation time cannot be in the future."), { code: "ASSET_MILEAGE_TIME_FUTURE" });
  const normalizedReason = validateMileageReason(reason);
  if (currentMiles != null && normalizedMiles + 100 < Number(currentMiles) && !/(correct|odometer\s+(replace|reset)|dashboard\s+verified)/i.test(normalizedReason)) {
    throw Object.assign(new Error("A mileage decrease over 100 miles requires an explicit correction or odometer-replacement reason."), { code: "ASSET_MILEAGE_BACKWARDS" });
  }
  return { miles: normalizedMiles, observedAt: observed.toISOString(), reason: normalizedReason };
}
