import { defaultLocation } from "../../db/repositories/locations.repo.js";
import { addChatMessage, chatMessageDedupeKey } from "../../db/repositories/chat.repo.js";
import { persistChatImageAttachment, removeStoredChatImage } from "../chat/chat-media.service.js";
import { createApprovedOfficePart, decidePartRequest, updatePartAllocation } from "../../db/repositories/part-requests.repo.js";
import {
  cancelOperationalWorkorder,
  closeOperationalWorkorder,
  createOperationalWorkorder,
  reassignOperationalWorkorder,
  setOperationalWorkorderMechanics,
  returnOperationalWorkorder,
  updateOfficeUsedParts,
  updateOperationalWorkorder,
  WorkorderLifecycleConflictError,
} from "../../db/repositories/operational-workorders.repo.js";
import {
  getUserById,
  listMechanicsByLocations,
  listUsersByLocation,
  listUsersByRole,
} from "../../db/repositories/users.repo.js";
import { statusLabel } from "../workorders/workorder.presenter.js";
import { loadWorkorderDetail } from "../workorders/workorder-detail.service.js";
import { queryAuthorizedWorkorders } from "../workorders/workorder-operations.service.js";
import { listActiveWorkorderAttention, markWorkorderRead } from "../../db/repositories/workorder-attention.repo.js";
import { DEFAULT_COMPANY_ID } from "../../db/company.js";
import { AuthError } from "../../auth/errors.js";
import { getLocationWorkorderPolicy } from "../../db/repositories/workorder-policies.repo.js";

async function requireOffice(userId) {
  const user = await getUserById(userId);
  if (!user || !user.active) throw new Error("Active workorder user not found.");
  return user;
}

export async function defaultOfficeUser() {
  const users = await listUsersByRole("office");
  return users[0] || null;
}

export function officeAllowedActions(status, activeAttention = []) {
  const active = ["open", "accepted", "in_progress"].includes(status);
  const review = status === "mechanic_done";
  const hasMissingInfo = activeAttention.some((attention) => attention.reason === "missing_info");
  const canUpdate = active || review || (status === "closed" && hasMissingInfo);
  return {
    update: canUpdate,
    updateAdministrative: canUpdate,
    saveNotes: canUpdate,
    sendMessage: active || review,
    recordUsedParts: canUpdate,
    addApprovedParts: active,
    approve: review,
    returnToMechanic: review,
    cancel: active || review,
    assignMechanics: active,
  };
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
    lastActivityAt: item.lastActivityAt,
    ageSeconds: item.ageSeconds,
    timeInStatusSeconds: item.timeInStatusSeconds,
    unread: item.unread,
    updatedAt: item.lastActivityAt,
    createdAt: item.createdAt,
  };
}

export async function officeDashboard(context, dependencies = {}) {
  const queryWorkorders = dependencies.queryWorkorders || queryAuthorizedWorkorders;
  const listMechanics = dependencies.listMechanics || listMechanicsByLocations;
  const [open, active, parts, done, closed, mechanics] = await Promise.all([
    queryWorkorders(context, { category: "unassigned", pageSize: 100 }),
    queryWorkorders(context, { category: "all", lifecycle: ["accepted", "in_progress"], pageSize: 100 }),
    queryWorkorders(context, { category: "parts", pageSize: 100 }),
    queryWorkorders(context, { category: "ready_review", pageSize: 100 }),
    queryWorkorders(context, { category: "all", lifecycle: ["closed", "odoo_entered"], pageSize: 100 }),
    listMechanics([...(context.locationIds || [])]),
  ]);
  return {
    counts: {
      open: open.total,
      active: active.total,
      parts: parts.total,
      done: done.total,
      closed: closed.total,
    },
    mechanics,
    open: open.items.map((item) => dashboardOperation(item)),
    active: active.items.map((item) => dashboardOperation(item, item.attentionReasons.includes("office_help") ? "waiting_office" : item.lifecycle)),
    parts: parts.items.map((item) => dashboardOperation(item, "parts_requested")),
    done: done.items.map((item) => dashboardOperation(item)),
    closed: closed.items.map((item) => dashboardOperation(item)),
  };
}

