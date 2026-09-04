export function reuseScope(unit) {
  return {
    companyId: unit?.companyId || unit?.company_id || "",
    locationId: unit?.locationId || unit?.location_id || "",
  };
}

export function assetReusePath(assetId, scope) {
  const params = new URLSearchParams({ companyId: scope.companyId, locationId: scope.locationId });
  return `/api/inventory-reuse/asset/${encodeURIComponent(assetId)}?${params}`;
}

export function caseStage(status) {
  if (status === "awaiting_handoff") return "Receive";
  if (status === "received_pending_review") return "Review";
  if (status === "hold") return "On hold";
  if (status === "released") return "Released to stock";
  return "Pending";
}

export function canReleaseCase(caseItem, capabilities) {
  return Boolean(capabilities?.release && ["received_pending_review", "hold"].includes(caseItem?.status) && caseItem?.ownership === "company");
}

export function reuseOperationPath(key, scope) {
  const params = new URLSearchParams({ companyId: scope.companyId, locationId: scope.locationId });
  return `/api/inventory-reuse/operations/${encodeURIComponent(key)}?${params}`;
}

export function lifecycleIdempotencyKey(keys, identity) {
  if (!keys.has(identity)) keys.set(identity, crypto.randomUUID());
  return keys.get(identity);
}

export function eligibleRemovalWorkorders(part, workorders = []) {
  if (part?.status === "installed_pending_approval") return workorders;
  return workorders.filter((workorder) => workorder.id !== part?.workorderId);
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
