import {
  mechanicWorkStorageKey,
  removeLegacyMechanicWorkStorage,
} from "./mechanic-work-storage.js";

export function readProgressBackup(actorId, workorderId) {
  if (!actorId || !workorderId || typeof window === "undefined") return null;
  removeLegacyMechanicWorkStorage();
  try {
    const value = JSON.parse(
      window.localStorage.getItem(mechanicWorkStorageKey("progress", actorId, workorderId)) || "null",
    );
    if (!value || typeof value !== "object") return null;
    return {
      diagnosis: String(value.diagnosis || ""),
      workPerformed: String(value.workPerformed || ""),
      laborHours: Object.hasOwn(value, "laborHours") ? String(value.laborHours || "") : null,
      savedAt: value.savedAt || null,
    };
  } catch {
    return null;
  }
}

export function writeProgressBackup(actorId, workorderId, value) {
  if (!actorId || !workorderId || typeof window === "undefined") return;
  removeLegacyMechanicWorkStorage();
  window.localStorage.setItem(mechanicWorkStorageKey("progress", actorId, workorderId), JSON.stringify({
    diagnosis: String(value.diagnosis || ""),
    workPerformed: String(value.workPerformed || ""),
    laborHours: String(value.laborHours || ""),
    savedAt: new Date().toISOString(),
  }));
}

export function clearProgressBackup(actorId, workorderId) {
  if (!actorId || !workorderId || typeof window === "undefined") return;
  window.localStorage.removeItem(mechanicWorkStorageKey("progress", actorId, workorderId));
}
