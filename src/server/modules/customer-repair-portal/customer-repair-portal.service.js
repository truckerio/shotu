import { AuthError, resourceNotFound } from "../../auth/errors.js";
import {
  requireActor,
  requireCompanyAccess,
  requireLocationAccess,
  requirePermission,
} from "../../auth/authorize.js";
import { requireWorkorderAccess } from "../../auth/resource-access.js";
import { effectiveCompanyContext } from "../../auth/company-role.js";
import { PERMISSION } from "../../auth/permissions.js";
import { resolveAuthConfig } from "../../auth/config.js";
import * as repo from "../../db/repositories/customer-repair-portal.repo.js";
import {
  repairScopeSchema,
  repairGrantSchema,
  repairRevokeSchema,
  repairEmailSchema,
  repairResponseSchema,
  repairChatSchema,
  repairStaffChatSchema,
} from "./customer-repair-portal.schemas.js";
import { emailRepairLink } from "./customer-repair-email.service.js";
export function repairCustomerStatus(status) {
  return (
    {
      open: "Scheduled",
      accepted: "Ready to start",
      in_progress: "In progress",
      waiting_office: "Waiting for shop review",
      parts_requested: "Waiting for parts",
      mechanic_done: "Work complete",
      closed: "Complete",
      odoo_entered: "Complete",
      cancelled: "Cancelled",
    }[status] || "In progress"
  );
}
function token(raw) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(String(raw || "")))
    throw new AuthError(
      404,
      "CUSTOMER_REPAIR_UNAVAILABLE",
      "This customer repair link is unavailable.",
    );
  return raw;
}
async function execute(fn) {
  try {
    return await fn();
  } catch (error) {
    if (
      [
        "CUSTOMER_REPAIR_UNAVAILABLE",
        "CUSTOMER_DOCUMENT_GRANT_UNAVAILABLE",
        "42501",
      ].includes(error.code)
    )
      throw new AuthError(
        404,
        "CUSTOMER_REPAIR_UNAVAILABLE",
        "This customer repair link is unavailable.",
      );
    if (
      [
        "CUSTOMER_REPAIR_CONFLICT",
        "CUSTOMER_DOCUMENT_REVISION_NOT_RESPONSE_ELIGIBLE",
        "CUSTOMER_DOCUMENT_IDEMPOTENCY_CONFLICT",
        "40001",
        "40P01",
        "23505",
      ].includes(error.code)
    )
      throw new AuthError(
        409,
        "CUSTOMER_REPAIR_CONFLICT",
        "This repair changed. Refresh and try again.",
      );
    throw error;
  }
}
async function staff(context, workorderId, input, deps) {
  requireActor(context);
  context = effectiveCompanyContext(context, input.companyId);
  requirePermission(context, PERMISSION.CUSTOMER_DOCUMENT_WRITE);
  requireCompanyAccess(context, input.companyId);
  requireLocationAccess(context, input.locationId, input.companyId);
  const workorder = await (
    deps.requireWorkorderAccess || requireWorkorderAccess
  )(context, workorderId, {
    allowAvailable: false,
    allowActiveAtLocation: false,
  });
  if (
    workorder.companyId !== input.companyId ||
    workorder.locationId !== input.locationId
  )
    throw resourceNotFound("Workorder");
  return {
    ...input,
    workorderId,
    actorId: context.actor.id,
    actorRole: context.actor.role,
  };
}
export async function createCustomerRepairLink(
  context,
  workorderId,
  rawInput,
  deps = {},
) {
  const input = repairGrantSchema.parse(rawInput);
  const command = await staff(context, workorderId, input, deps);
  const lifetime = new Date(input.expiresAt).getTime() - Date.now();
  if (lifetime < 300000 || lifetime > 90 * 86400000)
    throw new AuthError(
      400,
      "CUSTOMER_REPAIR_EXPIRY_INVALID",
      "Customer links must expire between 5 minutes and 90 days from now.",
    );
  const result = await execute(() =>
    (deps.create || repo.createRepairGrant)(
      { ...command, requestHash: repo.repairHash(command) },
      deps,
    ),
  );
  return {
    ...result,
    link: result.rawToken
      ? `${new URL(deps.baseURL || resolveAuthConfig().baseURL).origin}/#customerRepair=${result.rawToken}`
      : null,
  };
}
export async function revokeCustomerRepairLink(
  context,
  grantId,
  rawInput,
  deps = {},
) {
  const input = repairRevokeSchema.parse(rawInput);
  const command = await staff(context, input.workorderId, input, deps);
  return execute(() =>
    (deps.revoke || repo.revokeRepairGrant)({ ...command, grantId }, deps),
  );
}
export async function emailCustomerRepairLink(
  context,
  grantId,
  rawInput,
  deps = {},
) {
  const input = repairEmailSchema.parse(rawInput);
  const command = await staff(context, input.workorderId, input, deps);
  return execute(() =>
    (deps.email || emailRepairLink)({ ...command, grantId }, deps),
  );
}
export async function readCustomerRepairPortal(
  rawToken,
  audit = {},
  deps = {},
) {
  const result = await execute(() =>
    (deps.read || repo.readRepairPortal)(
      { rawToken: token(rawToken), ...audit },
      deps,
    ),
  );
  return {
    ...result,
    workorder: {
      ...result.workorder,

      status: repairCustomerStatus(result.workorder.status),
    },
  };
}
export async function respondToCustomerRepairEstimate(
  rawToken,
  rawInput,
  deps = {},
) {
  const input = repairResponseSchema.parse(rawInput);
  return execute(() =>
    (deps.respond || repo.respondRepairPortal)(
      { ...input, rawToken: token(rawToken) },
      deps,
    ),
  );
}
export async function readCustomerRepairChat(rawToken, deps = {}) {
  return execute(() =>
    (deps.readChat || repo.readRepairChat)({ rawToken: token(rawToken) }, deps),
  );
}
export async function sendCustomerRepairChat(rawToken, rawInput, deps = {}) {
  const input = repairChatSchema.parse(rawInput);
  return execute(() =>
    (deps.sendChat || repo.sendRepairChat)(
      { ...input, rawToken: token(rawToken) },
      deps,
    ),
  );
}
export async function readStaffRepairChat(
  context,
  workorderId,
  rawInput,
  deps = {},
) {
  const input = repairScopeSchema.parse(rawInput);
  const command = await staff(context, workorderId, input, deps);
  return execute(() =>
    (deps.readStaffChat || repo.readRepairStaffChat)(command, deps),
  );
}
export async function sendStaffRepairChat(
  context,
  workorderId,
  rawInput,
  deps = {},
) {
  const input = repairStaffChatSchema.parse(rawInput);
  const command = await staff(context, workorderId, input, deps);
  return execute(() =>
    (deps.sendStaffChat || repo.sendRepairStaffChat)(command, deps),
  );
}
