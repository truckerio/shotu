export function normalizeInventoryCode(value) {
  return String(value || "").trim();
}

export function inventoryScannerAvailable(environment = globalThis) {
  return Boolean(environment?.BarcodeDetector && environment?.navigator?.mediaDevices?.getUserMedia);
}

export function inventoryUsageStatusLabel(status) {
  return {
    issued: "Awaiting final disposition",
    installed: "Installed",
    returned: "Returned unused",
  }[status] || String(status || "").replaceAll("_", " ");
}

export function replaceUsage(usages, nextUsage) {
  const current = Array.isArray(usages) ? usages : [];
  if (!nextUsage?.id) return current;
  const found = current.some((usage) => usage.id === nextUsage.id);
  return found
    ? current.map((usage) => (usage.id === nextUsage.id ? nextUsage : usage))
    : [nextUsage, ...current];
}
