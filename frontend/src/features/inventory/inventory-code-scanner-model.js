import { inventoryCameraAvailable } from "./inventory-camera-scanner.js";

export function normalizeInventoryCode(value) {
  return String(value || "").trim();
}

export function inventoryScannerAvailable(environment = globalThis) {
  return inventoryCameraAvailable(environment);
}

export function inventoryUsageStatusLabel(status) {
  return {
    issued: "Reserved",
    reserved: "Reserved — awaiting Office approval",
    installed_pending_approval: "Installed — awaiting Office approval",
    installed: "Installed",
    consumed: "Consumed after Office approval",
    returned: "Returned unused",
    removed: "Removed — inspection required",
    removed_inspection_required: "Removed — inspection required",
    inspection_required: "Removed — inspection required",
  }[status] || String(status || "").replaceAll("_", " ");
}

export function inventoryUsageActions(usage) {
  const status = String(usage?.status || "").trim();
  const allowed = usage?.allowedActions || {};
  return {
    install: allowed.install ?? usage?.canInstall ?? ["issued", "reserved"].includes(status),
    returnUnused: allowed.returnUnused ?? usage?.canReturnUnused ?? ["issued", "reserved"].includes(status),
    remove: allowed.remove ?? usage?.canRemove ?? ["installed_pending_approval", "installed"].includes(status),
  };
}

export function replaceUsage(usages, nextUsage) {
  const current = Array.isArray(usages) ? usages : [];
  if (!nextUsage?.id) return current;
  const found = current.some((usage) => usage.id === nextUsage.id);
  return found
    ? current.map((usage) => (usage.id === nextUsage.id ? nextUsage : usage))
    : [nextUsage, ...current];
}

export function shouldApplyUsageSnapshot({
  requestGeneration,
  currentGeneration,
  requestRevision,
  currentRevision,
}) {
  return requestGeneration === currentGeneration && requestRevision === currentRevision;
}

export function mergeUsageSnapshot(currentUsages, snapshotUsages, limit = 100) {
  const current = Array.isArray(currentUsages) ? currentUsages : [];
  const snapshot = Array.isArray(snapshotUsages) ? snapshotUsages : [];
  const currentIds = new Set(current.map((usage) => usage?.id).filter(Boolean));
  return [...current, ...snapshot.filter((usage) => usage?.id && !currentIds.has(usage.id))].slice(0, limit);
}

export function enqueuePendingCandidate(currentCandidates, candidate) {
  const current = Array.isArray(currentCandidates) ? currentCandidates : [];
  const unitId = candidate?.unit?.id;
  if (!unitId) return { candidates: current, selectedId: null, added: false };
  const existing = current.find((item) => item?.unit?.id === unitId);
  if (existing) return { candidates: current, selectedId: existing.unit.id, added: false };
  return {
    candidates: [...current, candidate],
    selectedId: unitId,
    added: true,
  };
}

export function removePendingCandidate(currentCandidates, unitId) {
  const current = Array.isArray(currentCandidates) ? currentCandidates : [];
  return current.filter((candidate) => candidate?.unit?.id !== unitId);
}
