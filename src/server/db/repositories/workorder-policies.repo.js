import { query } from "../pool.js";
import {
  normalizeModuleAccessMap,
  normalizeModuleAccessOverrides,
  normalizeUserModuleAccessMap,
} from "../../../../shared/workorder-modules.js";

export const DEFAULT_LOCATION_WORKORDER_POLICY = Object.freeze({
  mechanicCanRecordParts: false,
  moduleAccess: normalizeModuleAccessMap(),
  moduleAccessOverrides: {},
  userModuleAccess: normalizeUserModuleAccessMap(),
  version: 0,
});

function publicPolicy(row) {
  if (!row) return { ...DEFAULT_LOCATION_WORKORDER_POLICY };
  return {
    locationId: row.location_id,
    companyId: row.company_id,
    mechanicCanRecordParts: row.mechanic_can_record_parts === true,
    moduleAccess: normalizeModuleAccessMap(row.module_access || {}),
    moduleAccessOverrides: normalizeModuleAccessOverrides(row.module_access || {}),
    userModuleAccess: normalizeUserModuleAccessMap(row.user_module_access || {}),
    version: Number(row.version ?? 0),
    updatedByUserId: row.updated_by_user_id || null,
    updatedAt: row.updated_at || null,
  };
}

export async function getLocationWorkorderPolicy(locationId, companyIds = null) {
  const result = await query(
    `select
       location.id as location_id,
       location.company_id,
       coalesce(policy.mechanic_can_record_parts, false) as mechanic_can_record_parts,
       coalesce(policy.module_access, '{}'::jsonb) as module_access,
       coalesce(policy.user_module_access, '{}'::jsonb) as user_module_access,
       coalesce(policy.version, 0) as version,
       policy.updated_by_user_id,
       policy.updated_at
     from locations location
     left join location_workorder_policies policy
       on policy.location_id = location.id
      and policy.company_id = location.company_id
     where location.id = $1
       and ($2::uuid[] is null or location.company_id = any($2::uuid[]))
     limit 1`,
    [locationId, companyIds?.length ? companyIds : null],
  );
  return result.rows[0] ? publicPolicy(result.rows[0]) : null;
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
  const result = await query(
    `insert into location_workorder_policies (
       location_id,
       company_id,
       mechanic_can_record_parts,
       module_access,
       user_module_access,
       version,
       updated_by_user_id
     )
     select $1, $2, $3, $4, $5, 1, $6
     where $7::bigint is null or $7::bigint = 0
     on conflict (location_id) do update
       set mechanic_can_record_parts = excluded.mechanic_can_record_parts,
           module_access = excluded.module_access,
           user_module_access = excluded.user_module_access,
           version = location_workorder_policies.version + 1,
           updated_by_user_id = excluded.updated_by_user_id,
           updated_at = now()
       where location_workorder_policies.company_id = excluded.company_id
         and ($7::bigint is null or location_workorder_policies.version = $7::bigint)
     returning
       location_id,
       company_id,
       mechanic_can_record_parts,
       module_access,
       user_module_access,
       version,
       updated_by_user_id,
       updated_at`,
    [
      locationId,
      companyId,
      mechanicCanRecordParts,
      normalizeModuleAccessOverrides(moduleAccess),
      normalizeUserModuleAccessMap(userModuleAccess),
      actorId,
      expectedVersion,
    ],
  );
  if (!result.rows[0]) throw new WorkorderModulePolicyConflictError();
  return publicPolicy(result.rows[0]);
}

function publicCompanyPolicy(row) {
  if (!row) return null;
  return {
    companyId: row.company_id,
    moduleAccess: normalizeModuleAccessOverrides(row.module_access || {}),
    userModuleAccess: normalizeUserModuleAccessMap(row.user_module_access || {}),
    version: Number(row.version || 1),
    updatedByUserId: row.updated_by_user_id || null,
    updatedAt: row.updated_at || null,
  };
}

export async function getCompanyWorkorderModulePolicy(companyId) {
  const result = await query(
    `select company_id, module_access, user_module_access, version, updated_by_user_id, updated_at
     from company_workorder_module_policies
     where company_id = $1
     limit 1`,
    [companyId],
  );
  return publicCompanyPolicy(result.rows[0]);
}

export class WorkorderModulePolicyConflictError extends Error {
  constructor() {
    super("Module access changed elsewhere. Reload and try again.");
    this.name = "WorkorderModulePolicyConflictError";
    this.statusCode = 409;
    this.code = "WORKORDER_MODULE_POLICY_CONFLICT";
  }
}

export async function saveCompanyWorkorderModulePolicy({
  companyId,
  moduleAccess,
  userModuleAccess,
  expectedVersion = null,
  actorId,
}) {
  const result = await query(
    `insert into company_workorder_module_policies (
       company_id,
       module_access,
       user_module_access,
       updated_by_user_id
     )
     select $1, $2, $3, $4
     where $5::bigint is null
        or (
          $5::bigint = 0
          and not exists (
            select 1 from company_workorder_module_policies current
            where current.company_id = $1
          )
        )
        or exists (
          select 1 from company_workorder_module_policies current
          where current.company_id = $1 and current.version = $5::bigint
        )
     on conflict (company_id) do update
       set module_access = excluded.module_access,
           user_module_access = excluded.user_module_access,
           version = company_workorder_module_policies.version + 1,
           updated_by_user_id = excluded.updated_by_user_id,
           updated_at = now()
       where $5::bigint is null
          or company_workorder_module_policies.version = $5::bigint
     returning company_id, module_access, user_module_access, version, updated_by_user_id, updated_at`,
    [
      companyId,
      normalizeModuleAccessOverrides(moduleAccess),
      normalizeUserModuleAccessMap(userModuleAccess),
      actorId,
      expectedVersion,
    ],
  );
  if (!result.rows[0]) throw new WorkorderModulePolicyConflictError();
  return publicCompanyPolicy(result.rows[0]);
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
    `select
       workorder.id as workorder_id,
       coalesce(policy.mechanic_can_record_parts, false) as mechanic_can_record_parts,
       coalesce(policy.module_access, '{}'::jsonb) as module_access,
       coalesce(policy.user_module_access, '{}'::jsonb) as user_module_access
     from operational_workorders workorder
     left join location_workorder_policies policy
       on policy.location_id = workorder.location_id
      and policy.company_id = workorder.company_id
     where workorder.id = $1
     limit 1`,
    [workorderId],
  );
  return result.rows[0]
    ? {
      mechanicCanRecordParts: result.rows[0].mechanic_can_record_parts === true,
      moduleAccess: normalizeModuleAccessMap(result.rows[0].module_access || {}),
      userModuleAccess: normalizeUserModuleAccessMap(result.rows[0].user_module_access || {}),
    }
    : null;
}
