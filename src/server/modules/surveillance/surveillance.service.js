import { query } from "../../db/pool.js";
import { getOperationalWorkorderById, getWorkorderTimeline } from "../../db/repositories/operational-workorders.repo.js";
import { listChatMessages } from "../../db/repositories/chat.repo.js";
import { getUserById, listUsersByRole } from "../../db/repositories/users.repo.js";
import { statusLabel } from "../workorders/workorder.presenter.js";
import { queryAuthorizedWorkorders } from "../workorders/workorder-operations.service.js";
import { markWorkorderRead, setWorkorderAttention } from "../../db/repositories/workorder-attention.repo.js";
import {
  MECHANIC_ACTIVE_LIFECYCLES,
  ODOO_ELIGIBLE_LIFECYCLES,
  SURVEILLANCE_VISIBLE_LIFECYCLES,
  lifecycleIn,
} from "../workorders/workorder-lifecycle-policy.js";

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

export function isOdooEligibleStatus(status) {
  return lifecycleIn(status, ODOO_ELIGIBLE_LIFECYCLES);
}

async function requireOdooEligibleWorkorder(workorderId) {
  const workorder = await getOperationalWorkorderById(workorderId);
  if (!workorder) throw new Error("Workorder not found.");
  if (!isOdooEligibleStatus(workorder.status)) {
    throw new Error("Office approval is required before Odoo processing.");
  }
  return workorder;
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
  return { workorder, messages, timeline, user };
}

export async function markOdooEntered(workorderId, input) {
  await requireSurveillance(input.userId);
  await requireOdooEligibleWorkorder(workorderId);
  const result = await query(
    `
      insert into odoo_entry_status (
        workorder_id, status, odoo_service_order_no, entered_by_user_id, entered_at, note, updated_at
      )
      values ($1, 'entered', $2, $3, now(), $4, now())
      on conflict (workorder_id) do update
      set status = 'entered',
          odoo_service_order_no = excluded.odoo_service_order_no,
          entered_by_user_id = excluded.entered_by_user_id,
          entered_at = now(),
          note = excluded.note,
          updated_at = now()
      returning *
    `,
    [workorderId, input.odooServiceOrderNo || "", input.userId, input.note || ""]
  );
  await query("update operational_workorders set status = 'odoo_entered', updated_at = now() where id = $1", [workorderId]);
  await setWorkorderAttention({ workorderId, reason: "missing_info", active: false, actorUserId: input.userId, details: { source: "odoo_entry" } });
  return result.rows[0];
}

export async function markOdooMissingInfo(workorderId, input) {
  await requireSurveillance(input.userId);
  await requireOdooEligibleWorkorder(workorderId);
  const result = await query(
    `insert into odoo_entry_status (workorder_id, status, note, updated_at)
     values ($1, 'missing_info', $2, now())
     on conflict (workorder_id) do update
     set status = 'missing_info', note = excluded.note, updated_at = now()
     returning *`,
    [workorderId, input.note],
  );
  await setWorkorderAttention({
    workorderId,
    reason: "missing_info",
    active: true,
    actorUserId: input.userId,
    details: { note: input.note, source: "surveillance" },
  });
  return result.rows[0];
}
