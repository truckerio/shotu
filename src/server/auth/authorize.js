import { authenticationRequired, permissionDenied } from "./errors.js";
import { effectiveCompanyRole } from "./company-role.js";

export function requireActor(context) {
  if (!context?.actor) throw authenticationRequired();
  return context.actor;
}

export function requirePermission(context, permission) {
  const actor = requireActor(context);
  if (!context.permissions?.has(permission)) throw permissionDenied();
  return actor;
}

export function requireLocationAccess(context, locationId, companyId = null) {
  const actor = requireActor(context);
  const targetCompanyId = companyId || (context.companyIds?.size === 1 ? [...context.companyIds][0] : null);
  if (!locationId || effectiveCompanyRole(context, targetCompanyId) === "admin") return actor;
  if (!context.locationIds?.has(locationId)) throw permissionDenied();
  return actor;
}

export function requireCompanyAccess(context, companyId) {
  const actor = requireActor(context);
  if (!companyId) return actor;
  if (!context.companyIds?.has(companyId)) throw permissionDenied();
  return actor;
}
