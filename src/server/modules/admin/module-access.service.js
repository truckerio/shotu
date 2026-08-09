import { requireCompanyAccess, requireLocationAccess } from "../../auth/authorize.js";
import {
  getNormalizedModulePolicy,
  saveNormalizedModulePolicy,
} from "../../db/repositories/module-access-rules.repo.js";
import { getWorkorderModule } from "../../../../shared/workorder-modules.js";
import { invalidRequest } from "../../auth/errors.js";
import { emitModulePolicyAudit } from "./module-policy-audit.js";

function setRule(policy, subjectType, subjectId, input) {
  const key = subjectType === "role" ? "moduleAccess" : "userModuleAccess";
  const next = structuredClone(policy?.[key] || {});
  if (input.access === "inherit") {
    delete next?.[subjectId]?.[input.surface]?.[input.moduleKey];
  } else {
    next[subjectId] ||= {};
    next[subjectId][input.surface] ||= {};
    next[subjectId][input.surface][input.moduleKey] = input.required ? "required" : input.access;
  }
  return next;
}

function validateRule(subjectType, subjectId, input) {
  const module = getWorkorderModule(input.moduleKey);
  if (!module || !module.surfaces.includes(input.surface)) throw invalidRequest("Unknown module or page.");
  if (input.required && input.surface !== "create") throw invalidRequest("Required applies only to Create.");
}

export async function readCanonicalModuleAccess(context, scope, dependencies = {}) {
  requireCompanyAccess(context, scope.companyId);
  if (scope.locationId) requireLocationAccess(context, scope.locationId);
  const getPolicy = dependencies.getPolicy || getNormalizedModulePolicy;
  return (await getPolicy(scope)) || {
    scopeType: scope.locationId ? "location" : "company",
    ...scope,
    moduleAccess: {},
    userModuleAccess: {},
    version: 0,
  };
}

export async function patchCanonicalModuleAccess(
  context,
  subjectType,
  subjectId,
  input,
  dependencies = {},
) {
  validateRule(subjectType, subjectId, input);
  const current = await readCanonicalModuleAccess(context, input, dependencies);
  const savePolicy = dependencies.savePolicy || saveNormalizedModulePolicy;
  const saved = await savePolicy({
    companyId: input.companyId,
    locationId: input.locationId || null,
    moduleAccess: subjectType === "role"
      ? setRule(current, subjectType, subjectId, input)
      : current.moduleAccess,
    userModuleAccess: subjectType === "user"
      ? setRule(current, subjectType, subjectId, input)
      : current.userModuleAccess,
    expectedVersion: input.expectedVersion,
    mechanicCanRecordParts: current.mechanicCanRecordParts === true,
    actorId: context.actor.id,
  });
  await emitModulePolicyAudit(dependencies, {
    actorId: context.actor.id,
    companyId: input.companyId,
    locationId: input.locationId || null,
    beforePolicy: current,
    afterPolicy: saved,
    requestId: dependencies.requestId || null,
  });
  return saved;
}

export async function readCanonicalUserModuleAccess(context, userId, scope, dependencies = {}) {
  const policy = await readCanonicalModuleAccess(context, scope, dependencies);
  return {
    userId,
    companyId: policy.companyId,
    locationId: policy.locationId || null,
    moduleAccess: policy.userModuleAccess?.[userId] || {},
    version: policy.version,
  };
}
