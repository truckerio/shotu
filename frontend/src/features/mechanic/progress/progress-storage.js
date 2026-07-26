const STORAGE_PREFIX = "shotu:mechanic-progress:";

function storageKey(workorderId) {
  return `${STORAGE_PREFIX}${workorderId}`;
}

export function readProgressBackup(workorderId) {
  if (!workorderId || typeof window === "undefined") return null;
  try {
    const value = JSON.parse(window.localStorage.getItem(storageKey(workorderId)) || "null");
    if (!value || typeof value !== "object") return null;
    return {
      diagnosis: String(value.diagnosis || ""),
      workPerformed: String(value.workPerformed || ""),
      savedAt: value.savedAt || null,
    };
  } catch {
    return null;
  }
}

export function writeProgressBackup(workorderId, value) {
  if (!workorderId || typeof window === "undefined") return;
  window.localStorage.setItem(storageKey(workorderId), JSON.stringify({
    diagnosis: String(value.diagnosis || ""),
    workPerformed: String(value.workPerformed || ""),
    savedAt: new Date().toISOString(),
  }));
}

export function clearProgressBackup(workorderId) {
  if (!workorderId || typeof window === "undefined") return;
  window.localStorage.removeItem(storageKey(workorderId));
}
