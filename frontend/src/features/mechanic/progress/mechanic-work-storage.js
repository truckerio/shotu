const STORAGE_PREFIX = "shotu:mechanic-work:";
const LEGACY_PREFIXES = [
  "shotu:mechanic-progress:",
  "workorder-used-parts:",
];

function browserStorage() {
  return typeof window === "undefined" ? null : window.localStorage;
}

function encodedIdentifier(value, name) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new TypeError(`${name} is required.`);
  return encodeURIComponent(normalized);
}

export function mechanicWorkStorageKey(kind, actorId, workorderId) {
  return [
    STORAGE_PREFIX,
    encodedIdentifier(kind, "Storage kind"),
    ":",
    encodedIdentifier(actorId, "Actor ID"),
    ":",
    encodedIdentifier(workorderId, "Workorder ID"),
  ].join("");
}

export function removeLegacyMechanicWorkStorage(storage = browserStorage()) {
  if (!storage) return 0;
  const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index))
    .filter(Boolean);
  let removed = 0;
  for (const key of keys) {
    if (!LEGACY_PREFIXES.some((prefix) => key.startsWith(prefix))) continue;
    storage.removeItem(key);
    removed += 1;
  }
  return removed;
}

export function purgeMechanicWorkStorage(storage = browserStorage()) {
  if (!storage) return 0;
  const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index))
    .filter(Boolean);
  let removed = 0;
  for (const key of keys) {
    if (!key.startsWith(STORAGE_PREFIX) && !LEGACY_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      continue;
    }
    storage.removeItem(key);
    removed += 1;
  }
  return removed;
}

export { STORAGE_PREFIX as MECHANIC_WORK_STORAGE_PREFIX };
