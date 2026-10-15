import { query } from "../pool.js";

function publicMaintenance(row) {
  return {
    id:row.maintenance_obligation_id,
    findingId:row.finding_id,
    inspectionId:row.inspection_id,
    inspectionNumber:row.inspection_number,
    note:row.note,
    version:Number(row.version),
    status:row.status,
    deferral:row.deferral_policy,
    sourceCompletedAt:row.source_completed_at,
    sourceLocationId:row.source_location_id,
    workorderId:row.workorder_id || undefined,
    workorderStatus:row.workorder_status || undefined,
    visitStartedAt:row.visit_started_at || null,
  };
}

export async function listInspectionMaintenance({ companyId, assetId, locationIds }, dependencies = {}) {
  if (!locationIds?.length) return [];
  const run = dependencies.query || query;
  const result = await run(`select follow_up.id,follow_up.maintenance_obligation_id,follow_up.finding_id,follow_up.inspection_id,follow_up.version,follow_up.status,
      follow_up.deferral_policy,follow_up.workorder_id,finding.note,inspection.inspection_number,
      inspection.completed_at source_completed_at,inspection.location_id source_location_id,workorder.status workorder_status,actual_visit.visit_started_at
    from inspection_finding_follow_ups follow_up
    join inspection_findings finding on finding.company_id=follow_up.company_id and finding.inspection_id=follow_up.inspection_id and finding.id=follow_up.finding_id
    join inspections inspection on inspection.company_id=follow_up.company_id and inspection.id=follow_up.inspection_id
    left join operational_workorders workorder on workorder.company_id=follow_up.company_id and workorder.id=follow_up.workorder_id
    left join lateral (
      select max(started.started_at) visit_started_at from (
        select visit.started_at from inspections visit
          where visit.company_id=follow_up.company_id and visit.asset_id=inspection.asset_id
            and visit.location_id=any($3::uuid[]) and visit.id<>inspection.id and visit.started_at is not null
        union all
        select visit_workorder.started_at from operational_workorders visit_workorder
          where visit_workorder.company_id=follow_up.company_id and visit_workorder.asset_id=inspection.asset_id
            and visit_workorder.location_id=any($3::uuid[]) and visit_workorder.started_at is not null
      ) started
    ) actual_visit on true
    where follow_up.company_id=$1 and inspection.asset_id=$2 and inspection.location_id=any($3::uuid[])
      and follow_up.maintenance_obligation_id is not null and follow_up.status <> 'superseded'
      and follow_up.status <> 'resolved_no_workorder'
    order by follow_up.opened_at,follow_up.id`, [companyId, assetId, locationIds]);
  return result.rows.map(publicMaintenance);
}

export async function getMaintenanceAsset({ assetId, companyIds }, dependencies = {}) {
  if (!companyIds?.length) return null;
  const run = dependencies.query || query;
  const result = await run(`select id,company_id,location_id,unit_type,unit_no,name from assets where id=$1 and company_id=any($2::uuid[])`, [assetId, companyIds]);
  const row=result.rows[0];
  return row ? { id:row.id,companyId:row.company_id,locationId:row.location_id,unitType:row.unit_type,unitNo:row.unit_no,name:row.name } : null;
}

export const inspectionMaintenanceRepositoryInternals={publicMaintenance};
