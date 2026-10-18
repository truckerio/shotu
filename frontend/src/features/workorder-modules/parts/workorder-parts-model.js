import { WORKORDER_MODULE_ACCESS } from "../workorder-module-registry.js";

export function canScanWorkorderParts(detail, isMechanicDetail, actorId = "") {
  const access = detail?.moduleAccess?.partsScanning?.access;
  const writable = access === WORKORDER_MODULE_ACCESS.WRITE
    || access === WORKORDER_MODULE_ACCESS.REQUIRED;
  if (!writable || !isMechanicDetail) return writable;

  const workorder = detail?.workorder;
  const assignedIds = Array.isArray(workorder?.mechanicIds)
    ? workorder.mechanicIds
    : Array.isArray(workorder?.mechanics)
      ? workorder.mechanics.map((mechanic) => mechanic.id)
      : workorder?.mechanic?.id ? [workorder.mechanic.id] : [];
  return Boolean(actorId) && assignedIds.includes(actorId);
}
