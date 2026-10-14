import { authenticationRequired, permissionDenied, resourceNotFound } from "./errors.js";
import { permissionsForRole } from "./permissions.js";

const ROLES = new Set(["admin", "office", "mechanic", "surveillance"]);

// The primary actor role is a workspace hint. Standard request contexts must
// authorize from the current company membership, including revoked/missing roles.
export function effectiveCompanyRole(context, companyId) {
  if (!context?.actor || !companyId || !context.companyIds?.has(companyId)) return null;
  let role;
  if (context.companyRoles instanceof Map) {
    role = context.companyRoles.get(companyId);
  } else if (context.sessionMode === "standard" || context.sessionMode === "kiosk") {
    return null;
  } else {
    // Compatibility for trusted internal single-company callers and unit seams,
    // never a fallback for an authenticated standard/kiosk request or mixed tenant.
    role = context.actor.companyMemberships?.find((entry) => entry.companyId === companyId)?.role;
    if (!role && context.companyIds.size === 1) role = context.actor.role;
  }
  return ROLES.has(role) ? role : null;
}

export function requireCompanyRole(context, companyId, allowedRoles) {
  if (!context?.actor) throw authenticationRequired();
  const role = effectiveCompanyRole(context, companyId);
  if (!role) throw resourceNotFound("Company");
  if (!allowedRoles.includes(role)) throw permissionDenied();
  return role;
}

export function companyRoleScope(context, allowedRoles = [...ROLES]) {
  const companyIds = [...(context?.companyIds || [])]
    .filter((companyId) => allowedRoles.includes(effectiveCompanyRole(context, companyId)));
  const adminCompanyIds = companyIds.filter((companyId) => effectiveCompanyRole(context, companyId) === "admin");
  return {
    companyIds,
    adminCompanyIds,
    locationIds: [...(context?.locationIds || [])],
    isAdmin: companyIds.length > 0 && adminCompanyIds.length === companyIds.length,
  };
}

export function effectiveCompanyContext(context, companyId) {
  if (!context?.actor) throw authenticationRequired();
  const role = effectiveCompanyRole(context, companyId);
  if (!role) throw resourceNotFound("Company");
  const rolePermissions = permissionsForRole(role);
  const permissions = context.permissions instanceof Set
    ? new Set([...rolePermissions].filter((permission) => context.permissions.has(permission)))
    : context.sessionMode ? new Set() : rolePermissions;
  return {
    ...context,
    actor: {
      ...context.actor,
      role,
      companyIds: [companyId],
      companyMemberships: [{ companyId, role }],
    },
    companyIds: new Set([companyId]),
    companyRoles: new Map([[companyId, role]]),
    permissions,
  };
}
