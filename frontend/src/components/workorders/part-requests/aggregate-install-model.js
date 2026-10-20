export function canInstallQuantityUsage(usage, editable) {
  return Boolean(editable && usage?.trackingMode === "quantity" && usage.status === "reserved");
}
