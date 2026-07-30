const STORAGE_PREFIX = "shotu:office-workorder-edit:";

function browserStorage() {
  return typeof window === "undefined" ? null : window.localStorage;
}

function identifier(value, label) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new TypeError(`${label} is required.`);
  return encodeURIComponent(normalized);
}

export function officeWorkorderEditStorageKey(actorId, workorderId) {
  return `${STORAGE_PREFIX}${identifier(actorId, "Actor ID")}:${identifier(workorderId, "Workorder ID")}`;
}

export function readOfficeWorkorderEditBackup(actorId, workorderId, storage = browserStorage()) {
  if (!storage || !actorId || !workorderId) return null;
  try {
    const value = JSON.parse(storage.getItem(officeWorkorderEditStorageKey(actorId, workorderId)) || "null");
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

export function writeOfficeWorkorderEditBackup(actorId, workorderId, patch, storage = browserStorage()) {
  if (!storage || !actorId || !workorderId || !patch || typeof patch !== "object") return null;
  const current = readOfficeWorkorderEditBackup(actorId, workorderId, storage) || {};
  const next = { ...current, ...patch };
  storage.setItem(officeWorkorderEditStorageKey(actorId, workorderId), JSON.stringify(next));
  return next;
}

export function clearOfficeWorkorderEditBackup(actorId, workorderId, storage = browserStorage()) {
  if (!storage || !actorId || !workorderId) return;
  storage.removeItem(officeWorkorderEditStorageKey(actorId, workorderId));
}
