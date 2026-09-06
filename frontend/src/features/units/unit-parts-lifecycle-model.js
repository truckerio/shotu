export function reuseScope(unit) {
  return {
    companyId: unit?.companyId || unit?.company_id || "",
    locationId: unit?.custodyLocationId || unit?.custody_location_id || unit?.locationId || unit?.location_id || "",
  };
}

export function assetReusePath(assetId, scope) {
  const params = new URLSearchParams({ companyId: scope.companyId, locationId: scope.locationId });
  return `/api/inventory-reuse/asset/${encodeURIComponent(assetId)}?${params}`;
}

export function reuseOperationPath(key, scope) {
  const params = new URLSearchParams({ companyId: scope.companyId, locationId: scope.locationId });
  return `/api/inventory-reuse/operations/${encodeURIComponent(key)}?${params}`;
}

export function lifecycleIdempotencyKey(keys, identity) {
  if (!keys.has(identity)) keys.set(identity, crypto.randomUUID());
  return keys.get(identity);
}

export function reuseRecoveryKey({ actorId, companyId, locationId, assetId }) {
  return `inventory-reuse-recovery:${actorId}:${companyId}:${locationId}:${assetId}`;
}

export function saveReuseRecovery(storage, scope, command) {
  try { storage?.setItem(reuseRecoveryKey(scope), JSON.stringify({ scope, command })); return true; }
  catch { return false; }
}

export function readReuseRecovery(storage, scope) {
  try {
    const raw = storage?.getItem(reuseRecoveryKey(scope));
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (!saved?.command?.path || !saved?.command?.body || Object.entries(scope).some(([key, value]) => saved.scope?.[key] !== value)) return null;
    return saved.command;
  } catch { return null; }
}

export function clearReuseRecovery(storage, scope) {
  try { storage?.removeItem(reuseRecoveryKey(scope)); return true; }
  catch { return false; }
}

export function restoreReuseRecovery(storage, scope, restoredKeys) {
  const key = reuseRecoveryKey(scope);
  if (restoredKeys?.has(key)) return null;
  restoredKeys?.add(key);
  return readReuseRecovery(storage, scope);
}
