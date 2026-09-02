export function activeWorkorderForVehicle(vehicle) {
  return vehicle?.active_workorder || vehicle?.activeWorkorder || null;
}

export function vehicleHasActiveWorkorder(vehicle) {
  return Boolean(activeWorkorderForVehicle(vehicle)?.id);
}

export function vehicleCanBeSelected(vehicle, currentWorkorderId = "") {
  const activeWorkorder = activeWorkorderForVehicle(vehicle);
  return !activeWorkorder?.id || activeWorkorder.id === currentWorkorderId;
}

export function activeWorkorderUnavailableMessage(vehicle) {
  const activeWorkorder = activeWorkorderForVehicle(vehicle);
  const serial = activeWorkorder?.serial || "an active workorder";
  const status = activeWorkorder?.status ? ` (${activeWorkorder.status.replaceAll("_", " ")})` : "";
  return `This unit already has ${serial}${status}. Close or cancel it before creating another workorder.`;
}

export function vehicleSearchResultAction(vehicle = {}) {
  const workorderId = activeWorkorderForVehicle(vehicle)?.id || "";
  return workorderId
    ? { type: "open-workorder", workorderId }
    : { type: "select-vehicle", workorderId: "" };
}

export function moveVehicleSearchResultIndex(currentIndex, resultCount, key) {
  if (!resultCount) return -1;
  if (key === "Home") return 0;
  if (key === "End") return resultCount - 1;
  if (key === "ArrowDown") return currentIndex < 0 ? 0 : Math.min(currentIndex + 1, resultCount - 1);
  if (key === "ArrowUp") return currentIndex < 0 ? resultCount - 1 : Math.max(currentIndex - 1, 0);
  return null;
}
