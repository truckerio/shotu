import { authenticationRequired, permissionDenied } from "./errors.js";

export function requireActor(context) {
  if (!context?.actor) throw authenticationRequired();
  return context.actor;
}

export function requirePermission(context, permission) {
  const actor = requireActor(context);
  if (!context.permissions?.has(permission)) throw permissionDenied();
  return actor;
}

export function requireLocationAccess(context, locationId) {
  const actor = requireActor(context);
  if (!locationId || actor.role === "admin") return actor;
  if (!context.locationIds?.has(locationId)) throw permissionDenied();
  return actor;
}

export function requireCompanyAccess(context, companyId) {
  const actor = requireActor(context);
  if (!companyId) return actor;
  if (!context.companyIds?.has(companyId)) throw permissionDenied();
  return actor;
}
