import {
  acceptOperationalWorkorder,
  markOperationalWorkorderDone,
  releaseOperationalWorkorder,
  updateMechanicNotes,
  updateMechanicUsedParts,
} from "../../db/repositories/operational-workorders.repo.js";
import { createPartRequest, updatePartUsage } from "../../db/repositories/part-requests.repo.js";
import { getUserById, listUsersByRole } from "../../db/repositories/users.repo.js";
import {
  WORKORDER_STATUS,
} from "../workorders/workorder.constants.js";
import { statusLabel } from "../workorders/workorder.presenter.js";
import { loadWorkorderDetail } from "../workorders/workorder-detail.service.js";
import { queryAuthorizedWorkorders } from "../workorders/workorder-operations.service.js";
import { processMechanicChatMessage } from "../chat/mechanic-chat.service.js";
import { markWorkorderRead } from "../../db/repositories/workorder-attention.repo.js";

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
    locationId: item.locationId,
    locationName: item.location?.name || "",
    mechanicId: item.mechanicId,
    mechanicName: item.mechanics?.map((mechanic) => mechanic.name).filter(Boolean).join(", ")
      || item.mechanic?.name
      || "",
    mechanics: item.mechanics || [],
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
    queryAuthorizedWorkorders(context, { category: "active", pageSize: 50 }),
    queryAuthorizedWorkorders(context, { attentionReason: "parts", pageSize: 50 }),
    queryAuthorizedWorkorders(context, { attentionReason: "office_help", pageSize: 50 }),
    queryAuthorizedWorkorders(context, { lifecycle: ["mechanic_done", "closed", "odoo_entered"], pageSize: 50 }),
  ]);
  const waitingById = new Map([
    ...officeWaiting.items.map((item) => [item.id, dashboardOperation(item, "waiting_office")]),
    ...partsWaiting.items.map((item) => [item.id, dashboardOperation(item, "parts_requested")]),
  ]);
  const waiting = [...waitingById.values()];

  return {
    user: mechanic,
    counts: {
      open: openWork.total,
      mine: myWork.total,
      waiting: waiting.length,
      done: done.total,
    },
    openWork: openWork.items.map((item) => dashboardOperation(item)),
    myWork: myWork.items.map((item) => dashboardOperation(item)),
    waiting,
    done: done.items.map((item) => dashboardOperation(item)),
  };
}

export async function mechanicWorkorderDetail(workorderId, mechanicUserId) {
  const mechanic = mechanicUserId ? await requireMechanic(mechanicUserId) : await defaultMechanicUser();
  if (!mechanic) throw new Error("No mechanic user exists.");
  const detail = await loadWorkorderDetail(workorderId);
  await markWorkorderRead({
    workorderId,
    userId: mechanic.id,
    lastSeenActivityAt: detail.workorder.updatedAt,
  });
  const { workorder } = detail;
  const isMine = workorder.mechanicIds?.includes(mechanic.id);
  const canAccept = workorder.status === WORKORDER_STATUS.OPEN
    && !workorder.mechanicIds?.length;
  const canEdit = isMine && ![WORKORDER_STATUS.MECHANIC_DONE, WORKORDER_STATUS.CLOSED, WORKORDER_STATUS.ODOO_ENTERED].includes(workorder.status);
  return {
    user: mechanic,
    ...detail,
    allowedActions: {
      accept: canAccept,
      saveNotes: canEdit,
      sendMessage: isMine && ![WORKORDER_STATUS.MECHANIC_DONE, WORKORDER_STATUS.CLOSED, WORKORDER_STATUS.ODOO_ENTERED].includes(workorder.status),
      release: canEdit,
      markDone: canEdit,
      requestParts: canEdit,
    },
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
  return acceptOperationalWorkorder(workorderId, mechanicUserId);
}

export async function releaseMechanicWorkorder(workorderId, mechanicUserId, reason) {
  await requireMechanic(mechanicUserId);
  return releaseOperationalWorkorder(workorderId, mechanicUserId, reason);
}

export async function saveMechanicNotes(workorderId, mechanicUserId, input) {
  await requireMechanic(mechanicUserId);
  return updateMechanicNotes(workorderId, mechanicUserId, input);
}

export async function saveMechanicUsedParts(workorderId, mechanicUserId, parts) {
  await requireMechanic(mechanicUserId);
  return updateMechanicUsedParts(workorderId, mechanicUserId, parts);
}

export async function markMechanicDone(workorderId, mechanicUserId, input) {
  const mechanic = await requireMechanic(mechanicUserId);
  const normalizeName = (value) => String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
  if (normalizeName(input.confirmationName) !== normalizeName(mechanic.name)) {
    throw new Error(`Write ${mechanic.name} to finish this workorder.`);
  }
  return markOperationalWorkorderDone(workorderId, mechanicUserId, input);
}

export async function sendMechanicMessage(workorderId, input) {
  await requireMechanic(input.senderUserId);
  return processMechanicChatMessage(workorderId, input);
}
