import { getPool } from "../pool.js";
import {
  normalizeModuleAccessOverrides,
  normalizeUserModuleAccessMap,
} from "../../../../shared/workorder-modules.js";
import { WorkorderModulePolicyConflictError } from "./workorder-policies.repo.js";
import { invalidRequest } from "../../auth/errors.js";

function mapsFromRows(rows) {
  const moduleAccess = {};
  const userModuleAccess = {};
  for (const row of rows) {
    const target = row.subject_type === "role" ? moduleAccess : userModuleAccess;
    target[row.subject_id] ||= {};
    target[row.subject_id][row.surface] ||= {};
    target[row.subject_id][row.surface][row.module_key] = row.required ? "required" : row.access;
  }
  return {
    moduleAccess: normalizeModuleAccessOverrides(moduleAccess),
    userModuleAccess: normalizeUserModuleAccessMap(userModuleAccess),
  };
}

function rulesFromMaps(moduleAccess, userModuleAccess) {
  const rows = [];
  for (const [subjectType, accessMap] of [["role", moduleAccess], ["user", userModuleAccess]]) {
    for (const [subjectId, surfaces] of Object.entries(accessMap || {})) {
      for (const [surface, modules] of Object.entries(surfaces || {})) {
        for (const [moduleKey, value] of Object.entries(modules || {})) {
          rows.push({
            subjectType,
            subjectId,
            surface,
            moduleKey,
            access: value === "required" ? "write" : value,
            required: value === "required",
          });
        }
      }
    }
  }
  return rows;
}

export async function getNormalizedModulePolicy({ companyId, locationId = null }, dependencies = {}) {
  const runQuery = dependencies.query || ((text, params) => getPool().query(text, params));
  const result = await runQuery(
    `select scope.id, scope.scope_type, scope.company_id, scope.location_id, scope.version,
            scope.updated_by_user_id, scope.updated_at,
            case when scope.scope_type = 'location' then coalesce((
              select legacy.mechanic_can_record_parts
              from location_workorder_policies legacy
              where legacy.location_id = scope.location_id and legacy.company_id = scope.company_id
            ), false) else false end as mechanic_can_record_parts,
            rule.subject_type, coalesce(rule.role_key, rule.user_id::text, rule.subject_id) as subject_id,
            rule.surface, rule.module_key, rule.access, rule.required
     from workorder_module_policy_scopes scope
     left join workorder_module_access_rules rule on rule.scope_id = scope.id
     where scope.company_id = $1
       and (($2::uuid is null and scope.scope_type = 'company') or scope.location_id = $2)
     order by rule.subject_type, rule.subject_id, rule.surface, rule.module_key`,
    [companyId, locationId],
  );
  if (!result.rows[0]) return null;
  const maps = mapsFromRows(result.rows.filter((row) => row.subject_type));
  return {
    scopeId: result.rows[0].id,
    scopeType: result.rows[0].scope_type,
    companyId: result.rows[0].company_id,
    locationId: result.rows[0].location_id,
    version: Number(result.rows[0].version),
    updatedByUserId: result.rows[0].updated_by_user_id || null,
    updatedAt: result.rows[0].updated_at || null,
    mechanicCanRecordParts: result.rows[0].mechanic_can_record_parts === true,
    ...maps,
  };
}

export async function saveNormalizedModulePolicy({
  companyId,
  locationId = null,
  moduleAccess,
  userModuleAccess,
  expectedVersion = null,
  mechanicCanRecordParts = false,
  actorId,
}, dependencies = {}) {
  const pool = dependencies.pool || getPool();
  const client = await pool.connect();
  const normalizedRoles = normalizeModuleAccessOverrides(moduleAccess);
  const normalizedUsers = normalizeUserModuleAccessMap(userModuleAccess);
  try {
    await client.query("begin");
    const userIds = [...new Set(rulesFromMaps(normalizedRoles, normalizedUsers)
      .filter((rule) => rule.subjectType === "user")
      .map((rule) => rule.subjectId))];
    if (userIds.length) {
      const members = await client.query(
        `select user_id::text as user_id
         from user_company_memberships
         where company_id = $1 and active = true and user_id = any($2::uuid[])`,
        [companyId, userIds],
      );
      const memberIds = new Set(members.rows.map((row) => row.user_id));
      if (userIds.some((userId) => !memberIds.has(userId))) {
        throw invalidRequest("Every named-user module rule must target an active user in this company.");
      }
    }
    const scopeType = locationId ? "location" : "company";
    const scope = await client.query(
      `insert into workorder_module_policy_scopes (
         scope_type, company_id, location_id, version, updated_by_user_id
       )
       select $1, $2, $3, 1, $4
       where $5::bigint is null or $5::bigint = 0
       on conflict ${locationId
    ? "(location_id) where scope_type = 'location'"
    : "(company_id) where scope_type = 'company'"} do update
       set version = workorder_module_policy_scopes.version + 1,
           updated_by_user_id = excluded.updated_by_user_id,
           updated_at = now()
       where $5::bigint is null or workorder_module_policy_scopes.version = $5::bigint
       returning *`,
      [scopeType, companyId, locationId, actorId, expectedVersion],
    );
    if (!scope.rows[0]) throw new WorkorderModulePolicyConflictError();
    const scopeId = scope.rows[0].id;
    await client.query("delete from workorder_module_access_rules where scope_id = $1", [scopeId]);
    for (const rule of rulesFromMaps(normalizedRoles, normalizedUsers)) {
      await client.query(
        `insert into workorder_module_access_rules (
           scope_id, subject_type, subject_id, role_key, user_id, surface, module_key, access, required
         ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          scopeId,
          rule.subjectType,
          rule.subjectId,
          rule.subjectType === "role" ? rule.subjectId : null,
          rule.subjectType === "user" ? rule.subjectId : null,
          rule.surface,
          rule.moduleKey,
          rule.access,
          rule.required,
        ],
      );
    }
    if (locationId) {
      await client.query(
        `insert into location_workorder_policies (
           location_id, company_id, mechanic_can_record_parts, module_access, user_module_access, updated_by_user_id
         ) values ($1, $2, $3, $4, $5, $6)
         on conflict (location_id) do update set
           mechanic_can_record_parts = excluded.mechanic_can_record_parts,
           module_access = excluded.module_access,
           user_module_access = excluded.user_module_access,
           updated_by_user_id = excluded.updated_by_user_id,
           updated_at = now()
         where location_workorder_policies.company_id = excluded.company_id`,
        [locationId, companyId, mechanicCanRecordParts, normalizedRoles, normalizedUsers, actorId],
      );
    } else {
      await client.query(
        `insert into company_workorder_module_policies (
           company_id, module_access, user_module_access, version, updated_by_user_id
         ) values ($1, $2, $3, $4, $5)
         on conflict (company_id) do update set
           module_access = excluded.module_access,
           user_module_access = excluded.user_module_access,
           version = excluded.version,
           updated_by_user_id = excluded.updated_by_user_id,
           updated_at = now()`,
        [companyId, normalizedRoles, normalizedUsers, scope.rows[0].version, actorId],
      );
    }
    await client.query("commit");
    return getNormalizedModulePolicy({ companyId, locationId }, {
      query: (text, params) => pool.query(text, params),
    });
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
