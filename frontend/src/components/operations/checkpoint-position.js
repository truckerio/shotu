const POSITION_PREFIX = "checkpoint-queue:";

export function readCheckpointPosition(key, storage = globalThis.sessionStorage) {
  try {
    const value = JSON.parse(storage?.getItem(POSITION_PREFIX + key) || "null");
    return value && Number.isInteger(value.page) && value.page > 0 ? value : null;
  } catch {
    return null;
  }
}

export function saveCheckpointPosition(key, position, storage = globalThis.sessionStorage) {
  try { storage?.setItem(POSITION_PREFIX + key, JSON.stringify(position)); } catch { /* Optional navigation memory. */ }
}

export function checkpointPreview(items = []) {
  return items.slice(0, 3).map((item) => [item.serial, item.asset?.unitNo || item.asset?.name, item.concern].filter(Boolean).join(" · "));
}

export function readCheckpointFilters(scope, storage = globalThis.sessionStorage) {
  try {
    const value = JSON.parse(storage?.getItem(`${POSITION_PREFIX}filters:${scope}`) || "null");
    return value && typeof value === "object" ? value : null;
  } catch { return null; }
}

export function saveCheckpointFilters(scope, filters, storage = globalThis.sessionStorage) {
  try { storage?.setItem(`${POSITION_PREFIX}filters:${scope}`, JSON.stringify(filters)); } catch { /* Optional return context. */ }
}