export async function createOfficeWorkorder(input) {
  const office = input.createdByUserId ? await requireOffice(input.createdByUserId) : await defaultOfficeUser();
  const location = input.locationId ? null : await defaultLocation(input.companyId || DEFAULT_COMPANY_ID);
  return createOperationalWorkorder({
    ...input,
    createdByUserId: office?.id || input.createdByUserId || null,
    locationId: input.locationId || location?.id || null,
  });
}

export async function officeWorkorderDetail(workorderId, officeUserId) {
  const user = await requireOffice(officeUserId);
  const detail = await loadWorkorderDetail(workorderId, { viewerUserId: user.id });
  const assignableMechanics = detail.workorder.location?.id
    ? (await listUsersByLocation(detail.workorder.location.id))
      .filter((candidate) => candidate.role === "mechanic" && candidate.active && candidate.membership_active)
      .map((candidate) => ({ id: candidate.id, name: candidate.name }))
    : [];
  await markWorkorderRead({
    workorderId,
    userId: user.id,
    lastSeenActivityAt: detail.workorder.updatedAt,
  });
  const activeAttention = await listActiveWorkorderAttention(workorderId);
  const policy = detail.workorder.location?.id
    ? await getLocationWorkorderPolicy(detail.workorder.location.id, [detail.workorder.companyId])
    : null;
  return {
    ...detail,
    user,
    assignableMechanics,
    activeAttention,
    policy,
    allowedActions: officeAllowedActions(detail.workorder.status, activeAttention),
  };
}

function mapLifecycleConflict(error) {
  if (error instanceof WorkorderLifecycleConflictError) {
    throw new AuthError(error.statusCode, error.code, error.message);
  }
  throw error;
}

export async function officeLocationMechanics(locationId, officeUserId) {
  await requireOffice(officeUserId);
  const mechanics = await listUsersByLocation(locationId);
  return mechanics
    .filter((candidate) => candidate.role === "mechanic" && candidate.active && candidate.membership_active)
    .map((candidate) => ({ id: candidate.id, name: candidate.name }));
}

export async function reviewOfficePartRequest(workorderId, requestId, input) {
  const office = input.officeUserId ? await requireOffice(input.officeUserId) : await defaultOfficeUser();
  if (!office) throw new Error("Office user not found.");
  return decidePartRequest(workorderId, requestId, input, office.id);
}

export async function addOfficePart(workorderId, input) {
  const office = input.officeUserId ? await requireOffice(input.officeUserId) : await defaultOfficeUser();
  if (!office) throw new Error("Office user not found.");
  return createApprovedOfficePart(workorderId, input, office.id);
}

export async function changeOfficePartAllocation(workorderId, requestId, allocationId, input) {
  const office = input.officeUserId ? await requireOffice(input.officeUserId) : await defaultOfficeUser();
  if (!office) throw new Error("Office user not found.");
  return updatePartAllocation(workorderId, requestId, allocationId, input, office.id);
}

export async function updateOfficeWorkorder(workorderId, input) {
  const office = input.officeUserId ? await requireOffice(input.officeUserId) : await defaultOfficeUser();
  if (!office && input.officeUserId) throw new Error("Office user not found.");
  try {
    return await updateOperationalWorkorder(workorderId, {
      ...input,
      changedByUserId: office?.id || input.officeUserId || null,
    });
  } catch (error) {
    return mapLifecycleConflict(error);
  }
}

export async function saveOfficeUsedParts(workorderId, input) {
  const office = input.officeUserId ? await requireOffice(input.officeUserId) : await defaultOfficeUser();
  if (!office) throw new Error("Office user not found.");
  try {
    return await updateOfficeUsedParts(workorderId, office.id, input.parts);
  } catch (error) {
    return mapLifecycleConflict(error);
  }
}

