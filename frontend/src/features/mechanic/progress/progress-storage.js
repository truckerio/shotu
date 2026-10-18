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
      concern: Object.hasOwn(value, "concern") ? String(value.concern ?? "") : null,
      diagnosis: String(value.diagnosis || ""),
      workPerformed: String(value.workPerformed || ""),
      laborHours: Object.hasOwn(value, "laborHours") ? String(value.laborHours || "") : null,
      expectedVersion: Number.isInteger(value.expectedVersion) ? value.expectedVersion : null,
      savedAt: value.savedAt || null,
    };
  } catch {
    return null;
  }
}

export function writeProgressBackup(actorId, workorderId, value, expectedVersion = null) {
  if (!actorId || !workorderId || typeof window === "undefined") return;
  removeLegacyMechanicWorkStorage();
  window.localStorage.setItem(mechanicWorkStorageKey("progress", actorId, workorderId), JSON.stringify({
    ...(value.concern === undefined ? {} : { concern: String(value.concern ?? "") }),
    diagnosis: String(value.diagnosis || ""),
    workPerformed: String(value.workPerformed || ""),
    laborHours: String(value.laborHours || ""),
    expectedVersion,
    savedAt: new Date().toISOString(),
  }));
}

export function clearProgressBackup(actorId, workorderId) {
  if (!actorId || !workorderId || typeof window === "undefined") return;
  window.localStorage.removeItem(mechanicWorkStorageKey("progress", actorId, workorderId));
}

export function mechanicProgressRecoveryConflict(backup, currentVersion) {
  if (!backup) return false;
  if (backup.expectedVersion == null) return backup.concern != null;
  return Number(backup.expectedVersion) !== Number(currentVersion);
}

export function mechanicProgressRecoveryPatch(backup, allowedActions = {}, currentVersion) {
  if (!backup || mechanicProgressRecoveryConflict(backup, currentVersion)) return {};
  return {
    ...(allowedActions.saveNotes ? {
      diagnosis: backup.diagnosis,
      workPerformed: backup.workPerformed,
      ...(backup.laborHours == null ? {} : { laborHours: backup.laborHours }),
    } : {}),
    ...(allowedActions.saveConcern && backup.concern != null ? { mechanicConcern: backup.concern } : {}),
  };
}
