import { roleCanCreateWorkorderForAnyLocation } from "./role-capabilities.js";

export function activeWorkorderCompanyId(activeWorkorder, selectedOfficeLocation) {
  return activeWorkorder?.workorder?.companyId
    || selectedOfficeLocation?.location?.company_id
    || selectedOfficeLocation?.location?.companyId
    || "";
}

export function projectedModuleAccessPolicy(moduleAccess, role) {
  if (!moduleAccess || typeof moduleAccess !== "object" || Array.isArray(moduleAccess)) return null;
  const detail = Object.fromEntries(Object.entries(moduleAccess).flatMap(([moduleKey, decision]) => {
    const access = typeof decision === "string" ? decision : decision?.access;
    return access ? [[moduleKey, access]] : [];
  }));
  if (!Object.keys(detail).length) return null;
  const normalizedRole = role === "manager" ? "office" : role;
  return { moduleAccess: { [normalizedRole]: { detail } } };
}

export function activeWorkorderModulePolicy({
  activeWorkorder = null,
  actorRole = "",
  selectedOfficeLocation = null,
} = {}) {
  const projectedPolicy = projectedModuleAccessPolicy(activeWorkorder?.moduleAccess, actorRole);
  if (projectedPolicy) return projectedPolicy;
  return activeWorkorder?.workorder?.policy
    || activeWorkorder?.workorder?.location?.policy
    || activeWorkorder?.policy
    || selectedOfficeLocation?.policy
    || null;
}

export function canOpenCreateWorkspaceForActor({ actor, locations = [] } = {}) {
  return roleCanCreateWorkorderForAnyLocation(actor?.role, locations, actor?.id);
}
