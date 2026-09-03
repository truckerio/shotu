import { createHash } from "node:crypto";

export const INSPECTION_PRINT_LEGACY_FORMAT = "completed_at_date_empty_object_v1";

export function normalizeInspectionPrintSnapshot(value) {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((entry) => entry === undefined ? null : normalizeInspectionPrintSnapshot(entry));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .map(([key, entry]) => [key, normalizeInspectionPrintSnapshot(entry)]));
  }
  return value;
}

export function canonicalInspectionPrintJson(value) {
  const normalized = normalizeInspectionPrintSnapshot(value);
  if (Array.isArray(normalized)) return `[${normalized.map(canonicalInspectionPrintJson).join(",")}]`;
  if (normalized && typeof normalized === "object") {
    return `{${Object.keys(normalized).sort().map((key) => `${JSON.stringify(key)}:${canonicalInspectionPrintJson(normalized[key])}`).join(",")}}`;
  }
  return JSON.stringify(normalized);
}

export function inspectionPrintSnapshotDigest(value) {
  return createHash("sha256").update(canonicalInspectionPrintJson(value)).digest("hex");
}

function isCanonicalIsoTimestamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
}

export function verifyInspectionPrintSnapshot(snapshot, storedDigest) {
  const normalized = normalizeInspectionPrintSnapshot(snapshot);
  const canonicalDigest = inspectionPrintSnapshotDigest(normalized);
  if (canonicalDigest === storedDigest) return { valid:true, legacy:false, canonicalDigest };

  if (isCanonicalIsoTimestamp(normalized?.completedAt)) {
    const legacyDigest = inspectionPrintSnapshotDigest({ ...normalized, completedAt:{} });
    if (legacyDigest === storedDigest) {
      return { valid:true, legacy:true, legacyFormat:INSPECTION_PRINT_LEGACY_FORMAT, canonicalDigest };
    }
  }

  return { valid:false, legacy:false, canonicalDigest };
}
