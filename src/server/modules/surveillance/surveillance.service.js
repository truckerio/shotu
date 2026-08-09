import { getOperationalWorkorderById, getWorkorderTimeline } from "../../db/repositories/operational-workorders.repo.js";
import { listChatMessages } from "../../db/repositories/chat.repo.js";
import { getUserById, listUsersByRole } from "../../db/repositories/users.repo.js";
import { statusLabel } from "../workorders/workorder.presenter.js";
import { queryAuthorizedWorkorders } from "../workorders/workorder-operations.service.js";
import { markWorkorderRead } from "../../db/repositories/workorder-attention.repo.js";
import {
  MECHANIC_ACTIVE_LIFECYCLES,
  ODOO_ELIGIBLE_LIFECYCLES,
  SURVEILLANCE_VISIBLE_LIFECYCLES,
  lifecycleIn,
} from "../workorders/workorder-lifecycle-policy.js";
import { getLocationWorkorderPolicy } from "../../db/repositories/workorder-policies.repo.js";

async function requireSurveillance(userId) {
  const user = await getUserById(userId);
  if (!user || !["surveillance", "admin"].includes(user.role) || !user.active) throw new Error("Surveillance user not found.");
  return user;
}

export async function defaultSurveillanceUser() {
  const users = await listUsersByRole("surveillance");
  return users[0] || null;
}

export function categorizeSurveillanceRows(rows) {
  const active = rows.filter((row) => lifecycleIn(row.lifecycle, MECHANIC_ACTIVE_LIFECYCLES));
  const awaitingOffice = rows.filter((row) => row.lifecycle === "mechanic_done");
  const approved = rows.filter((row) => lifecycleIn(row.lifecycle, ODOO_ELIGIBLE_LIFECYCLES));

  return {
    active,
    awaitingOffice,
    pendingOdoo: approved.filter((row) => row.odooStatus === "not_entered"),
    missingInfo: approved.filter((row) => row.odooStatus === "missing_info"),
    entered: approved.filter((row) => row.odooStatus === "entered"),
  };
}

export async function surveillanceDashboard(context) {
  const result = await queryAuthorizedWorkorders(context, {
    lifecycle: [...SURVEILLANCE_VISIBLE_LIFECYCLES],
    pageSize: 200,
    sortBy: "lastActivityAt",
    sortDirection: "desc",
  });
  const rows = result.items.map((item) => ({
    id: item.id,
    serial: item.serial,
    assetLabel: item.asset?.unitNo || item.asset?.name || "No unit selected",
    assetUnitNo: item.asset?.unitNo || item.asset?.name || "",
    concern: item.concern,
    status: item.lifecycle,
    lifecycle: item.lifecycle,
    statusLabel: statusLabel(item.lifecycle),
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
    workPerformed: item.workPerformed,
    closedAt: item.closedAt,
    odooStatus: item.odooStatus,
    odooServiceOrderNo: item.odooServiceOrderNo,
  }));
  const queues = categorizeSurveillanceRows(rows);

  return {
    counts: {
      active: queues.active.length,
      awaitingOffice: queues.awaitingOffice.length,
      pendingOdoo: queues.pendingOdoo.length,
      missingInfo: queues.missingInfo.length,
      entered: queues.entered.length,
    },
    ...queues,
  };
}

export async function surveillanceWorkorderDetail(workorderId, userId) {
  const [workorder, messages, timeline, user] = await Promise.all([
    getOperationalWorkorderById(workorderId),
    listChatMessages(workorderId),
    getWorkorderTimeline(workorderId),
    requireSurveillance(userId),
  ]);
  if (!workorder) throw new Error("Workorder not found.");
  await markWorkorderRead({ workorderId, userId: user.id, lastSeenActivityAt: workorder.updatedAt });
  const policy = workorder.locationId
    ? await getLocationWorkorderPolicy(workorder.locationId, [workorder.companyId])
    : null;
  return { workorder, messages, timeline, user, policy };
}