export async function sendOfficeMessage(workorderId, input) {
  await requireOffice(input.senderUserId);
  const attachment = input.attachment ? await persistChatImageAttachment(input.attachment) : null;
  try {
    const message = await addChatMessage({
      workorderId,
      senderUserId: input.senderUserId,
      senderRole: input.senderRole || "office",
      messageType: "normal",
      body: input.body,
      attachment,
      dedupeKey: chatMessageDedupeKey(input.senderUserId, input.clientMessageId),
    });
    if (message.deduplicated && attachment) {
      await removeStoredChatImage(attachment.storageKey).catch(() => {});
    }
    return message;
  } catch (error) {
    if (attachment) await removeStoredChatImage(attachment.storageKey).catch(() => {});
    throw error;
  }
}

export async function closeOfficeWorkorder(workorderId, input) {
  await requireOffice(input.officeUserId);
  try {
    return await closeOperationalWorkorder(workorderId, input.officeUserId, input.note);
  } catch (error) {
    return mapLifecycleConflict(error);
  }
}

export async function returnOfficeWorkorder(workorderId, input) {
  await requireOffice(input.officeUserId);
  try {
    return await returnOperationalWorkorder(workorderId, input.officeUserId, input);
  } catch (error) {
    return mapLifecycleConflict(error);
  }
}

export async function cancelOfficeWorkorder(workorderId, input) {
  await requireOffice(input.officeUserId);
  try {
    return await cancelOperationalWorkorder(workorderId, input.officeUserId, input.reason);
  } catch (error) {
    return mapLifecycleConflict(error);
  }
}

export async function reassignOfficeWorkorder(workorderId, input) {
  await requireOffice(input.officeUserId);
  const detail = await loadWorkorderDetail(workorderId);
  if (!["open", "accepted", "in_progress"].includes(detail.workorder.status)) {
    throw new AuthError(409, "WORKORDER_ASSIGNMENT_NOT_ALLOWED", "Only active workorders can be reassigned.");
  }
  if ((detail.workorder.mechanic?.id || null) === input.mechanicUserId) {
    throw new Error("Select a different mechanic before updating the assignment.");
  }
  if (input.mechanicUserId) {
    const locationId = detail.workorder.location?.id;
    const mechanics = locationId ? await listUsersByLocation(locationId) : [];
    const target = mechanics.find((candidate) => (
      candidate.id === input.mechanicUserId
      && candidate.role === "mechanic"
      && candidate.active
      && candidate.membership_active
    ));
    if (!target) throw new Error("Selected mechanic is not active at this workorder location.");
  }
  try {
    return await reassignOperationalWorkorder(workorderId, input.officeUserId, input.mechanicUserId, input.reason);
  } catch (error) {
    return mapLifecycleConflict(error);
  }
}

export async function assignOfficeWorkorderMechanics(workorderId, input) {
  await requireOffice(input.officeUserId);
  const detail = await loadWorkorderDetail(workorderId);
  if (!["open", "accepted", "in_progress"].includes(detail.workorder.status)) {
    throw new AuthError(409, "WORKORDER_ASSIGNMENT_NOT_ALLOWED", "Only active workorders can have their mechanic team changed.");
  }

  const locationId = detail.workorder.location?.id;
  const locationMechanics = locationId ? await listUsersByLocation(locationId) : [];
  const assignableIds = new Set(locationMechanics
    .filter((candidate) => candidate.role === "mechanic" && candidate.active && candidate.membership_active)
    .map((candidate) => candidate.id));
  const invalidId = input.mechanicUserIds.find((id) => !assignableIds.has(id));
  if (invalidId) throw new Error("Every selected mechanic must be active at this workorder location.");

  try {
    return await setOperationalWorkorderMechanics(
      workorderId,
      input.officeUserId,
      input.mechanicUserIds,
      input.reason,
    );
  } catch (error) {
    return mapLifecycleConflict(error);
  }
}
