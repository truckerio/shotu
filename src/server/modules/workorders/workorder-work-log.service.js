import { permissionDenied, resourceNotFound } from "../../auth/errors.js";
import { effectiveCompanyRole } from "../../auth/company-role.js";
import {
  authorizeWorkorderModule,
  resolveWorkorderModuleDecisions,
} from "./workorder-module-access.service.js";
import { authorizeProductModule } from "../access/product-module-access.service.js";
import {
  WORK_LOG_STATUSES,
  changeWorkorderActivityStatus,
  correctWorkorderLaborEntry,
  createWorkorderLaborEntry,
  readWorkorderWorkLog,
} from "../../db/repositories/workorder-work-log.repo.js";

function writable(decision) {
  return decision?.access === "write" || decision?.access === "required";
}

const READABLE_ACCESS = new Set(["read", "write", "required"]);

function capabilities(context, workorder, decisions, productWritable) {
  const role = effectiveCompanyRole(context, workorder.companyId);
  const assigned = workorder.mechanicIds?.includes(context.actor.id) === true;
  const mutableLifecycle = ["accepted", "in_progress"].includes(workorder.status);
  const laborMutableLifecycle = ["accepted", "in_progress", "mechanic_done"].includes(workorder.status);
  const canReadLabor = READABLE_ACCESS.has(decisions.diagnosisRepair?.access);
  const canChangeStatus = productWritable && mutableLifecycle && (
    (role === "mechanic" && assigned && writable(decisions.assignment))
    || (["office", "admin"].includes(role) && writable(decisions.assignment))
  );
  return {
    role,
    assigned,
    canReadLabor,
    canChangeStatus,
    canLogLabor: productWritable
      && laborMutableLifecycle
      && role === "mechanic"
      && assigned
      && writable(decisions.diagnosisRepair),
    canManageLabor: productWritable
      && laborMutableLifecycle
      && ["office", "admin"].includes(role)
      && writable(decisions.diagnosisRepair),
  };
}

async function authorizedState(context, workorderId, dependencies) {
  const resolveAccess = dependencies.resolveAccess || resolveWorkorderModuleDecisions;
  const authorization = await resolveAccess(context, workorderId);
  const workorder = authorization.workorder;
  const canWriteProduct = dependencies.canWriteProduct || (async () => {
    try {
      await authorizeProductModule(context, {
        companyId: workorder.companyId,
        locationId: workorder.locationId || null,
        moduleKey: "workorders",
      }, "write");
      return true;
    } catch (error) {
      if (error?.statusCode === 403) return false;
      throw error;
    }
  });
  const productWritable = await canWriteProduct(context, workorder);
  return {
    workorder,
    ...capabilities(context, workorder, authorization.decisions || {}, productWritable === true),
  };
}

function publicView(log, access) {
  return {
    activityStatus: log.workorder.activityStatus,
    version: log.workorder.activityVersion,
    canChangeStatus: access.canChangeStatus,
    canLogLabor: access.canLogLabor,
    canManageLabor: access.canManageLabor,
    entries: access.canReadLabor ? log.entries : [],
    totalHours: access.canReadLabor ? Number((log.totalMinutes / 60).toFixed(2)) : 0,
    statusOptions: [...WORK_LOG_STATUSES],
  };
}

export async function getWorkorderWorkLog(context, workorderId, dependencies = {}) {
  const access = await authorizedState(context, workorderId, dependencies);
  const readLog = dependencies.readLog || readWorkorderWorkLog;
  const log = await readLog(workorderId);
  if (!log || log.workorder.companyId !== access.workorder.companyId) throw resourceNotFound("Workorder");
  return publicView(log, access);
}

export async function patchWorkorderActivityStatus(context, workorderId, input, dependencies = {}) {
  const access = await authorizedState(context, workorderId, dependencies);
  if (!access.canChangeStatus) throw permissionDenied();
  await (dependencies.authorizeWrite || authorizeWorkorderModule)(context, workorderId, {
    moduleKey: "assignment", capability: "write", action: "update",
  });
  const changeStatus = dependencies.changeStatus || changeWorkorderActivityStatus;
  const changed = await changeStatus({
    workorderId,
    companyId: access.workorder.companyId,
    status: input.status,
    expectedVersion: input.expectedVersion,
    actorUserId: context.actor.id,
    mechanicUserId: access.role === "mechanic" ? context.actor.id : null,
  });
  if (changed === null) throw resourceNotFound("Workorder");
  return getWorkorderWorkLog(context, workorderId, dependencies);
}

export async function postWorkorderLabor(context, workorderId, input, dependencies = {}) {
  const access = await authorizedState(context, workorderId, dependencies);
  if (!access.canLogLabor) throw permissionDenied();
  await (dependencies.authorizeWrite || authorizeWorkorderModule)(context, workorderId, {
    moduleKey: "diagnosisRepair", capability: "write", action: "update",
  });
  const createLabor = dependencies.createLabor || createWorkorderLaborEntry;
  const created = await createLabor({
    workorderId,
    companyId: access.workorder.companyId,
    entryId: input.id,
    mechanicUserId: context.actor.id,
    minutes: input.minutes,
    date: input.date,
    note: input.note,
    actorUserId: context.actor.id,
  });
  if (created === null) throw resourceNotFound("Workorder");
  return getWorkorderWorkLog(context, workorderId, dependencies);
}

export async function patchWorkorderLabor(context, workorderId, entryId, input, dependencies = {}) {
  const access = await authorizedState(context, workorderId, dependencies);
  if (!access.canLogLabor && !access.canManageLabor) throw permissionDenied();
  await (dependencies.authorizeWrite || authorizeWorkorderModule)(context, workorderId, {
    moduleKey: "diagnosisRepair", capability: "write", action: "update",
  });
  const correctLabor = dependencies.correctLabor || correctWorkorderLaborEntry;
  const corrected = await correctLabor({
    workorderId,
    companyId: access.workorder.companyId,
    entryId,
    minutes: input.minutes,
    date: input.date,
    note: input.note,
    expectedVersion: input.expectedVersion,
    correctionReason: input.correctionReason,
    actorUserId: context.actor.id,
    mechanicUserId: access.canManageLabor ? null : context.actor.id,
  });
  if (corrected === null) throw resourceNotFound("Labor entry");
  return getWorkorderWorkLog(context, workorderId, dependencies);
}
