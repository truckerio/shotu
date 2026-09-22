import {
  lockEligibleExactInventoryPosition,
  pickExactInventoryUnitFromPosition,
  returnExactInventoryUnitToPosition,
} from "./inventory-positions.repo.js";

export async function assertExactUnitHasReservablePosition(client, { companyId, locationId, unitId }) {
  return Boolean(await lockEligibleExactInventoryPosition(client, { companyId, locationId, unitId }));
}

export async function pickExactUnitForWorkorderInstallation(client, {
  companyId, locationId, catalogPartId, uomCode, unitId, actorId, usageId, workorderId,
}) {
  return pickExactInventoryUnitFromPosition(client, {
    companyId,
    locationId,
    catalogPartId,
    uomCode,
    unitId,
    actorId,
    idempotencyKey: `position:exact-pick:${usageId}`,
    workorderId,
    reason: `Exact unit physically fitted on workorder ${workorderId}`,
  });
}

export async function returnExactUnitFromReuseToPosition(client, {
  companyId, locationId, catalogPartId, uomCode, unitId, actorId, caseId, workorderId, targetPositionId,
}) {
  return returnExactInventoryUnitToPosition(client, {
    companyId,
    locationId,
    catalogPartId,
    uomCode,
    unitId,
    actorId,
    idempotencyKey: `position:reuse-release:${caseId}`,
    workorderId,
    reason: `Accepted exact-unit return from reuse case ${caseId}`,
    targetPositionId,
    commandType: "reuse_release",
  });
}
