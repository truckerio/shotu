export function activeWorkorderForVehicle(vehicle = {}) {
  return vehicle.active_workorder || vehicle.activeWorkorder || null;
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
