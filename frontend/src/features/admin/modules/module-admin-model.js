import {
  normalizeModuleAccessMap,
  normalizeModuleAccessOverrides,
  normalizeUserModuleAccessMap,
  resolveEffectiveWorkorderModuleAccess,
  WORKORDER_ACCESS_MODES,
  WORKORDER_INHERIT_ACCESS,
} from "../../../../../shared/workorder-modules.js";

export const MODULE_ACCESS_LABELS = Object.freeze({
  [WORKORDER_ACCESS_MODES.HIDDEN]: "Off",
  [WORKORDER_ACCESS_MODES.READ]: "View",
  [WORKORDER_ACCESS_MODES.WRITE]: "Edit",
  [WORKORDER_ACCESS_MODES.REQUIRED]: "Required to create",
  [WORKORDER_INHERIT_ACCESS]: "Use role setting",
});

export function moduleSupportsWrite(module) {
  return module?.capabilities?.includes(WORKORDER_ACCESS_MODES.WRITE) === true;
}

export function moduleAccessOptions(module, { includeInherit = false, role = "", surface = "" } = {}) {
  const modes = [WORKORDER_ACCESS_MODES.HIDDEN, WORKORDER_ACCESS_MODES.READ];
  if (moduleSupportsWrite(module, { role, surface })) modes.push(WORKORDER_ACCESS_MODES.WRITE);
  return includeInherit ? [WORKORDER_INHERIT_ACCESS, ...modes] : modes;
}

export function presentedModuleAccess(module, access, context = {}) {
  if (access === WORKORDER_ACCESS_MODES.REQUIRED) {
    return moduleSupportsWrite(module, context) ? WORKORDER_ACCESS_MODES.WRITE : WORKORDER_ACCESS_MODES.READ;
  }
  if (!moduleSupportsWrite(module, context) && access === WORKORDER_ACCESS_MODES.WRITE) {
    return WORKORDER_ACCESS_MODES.READ;
  }
  return access;
}

export function filterAdminModules(modules, query = "") {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return modules;
  return modules.filter((module) => (
    `${module.label} ${module.description} ${module.key}`.toLocaleLowerCase().includes(normalized)
  ));
}

export function roleModuleAccess(policy, role, surface, moduleKey) {
  return normalizeModuleAccessMap(policy?.moduleAccess)[role]?.[surface]?.[moduleKey]
    || WORKORDER_ACCESS_MODES.HIDDEN;
}

export function updateRoleModuleAccess(policy, role, surface, moduleKey, access) {
  const moduleAccess = normalizeModuleAccessMap(policy?.moduleAccess);
  moduleAccess[role][surface][moduleKey] = access;
  return { ...policy, moduleAccess };
}

export function moduleAccessOverride(policy, role, surface, moduleKey) {
  return normalizeModuleAccessOverrides(policy?.moduleAccessOverrides || policy?.moduleAccess)
    ?.[role]?.[surface]?.[moduleKey] || WORKORDER_INHERIT_ACCESS;
}

export function updateModuleAccessOverride(policy, role, surface, moduleKey, access) {
  const moduleAccess = normalizeModuleAccessOverrides(policy?.moduleAccessOverrides || policy?.moduleAccess);
  const roleAccess = { ...(moduleAccess[role] || {}) };
  const surfaceAccess = { ...(roleAccess[surface] || {}) };

  if (access === WORKORDER_INHERIT_ACCESS) delete surfaceAccess[moduleKey];
  else surfaceAccess[moduleKey] = access;

  if (Object.keys(surfaceAccess).length) roleAccess[surface] = surfaceAccess;
  else delete roleAccess[surface];
  if (Object.keys(roleAccess).length) moduleAccess[role] = roleAccess;
  else delete moduleAccess[role];

  return {
    ...policy,
    moduleAccess,
    ...(Object.hasOwn(policy || {}, "moduleAccessOverrides") ? { moduleAccessOverrides: moduleAccess } : {}),
  };
}

export function userModuleException(policy, userId, surface, moduleKey) {
  return normalizeUserModuleAccessMap(policy?.userModuleAccess)[userId]?.[surface]?.[moduleKey]
    || WORKORDER_INHERIT_ACCESS;
}

export function updateUserModuleException(policy, userId, surface, moduleKey, access) {
  const userModuleAccess = normalizeUserModuleAccessMap(policy?.userModuleAccess);
  const userAccess = { ...(userModuleAccess[userId] || {}) };
  const surfaceAccess = { ...(userAccess[surface] || {}) };

  if (access === WORKORDER_INHERIT_ACCESS) delete surfaceAccess[moduleKey];
  else surfaceAccess[moduleKey] = access;

  if (Object.keys(surfaceAccess).length) userAccess[surface] = surfaceAccess;
  else delete userAccess[surface];
  if (Object.keys(userAccess).length) userModuleAccess[userId] = userAccess;
  else delete userModuleAccess[userId];

  return { ...policy, userModuleAccess };
}

function rulePatch(value) {
  if (value === WORKORDER_ACCESS_MODES.REQUIRED) {
    return { access: WORKORDER_ACCESS_MODES.WRITE, required: true };
  }
  return { access: value, required: false };
}

export function modulePolicyRuleChanges(beforePolicy, afterPolicy, catalog) {
  const changes = [];
  const beforeMaps = {
    roles: normalizeModuleAccessOverrides(beforePolicy?.moduleAccessOverrides || beforePolicy?.moduleAccess),
    users: normalizeUserModuleAccessMap(beforePolicy?.userModuleAccess),
  };
  const afterMaps = {
    roles: normalizeModuleAccessOverrides(afterPolicy?.moduleAccessOverrides || afterPolicy?.moduleAccess),
    users: normalizeUserModuleAccessMap(afterPolicy?.userModuleAccess),
  };
  const userIds = new Set([
    ...Object.keys(beforePolicy?.userModuleAccess || {}),
    ...Object.keys(afterPolicy?.userModuleAccess || {}),
  ]);
  const subjects = [
    ...(catalog?.roles || []).map((id) => ({ targetType: "role", targetId: id })),
    ...[...userIds].sort().map((id) => ({ targetType: "user", targetId: id })),
  ];
  for (const subject of subjects) {
    for (const module of catalog?.modules || []) {
      for (const surface of module.surfaces || []) {
        const mapKey = subject.targetType === "role" ? "roles" : "users";
        const before = beforeMaps[mapKey]?.[subject.targetId]?.[surface]?.[module.key]
          || WORKORDER_INHERIT_ACCESS;
        const after = afterMaps[mapKey]?.[subject.targetId]?.[surface]?.[module.key]
          || WORKORDER_INHERIT_ACCESS;
        if (before === after) continue;
        changes.push({
          ...subject,
          moduleKey: module.key,
          surface,
          ...rulePatch(after),
        });
      }
    }
  }
  return changes;
}

export function effectiveModuleAccess({ companyPolicy, locationPolicy, moduleKey, role, surface, userId = "" }) {
  const result = resolveEffectiveWorkorderModuleAccess({
    companyPolicy,
    locationPolicy,
    moduleKey,
    role,
    surface,
    userId,
  });
  const sourceLabels = {
    default: "System default",
    company: "Company default",
    company_user: "Company user exception",
    location: "Location override",
    user: "Location user exception",
  };
  return { ...result, sourceLabel: sourceLabels[result.source] || "System default" };
}
