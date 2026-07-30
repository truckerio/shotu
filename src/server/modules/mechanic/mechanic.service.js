import {
  acceptOperationalWorkorder,
  createOperationalWorkorder,
  markOperationalWorkorderDone,
  releaseOperationalWorkorder,
  updateMechanicUsedParts,
  WorkorderLifecycleConflictError,
} from "../../db/repositories/operational-workorders.repo.js";
import { createPartRequest, updatePartUsage } from "../../db/repositories/part-requests.repo.js";
import { getUserById, listUsersByRole } from "../../db/repositories/users.repo.js";
import {
  getLocationWorkorderPolicy,
  getWorkorderMechanicPartsPolicy,
} from "../../db/repositories/workorder-policies.repo.js";
import {
  WORKORDER_STATUS,
} from "../workorders/workorder.constants.js";
import { MECHANIC_HISTORY_LIFECYCLES } from "../workorders/workorder-lifecycle-policy.js";
import { statusLabel } from "../workorders/workorder.presenter.js";
import { loadWorkorderDetail } from "../workorders/workorder-detail.service.js";
import { queryAuthorizedWorkorders } from "../workorders/workorder-operations.service.js";
import { processMechanicChatMessage } from "../chat/mechanic-chat.service.js";
import { markWorkorderRead } from "../../db/repositories/workorder-attention.repo.js";
import {
  WorkorderProgressConflictError,
  saveMechanicWorkorderProgress as persistMechanicWorkorderProgress,
} from "../../db/repositories/workorder-progress.repo.js";
import { AuthError, resourceNotFound } from "../../auth/errors.js";

async function requireMechanic(userId) {
  const user = await getUserById(userId);
  if (!user || user.role !== "mechanic" || !user.active) throw new Error("Mechanic user not found.");
  return user;
}

export async function defaultMechanicUser() {
  const users = await listUsersByRole("mechanic");
  return users[0] || null;
}

function dashboardOperation(item, compatibilityStatus = item.lifecycle) {
  return {
    id: item.id,
    serial: item.serial,
    assetLabel: item.asset?.unitNo || item.asset?.name || "No unit selected",
    assetUnitNo: item.asset?.unitNo || item.asset?.name || "",
    concern: item.concern,
    status: compatibilityStatus,
    lifecycle: item.lifecycle,
    statusLabel: statusLabel(compatibilityStatus),
    attentionReasons: item.attentionReasons,
    attentionDetails: item.attentionDetails || {},
    locationId: item.locationId,
    locationName: item.location?.name || "",
    mechanicId: item.mechanicId,
    mechanicName: item.mechanics?.map((mechanic) => mechanic.name).filter(Boolean).join(", ")
      || item.mechanic?.name
      || "",
    mechanics: item.mechanics || [],
    mechanicIds: item.mechanicIds || [],
    lastActivityAt: item.lastActivityAt,
    ageSeconds: item.ageSeconds,
    timeInStatusSeconds: item.timeInStatusSeconds,
    unread: item.unread,
    updatedAt: item.lastActivityAt,
    createdAt: item.createdAt,
  };
}

export async function mechanicDashboard(mechanicUserId, context) {
  const mechanic = mechanicUserId ? await requireMechanic(mechanicUserId) : await defaultMechanicUser();
  if (!mechanic) throw new Error("No mechanic user exists.");

  const [openWork, myWork, partsWaiting, officeWaiting, done] = await Promise.all([
    queryAuthorizedWorkorders(context, { category: "unassigned", pageSize: 50 }),
    queryAuthorizedWorkorders(context, { category: "active", mechanicPool: true, pageSize: 100 }),
    queryAuthorizedWorkorders(context, { attentionReason: "parts", pageSize: 50 }),
    queryAuthorizedWorkorders(context, { attentionReason: "office_help", pageSize: 50 }),
    queryAuthorizedWorkorders(context, { lifecycle: [...MECHANIC_HISTORY_LIFECYCLES], pageSize: 50 }),
  ]);
  const assignedActiveItems = myWork.items.filter((item) => item.mechanicIds?.includes(mechanic.id));
  const waitingById = new Map([
    ...officeWaiting.items.map((item) => [item.id, dashboardOperation(item, "waiting_office")]),
    ...partsWaiting.items.map((item) => [item.id, dashboardOperation(item, "parts_requested")]),
  ]);
  const waiting = [...waitingById.values()];

  return {
    user: mechanic,
    counts: {
      open: openWork.total,
      active: myWork.total,
      mine: assignedActiveItems.length,
      waiting: waiting.length,
      done: done.total,
    },
    openWork: openWork.items.map((item) => dashboardOperation(item)),
    activeWork: myWork.items.map((item) => dashboardOperation(item)),
    myWork: assignedActiveItems.map((item) => dashboardOperation(item)),
    waiting,
    done: done.items.map((item) => dashboardOperation(item)),
  };
}

