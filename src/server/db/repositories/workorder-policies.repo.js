import { query } from "../pool.js";

export const DEFAULT_LOCATION_WORKORDER_POLICY = Object.freeze({
  mechanicCanRecordParts: false,
});

function publicPolicy(row) {
  if (!row) return { ...DEFAULT_LOCATION_WORKORDER_POLICY };
  return {
    locationId: row.location_id,
    companyId: row.company_id,
    mechanicCanRecordParts: row.mechanic_can_record_parts === true,
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
  actorId,
}) {
  const result = await query(
    `insert into location_workorder_policies (
       location_id,
       company_id,
       mechanic_can_record_parts,
       updated_by_user_id
     )
     values ($1, $2, $3, $4)
     on conflict (location_id) do update
       set mechanic_can_record_parts = excluded.mechanic_can_record_parts,
           updated_by_user_id = excluded.updated_by_user_id,
           updated_at = now()
       where location_workorder_policies.company_id = excluded.company_id
     returning
       location_id,
       company_id,
       mechanic_can_record_parts,
       updated_by_user_id,
       updated_at`,
    [locationId, companyId, mechanicCanRecordParts, actorId],
  );
  return result.rows[0] ? publicPolicy(result.rows[0]) : null;
}

export async function getWorkorderMechanicPartsPolicy(workorderId) {
  const result = await query(
    `select
       workorder.id as workorder_id,
       coalesce(policy.mechanic_can_record_parts, false) as mechanic_can_record_parts
     from operational_workorders workorder
     left join location_workorder_policies policy
       on policy.location_id = workorder.location_id
      and policy.company_id = workorder.company_id
     where workorder.id = $1
     limit 1`,
    [workorderId],
  );
  return result.rows[0]
    ? { mechanicCanRecordParts: result.rows[0].mechanic_can_record_parts === true }
    : null;
}
