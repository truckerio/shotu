import {
  normalizeModuleAccessOverrides,
  normalizeUserModuleAccessMap,
  WORKORDER_INHERIT_ACCESS,
  WORKORDER_MODULES,
  WORKORDER_ROLES,
  WORKORDER_SURFACES,
} from "../../../../shared/workorder-modules.js";
import { buildModuleAccessChangeEvent } from "../workorders/workorder-module-access.service.js";

function policyMaps(policy) {
  return {
    roles: normalizeModuleAccessOverrides(policy?.moduleAccessOverrides || policy?.moduleAccess || {}),
    users: normalizeUserModuleAccessMap(policy?.userModuleAccess || {}),
  };
}

function accessAt(maps, targetType, targetId, surface, moduleKey) {
  const access = targetType === "role"
    ? maps.roles?.[targetId]?.[surface]?.[moduleKey]
    : maps.users?.[targetId]?.[surface]?.[moduleKey];
  return access || WORKORDER_INHERIT_ACCESS;
}

function changedSubjects(beforePolicy, afterPolicy) {
  const userIds = new Set([
    ...Object.keys(beforePolicy?.userModuleAccess || {}),
    ...Object.keys(afterPolicy?.userModuleAccess || {}),
  ]);
  return [
    ...WORKORDER_ROLES.map((id) => ({ type: "role", id })),
    ...[...userIds].sort().map((id) => ({ type: "user", id })),
  ];
}

export function modulePolicyChanges(beforePolicy, afterPolicy) {
  const changes = [];
  const beforeMaps = policyMaps(beforePolicy);
  const afterMaps = policyMaps(afterPolicy);
  for (const subject of changedSubjects(beforePolicy, afterPolicy)) {
    for (const surface of Object.values(WORKORDER_SURFACES)) {
      for (const module of WORKORDER_MODULES.filter((candidate) => candidate.surfaces.includes(surface))) {
        const before = accessAt(beforeMaps, subject.type, subject.id, surface, module.key);
        const after = accessAt(afterMaps, subject.type, subject.id, surface, module.key);
        if (before === after) continue;
        changes.push({
          targetType: subject.type,
          targetId: subject.id,
          moduleKey: module.key,
          surface,
          before,
          after,
        });
      }
    }
  }
  return changes;
}

export function buildModulePolicyAuditPayload({
  actorId,
  afterPolicy,
  beforePolicy,
  companyId,
  locationId = null,
  requestId = null,
  timestamp = new Date().toISOString(),
}) {
  const changes = modulePolicyChanges(beforePolicy, afterPolicy).map((change) => {
    const event = buildModuleAccessChangeEvent({
      actorId,
      companyId,
      locationId,
      requestId,
      timestamp,
      ...change,
    });
    return {
      targetType: event.targetType,
      targetId: event.targetId,
      moduleKey: event.moduleKey,
      surface: event.surface,
      before: event.before,
      after: event.after,
    };
  });
  if (!changes.length) return null;
  return {
    type: "policy.module_access.changed",
    actorId,
    companyId,
    locationId,
    scope: locationId ? "location" : "company",
    requestId,
    timestamp,
    changes,
  };
}

export async function emitModulePolicyAudit(dependencies, context) {
  if (typeof dependencies?.emitAuditEvent !== "function") return null;
  const payload = buildModulePolicyAuditPayload(context);
  if (!payload) return null;
  await dependencies.emitAuditEvent(payload);
  return payload;
}