export function mechanicAllowedActions(workorder, mechanicId, policy = {}) {
  const isMine = workorder.mechanicIds?.includes(mechanicId);
  const canAccept = workorder.status === WORKORDER_STATUS.OPEN
    && !workorder.mechanicIds?.length;
  const canEdit = isMine && ![
    WORKORDER_STATUS.MECHANIC_DONE,
    WORKORDER_STATUS.CLOSED,
    WORKORDER_STATUS.ODOO_ENTERED,
    WORKORDER_STATUS.CANCELLED,
  ].includes(workorder.status);
  return {
    accept: canAccept,
    saveNotes: canEdit,
    sendMessage: isMine,
    recordUsedParts: canEdit && policy.mechanicCanRecordParts === true,
    release: canEdit,
    markDone: canEdit,
    requestParts: canEdit,
  };
}

export async function mechanicWorkorderDetail(workorderId, mechanicUserId) {
  const mechanic = mechanicUserId ? await requireMechanic(mechanicUserId) : await defaultMechanicUser();
  if (!mechanic) throw new Error("No mechanic user exists.");
  const detail = await loadWorkorderDetail(workorderId, {
    viewerUserId: mechanic.id,
    participantChatOnly: true,
  });
  await markWorkorderRead({
    workorderId,
    userId: mechanic.id,
    lastSeenActivityAt: detail.workorder.updatedAt,
  });
  const { workorder } = detail;
  const policy = workorder.locationId
    ? await getLocationWorkorderPolicy(workorder.locationId, [workorder.companyId])
    : null;
  return {
    user: mechanic,
    ...detail,
    allowedActions: mechanicAllowedActions(workorder, mechanic.id, policy),
  };
}

export async function requestMechanicPart(workorderId, input) {
  await requireMechanic(input.mechanicUserId);
  return createPartRequest(workorderId, input);
}

export async function updateMechanicPartUsage(workorderId, requestId, input) {
  await requireMechanic(input.mechanicUserId);
  return updatePartUsage(workorderId, requestId, input);
}

export async function acceptMechanicWorkorder(workorderId, mechanicUserId) {
  await requireMechanic(mechanicUserId);
  try {
    return await acceptOperationalWorkorder(workorderId, mechanicUserId);
  } catch (error) {
    if (error instanceof WorkorderLifecycleConflictError) {
      throw new AuthError(error.statusCode, error.code, error.message);
    }
    throw error;
  }
}

export async function createMechanicWorkorder(input) {
  const mechanic = await requireMechanic(input.createdByUserId);
  return createOperationalWorkorder({
    ...input,
    createdByUserId: mechanic.id,
    mechanicUserIds: [mechanic.id],
    startImmediately: true,
  });
}

export async function releaseMechanicWorkorder(workorderId, mechanicUserId, reason) {
  await requireMechanic(mechanicUserId);
  return releaseOperationalWorkorder(workorderId, mechanicUserId, reason);
}

export async function saveMechanicWorkorderProgress(workorderId, mechanicUserId, input) {
  await requireMechanic(mechanicUserId);
  try {
    const progress = await persistMechanicWorkorderProgress({
      workorderId,
      mechanicUserId,
      ...input,
    });
    if (!progress) throw resourceNotFound("Workorder");
    return progress;
  } catch (error) {
    if (error instanceof WorkorderProgressConflictError) {
      throw new AuthError(error.statusCode, error.code, error.message);
    }
    if (error.statusCode === 409 && error.code === "WORKORDER_PROGRESS_LOCKED") {
      throw new AuthError(error.statusCode, error.code, error.message);
    }
    throw error;
  }
}

export async function saveMechanicUsedParts(workorderId, mechanicUserId, parts) {
  await requireMechanic(mechanicUserId);
  const policy = await getWorkorderMechanicPartsPolicy(workorderId);
  if (!policy?.mechanicCanRecordParts) {
    throw new AuthError(
      403,
      "MECHANIC_PARTS_ENTRY_DISABLED",
      "Mechanics cannot record used parts at this location. Send a part request to the office instead.",
    );
  }
  return updateMechanicUsedParts(workorderId, mechanicUserId, parts);
}

export async function markMechanicDone(workorderId, mechanicUserId, input) {
  const mechanic = await requireMechanic(mechanicUserId);
  const normalizeName = (value) => String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
  if (normalizeName(input.confirmationName) !== normalizeName(mechanic.name)) {
    throw new Error(`Write ${mechanic.name} to confirm Work done.`);
  }
  try {
    return await markOperationalWorkorderDone(workorderId, mechanicUserId, input);
  } catch (error) {
    if (error instanceof WorkorderLifecycleConflictError) {
      throw new AuthError(error.statusCode, error.code, error.message);
    }
    throw error;
  }
}

export async function sendMechanicMessage(workorderId, input) {
  await requireMechanic(input.senderUserId);
  return processMechanicChatMessage(workorderId, input);
}
