import { query } from "../pool.js";
import { normalizeModuleAccessMap } from "../../../../shared/workorder-modules.js";
import {
  getNormalizedModulePolicy,
  saveNormalizedModulePolicy,
  WorkorderModulePolicyConflictError,
} from "./module-access-rules.repo.js";

export { WorkorderModulePolicyConflictError };

export const DEFAULT_LOCATION_WORKORDER_POLICY = Object.freeze({
  mechanicCanRecordParts: false,
  moduleAccess: normalizeModuleAccessMap(),
  moduleAccessOverrides: {},
  userModuleAccess: {},
  version: 0,
});

async function locationPolicyBase(locationId, companyIds = null) {
  const result = await query(
    `select location.id as location_id,
            location.company_id,
            coalesce(policy.mechanic_can_record_parts, false) as mechanic_can_record_parts,
            policy.updated_by_user_id,
            policy.updated_at
     from locations location
     left join location_workorder_policies policy
       on policy.location_id = location.id and policy.company_id = location.company_id
     where location.id = $1
       and ($2::uuid[] is null or location.company_id = any($2::uuid[]))
     limit 1`,
    [locationId, companyIds?.length ? companyIds : null],
  );
  return result.rows[0] || null;
}

export async function getLocationWorkorderPolicy(locationId, companyIds = null) {
  const base = await locationPolicyBase(locationId, companyIds);
  if (!base) return null;
  const normalized = await getNormalizedModulePolicy({
    companyId: base.company_id,
    locationId,
  });
  const overrides = normalized?.moduleAccess || {};
  return {
    locationId,
    companyId: base.company_id,
    mechanicCanRecordParts: base.mechanic_can_record_parts === true,
    moduleAccess: normalizeModuleAccessMap(overrides),
    moduleAccessOverrides: overrides,
    userModuleAccess: normalized?.userModuleAccess || {},
    version: normalized?.version || 0,
    updatedByUserId: normalized?.updatedByUserId || base.updated_by_user_id || null,
    updatedAt: normalized?.updatedAt || base.updated_at || null,
  };
}

export async function saveLocationWorkorderPolicy({
  locationId,
  companyId,
  mechanicCanRecordParts,
  moduleAccess,
  userModuleAccess,
  expectedVersion = null,
  actorId,
}) {
  await saveNormalizedModulePolicy({
    companyId,
    locationId,
    mechanicCanRecordParts,
    moduleAccess,
    userModuleAccess,
    expectedVersion,
    actorId,
  });
  return getLocationWorkorderPolicy(locationId, [companyId]);
}

export async function getCompanyWorkorderModulePolicy(companyId) {
  const policy = await getNormalizedModulePolicy({ companyId });
  return policy ? {
    companyId,
    moduleAccess: policy.moduleAccess,
    userModuleAccess: policy.userModuleAccess,
    version: policy.version,
    updatedByUserId: policy.updatedByUserId,
    updatedAt: policy.updatedAt,
  } : null;
}

export async function saveCompanyWorkorderModulePolicy({
  companyId,
  moduleAccess,
  userModuleAccess,
  expectedVersion = null,
  actorId,
}) {
  return saveNormalizedModulePolicy({
    companyId,
    moduleAccess,
    userModuleAccess,
    expectedVersion,
    actorId,
  });
}

export async function getEffectiveWorkorderModulePolicy({ companyId, locationId }) {
  const [companyPolicy, locationPolicy] = await Promise.all([
    getCompanyWorkorderModulePolicy(companyId),
    locationId ? getLocationWorkorderPolicy(locationId, [companyId]) : null,
  ]);
  return { companyPolicy, locationPolicy };
}

export async function getWorkorderMechanicPartsPolicy(workorderId) {
  const result = await query(
    `select coalesce(policy.mechanic_can_record_parts, false) as mechanic_can_record_parts
     from operational_workorders workorder
     left join location_workorder_policies policy
       on policy.location_id = workorder.location_id and policy.company_id = workorder.company_id
     where workorder.id = $1
     limit 1`,
    [workorderId],
  );
  return result.rows[0]
    ? { mechanicCanRecordParts: result.rows[0].mechanic_can_record_parts === true }
    : null;
}
