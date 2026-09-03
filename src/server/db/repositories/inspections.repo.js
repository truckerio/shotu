import crypto from "node:crypto";
import { getPool, query } from "../pool.js";
import { reserveInspectionSerial } from "./inspection-serial-counters.repo.js";
import { resolvePublishedTemplateForInspection } from "./template-definitions.repo.js";
import { canTransitionInspection, deriveInspectionResult } from "../../modules/inspections/inspection.lifecycle.js";
import { createOperationalWorkorderInTransaction, mapActiveAssetConflict } from "./operational-workorders.repo.js";
import { ensureInspectionPrintArchiveInTransaction } from "./inspection-print-archives.repo.js";
import { renderInspectionSlip } from "../../../../shared/inspection-template.js";
import { inspectionPrintSnapshotDigest, normalizeInspectionPrintSnapshot } from "../../modules/inspections/inspection-print-integrity.js";

export class InspectionConflictError extends Error {
  constructor(code = "INSPECTION_VERSION_CONFLICT", message = "Inspection changed elsewhere. Reload and try again.") {
    super(message); this.name = "InspectionConflictError"; this.statusCode = 409; this.code = code;
  }
}
function hash(value) { return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function publicSummary(row) { const hasReinspectionProjection=row&&("reinspection_blocker_code" in row||"reinspection_eligible" in row);const blocker=row?.reinspection_blocker_code??(row?.reinspection_eligible===false?"unavailable":null);return row ? { id: row.id, companyId: row.company_id, locationId: row.location_id, assetId: row.asset_id, inspectionNumber: row.inspection_number, inspectionKind: row.inspection_kind, unitType: row.unit_type, status: row.status, result: row.result || null, version: Number(row.version), asset: row.asset_snapshot, location: row.location || null, requestedAt: row.requested_at, startedAt: row.started_at || null, completedAt: row.completed_at || null, dueAt: row.due_at || null, defectCount: Number(row.defect_count || 0), followUpCount:Number(row.follow_up_count || 0), mechanic: row.mechanic || null, lineage:row.lineage_kind?{kind:row.lineage_kind,predecessorInspectionId:row.predecessor_inspection_id,sourceObservationInspectionId:row.source_observation_inspection_id}:null,...(row.status==="completed"&&hasReinspectionProjection?{reinspectionEligible:blocker===null,reinspectionBlockerCode:blocker}:{}), ...(row.answered_count == null ? {} : { progress: { answered: Number(row.answered_count), total: (row.template_snapshot?.sections || []).flatMap((section) => section.items || []).length, issues: Number(row.defect_count || 0) } }) } : null; }
function publicDetail(row) { const summary = publicSummary(row); return summary ? { ...summary, templateVersionId: row.template_version_id, templateSnapshot: row.template_snapshot, officeInstructions: row.office_instructions, finalNotes: row.final_notes, revisionReason:row.revision_reason || "", previousReportAvailable:row.previous_report_available===true, startEvidence:row.unit_type==="Truck"&&row.start_evidence_recorded_at?{odometerMiles:Number(row.odometer_miles),engineHours:row.engine_hours==null?null:Number(row.engine_hours),previousReportReviewed:row.previous_report_reviewed===true}:null, responses: row.responses || [], findings: row.findings || [], assignments: row.assignments || [], workorderLinks: row.workorder_links || [], followUps:row.follow_ups || [] } : null; }
export function encodeInspectionCursor(row) { return Buffer.from(JSON.stringify({ updatedAt: row.updated_at || row.updatedAt, id: row.id }), "utf8").toString("base64url"); }
export function decodeInspectionCursor(value) { if (!value) return null; try { const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")); if (!parsed.id || Number.isNaN(new Date(parsed.updatedAt).valueOf())) throw new Error(); return parsed; } catch { const error = new Error("Invalid inspection cursor."); error.statusCode = 400; error.code = "INVALID_INSPECTION_CURSOR"; throw error; } }

async function inspectionRow(client, id, companyIds, lock = false) {
  const result = await client.query(`select inspection.*,
    (select count(*) from inspection_findings finding where finding.company_id=inspection.company_id and finding.inspection_id=inspection.id)::int as defect_count
    from inspections inspection where inspection.id=$1 and inspection.company_id=any($2::uuid[]) ${lock ? "for update of inspection" : ""}`, [id, companyIds]);
  return result.rows[0] || null;
}
const reinspectionBlockerSql = `case
  when inspection.status <> 'completed' then 'not_completed'
  when inspection.result = 'passed' then 'source_passed'
  when exists(select 1 from inspections correction where correction.company_id=inspection.company_id and correction.predecessor_inspection_id=inspection.id and correction.lineage_kind='correction') then 'superseded_by_correction'
  when exists(select 1 from inspection_finding_follow_ups pending where pending.company_id=inspection.company_id and pending.inspection_id=inspection.id and pending.status in ('open','reopened')) then 'follow_up_open'
  when exists(select 1 from inspection_findings repair where repair.company_id=inspection.company_id and repair.inspection_id=inspection.id and repair.severity in ('repair_required','out_of_service') and (
    (repair.disposition='office_follow_up' and not exists(select 1 from inspection_finding_follow_ups resolved where resolved.company_id=repair.company_id and resolved.finding_id=repair.id and (resolved.status='resolved_no_workorder' or (resolved.status='resolved_workorder' and exists(select 1 from operational_workorders wo where wo.company_id=resolved.company_id and wo.id=resolved.workorder_id and wo.status in ('closed','odoo_entered'))))))
    or (repair.disposition in ('new_workorder','linked_workorder') and (not exists(select 1 from inspection_workorder_links link where link.company_id=repair.company_id and link.finding_id=repair.id) or exists(select 1 from inspection_workorder_links link join operational_workorders wo on wo.company_id=link.company_id and wo.id=link.workorder_id where link.company_id=repair.company_id and link.finding_id=repair.id and wo.status not in ('closed','odoo_entered'))))
  )) then 'repair_incomplete'
  when exists(select 1 from inspections active where active.company_id=inspection.company_id and active.asset_id=inspection.asset_id and active.inspection_kind=inspection.inspection_kind and active.id<>inspection.id and active.status in ('requested','assigned','in_progress')) then 'active_inspection_exists'
  when not exists(select 1 from template_assignments assignment join template_versions version on version.company_id=assignment.company_id and version.id=assignment.template_version_id and version.state='published' where assignment.company_id=inspection.company_id and assignment.family_key='inspection' and assignment.applicability_key=inspection.unit_type and assignment.location_id is not distinct from coalesce((select location_id from template_assignments override where override.company_id=inspection.company_id and override.location_id=inspection.location_id and override.family_key='inspection' and override.applicability_key=inspection.unit_type),null::uuid)) then 'template_unavailable'
  else null end`;
const inspectionDetailSelect = `select inspection.*,
  (select jsonb_build_object('id',location.id,'name',location.name) from locations location where location.id=inspection.location_id and location.company_id=inspection.company_id) as location,
  (select jsonb_build_object('id',profile.id,'name',profile.display_name) from inspection_assignments assignment join user_profiles profile on profile.id=assignment.mechanic_user_id where assignment.inspection_id=inspection.id and assignment.company_id=inspection.company_id and assignment.active and assignment.assignment_role='primary' limit 1) as mechanic,
  coalesce((select jsonb_agg(jsonb_build_object('id',response.id,'itemKey',response.item_key,'response',response.response,'naReason',response.na_reason) order by response.item_key) from inspection_responses response where response.company_id=inspection.company_id and response.inspection_id=inspection.id),'[]') as responses,
  coalesce((select jsonb_agg(jsonb_build_object('id',finding.id,'responseId',finding.response_id,'severity',finding.severity,'note',finding.note,'disposition',finding.disposition,'noWorkorderReason',finding.no_workorder_reason) order by finding.created_at,finding.id) from inspection_findings finding where finding.company_id=inspection.company_id and finding.inspection_id=inspection.id),'[]') as findings,
  coalesce((select jsonb_agg(jsonb_build_object('mechanicUserId',assignment.mechanic_user_id,'role',assignment.assignment_role) order by assignment.assignment_role,assignment.assigned_at) from inspection_assignments assignment where assignment.company_id=inspection.company_id and assignment.inspection_id=inspection.id and assignment.active),'[]') as assignments,
  coalesce((select jsonb_agg(jsonb_build_object('id',link.id,'findingId',link.finding_id,'workorderId',link.workorder_id,'workorderSerial',workorder.serial,'createdAt',link.created_at) order by link.created_at,link.id) from inspection_workorder_links link join operational_workorders workorder on workorder.company_id=link.company_id and workorder.id=link.workorder_id where link.company_id=inspection.company_id and link.inspection_id=inspection.id),'[]') as workorder_links,
  coalesce((select jsonb_agg(jsonb_build_object('id',follow_up.id,'findingId',follow_up.finding_id,'status',follow_up.status,'version',follow_up.version,'workorderId',follow_up.workorder_id,'reason',follow_up.resolution_reason) order by follow_up.opened_at,follow_up.id) from inspection_finding_follow_ups follow_up where follow_up.company_id=inspection.company_id and follow_up.inspection_id=inspection.id),'[]') as follow_ups,
  (select count(*) from inspection_finding_follow_ups follow_up where follow_up.company_id=inspection.company_id and follow_up.inspection_id=inspection.id and follow_up.status in ('open','reopened'))::int as follow_up_count,
  (select count(*) from inspection_findings finding where finding.company_id=inspection.company_id and finding.inspection_id=inspection.id)::int as defect_count,
  exists(select 1 from inspections prior where prior.company_id=inspection.company_id and prior.asset_id=inspection.asset_id and prior.id<>inspection.id and prior.status='completed' and prior.completed_at < inspection.requested_at) as previous_report_available,
  ${reinspectionBlockerSql} as reinspection_blocker_code
  from inspections inspection`;
async function inspectionDetailRow(client, id, companyIds) {
  const result = await client.query(`${inspectionDetailSelect} where inspection.id=$1 and inspection.company_id=any($2::uuid[]) limit 1`, [id, companyIds]);
  return result.rows[0] || null;
}
async function addEvent(client, row, eventType, actorId, fromStatus = null, details = {}) {
  await client.query("insert into inspection_events(company_id,inspection_id,event_type,from_status,to_status,actor_id,version,details) values($1,$2,$3,$4,$5,$6,$7,$8::jsonb)", [row.company_id, row.id, eventType, fromStatus, row.status, actorId, row.version, JSON.stringify(details)]);
}
function assertVersion(row, expectedVersion) { if (Number(row.version) !== Number(expectedVersion)) throw new InspectionConflictError(); }
function archiveSnapshot(row, responses, findings, workorderLinks = [], lineage = {}) {
  const snapshot = normalizeInspectionPrintSnapshot({ schemaVersion:1, rendererVersion:row.template_snapshot?.rendererVersion || "inspection-slip-v1", inspectionId:row.id, companyId:row.company_id, locationId:row.location_id, inspectionNumber:row.inspection_number, status:row.status, result:row.result, completedAt:row.completed_at, unit:row.asset_snapshot, templateLabel:row.template_snapshot?.label || "Weekly Inspection", templateSnapshot:row.template_snapshot, responses:responses.map((response) => ({ id:response.id, itemKey:response.item_key, response:response.response, naReason:response.na_reason })), findings:findings.map((finding) => ({ id:finding.id, responseId:finding.response_id, severity:finding.severity, note:finding.note, disposition:finding.disposition, noWorkorderReason:finding.no_workorder_reason })), finalNotes:row.final_notes || "", startEvidence:row.unit_type==="Truck"&&row.start_evidence_recorded_at?{odometerMiles:Number(row.odometer_miles),engineHours:row.engine_hours==null?null:Number(row.engine_hours),previousReportReviewed:row.previous_report_reviewed===true}:null, previousReportAvailable:row.previous_report_available===true, workordersLinked:workorderLinks.length > 0, lineageKind:row.lineage_kind || null, predecessorInspectionId:row.predecessor_inspection_id || null, revisionReason:row.revision_reason || "", ...lineage });
  const html = renderInspectionSlip(snapshot);
  return { snapshot:normalizeInspectionPrintSnapshot({ ...snapshot, html }), documentSha256:crypto.createHash("sha256").update(html).digest("hex"), documentByteSize:Buffer.byteLength(html) };
}
async function archiveCompletedInspection(client, row, responses, findings, actorId) {
  let predecessor = null;
  if (row.lineage_kind === "correction" && row.predecessor_inspection_id) {
    const result = await client.query(`select archive.*,inspection.inspection_number as predecessor_inspection_number from inspection_print_archives archive join inspections inspection on inspection.company_id=archive.company_id and inspection.id=archive.inspection_id where archive.company_id=$1 and archive.inspection_id=$2 and archive.status in ('pending','ready') order by archive.revision_number desc limit 1 for share of archive`, [row.company_id,row.predecessor_inspection_id]);
    predecessor = result.rows[0] || null;
    if (!predecessor) throw new InspectionConflictError("INSPECTION_REVISION_ARCHIVE_MISSING", "The original inspection archive is unavailable for this correction.");
  }
  const priorReport = await client.query("select exists(select 1 from inspections prior where prior.company_id=$1 and prior.asset_id=$2 and prior.id<>$3 and prior.status='completed' and prior.completed_at < $4) as previous_report_available",[row.company_id,row.asset_id,row.id,row.requested_at]);
  const workorderLinks = await client.query("select finding_id from inspection_workorder_links where company_id=$1 and inspection_id=$2", [row.company_id,row.id]);
  const document = archiveSnapshot({...row,previous_report_available:priorReport.rows[0]?.previous_report_available===true},responses,findings,workorderLinks.rows,{revisionNumber:predecessor?Number(predecessor.revision_number)+1:1,predecessorInspectionNumber:predecessor?.predecessor_inspection_number||null}); const snapshotSha256=inspectionPrintSnapshotDigest(document.snapshot);
  return ensureInspectionPrintArchiveInTransaction({ companyId:row.company_id, inspectionId:row.id, locationId:row.location_id, inspectionNumber:row.inspection_number, actorId, idempotencyKey:`inspection-complete-${row.id}`, requestSha256:crypto.createHash("sha256").update(`${row.id}:${snapshotSha256}`).digest("hex"), snapshot:document.snapshot, snapshotSha256, documentSha256:document.documentSha256, documentByteSize:document.documentByteSize, predecessorArchiveId:predecessor?.id || null, revisionNumber:predecessor ? Number(predecessor.revision_number) + 1 : 1, revisionReason:row.revision_reason || "" },client);
}

function inspectionCreateRequestHash(input) {
  return hash({
    companyId:input.companyId,locationId:input.locationId,assetId:input.assetId,
    mechanicUserIds:input.mechanicUserIds || [],dueAt:input.dueAt || null,
    officeInstructions:input.officeInstructions || "",startImmediately:input.startImmediately === true,
  });
}
async function inspectionCreateReplay(client,input,requestSha256) {
  const replay=await client.query("select inspection_id,request_sha256 from inspection_create_commands where company_id=$1 and actor_id=$2 and idempotency_key=$3 for update",[input.companyId,input.actorId,input.idempotencyKey]);
  if(!replay.rows[0])return null;
  if(replay.rows[0].request_sha256!==requestSha256)throw new InspectionConflictError("INSPECTION_CREATE_IDEMPOTENCY_CONFLICT","That idempotency key was already used for a different inspection request.");
  return inspectionDetailRow(client,replay.rows[0].inspection_id,[input.companyId]);
}
async function activeInspectionId(client,companyId,assetId,inspectionKind) {
  const active=await client.query(`select id from inspections where company_id=$1 and asset_id=$2 and inspection_kind=$3
    and status in ('requested','assigned','in_progress') order by created_at,id limit 1 for update`,[companyId,assetId,inspectionKind]);
  return active.rows[0]?.id || null;
}
async function recordInspectionCreateCommand(client,input,inspectionId,requestSha256) {
  await client.query("insert into inspection_create_commands(company_id,inspection_id,actor_id,idempotency_key,request_sha256) values($1,$2,$3,$4,$5)",[input.companyId,inspectionId,input.actorId,input.idempotencyKey,requestSha256]);
}
function isActiveInspectionUniqueConflict(error) { return error?.code==="23505"&&error?.constraint==="inspections_one_active_weekly_uidx"; }

export async function createInspection(input, dependencies = {}) {
  const pool = dependencies.pool || getPool(); const client = await pool.connect();
  const requestSha256=inspectionCreateRequestHash(input); let inspectionKind=null;
  try {
    await client.query("begin");
    if(input.startImmediately===true)throw new InspectionConflictError("INSPECTION_START_EVIDENCE_REQUIRED","Start readings and prior-report review must be recorded through the start action.");
    await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))",[`${input.companyId}:${input.actorId}:${input.idempotencyKey}`]);
    const replay=await inspectionCreateReplay(client,input,requestSha256);
    if(replay){await client.query("commit");return publicDetail(replay);}
    const scope = await client.query(`select asset.*, location.id as selected_location_id from assets asset
      join locations location on location.id=$2 and location.company_id=asset.company_id and location.active=true
      where asset.id=$1 and asset.company_id=$3 and asset.unit_type in ('Truck','Trailer') for share of asset, location`, [input.assetId, input.locationId, input.companyId]);
    const asset = scope.rows[0]; if (!asset) { const error = new Error("Inspection target not found."); error.statusCode = 404; throw error; }
    inspectionKind=asset.unit_type === "Truck" ? "weekly_truck" : "weekly_trailer";
    await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))",[`${input.companyId}:${input.assetId}:${inspectionKind}`]);
    const existingId=await activeInspectionId(client,input.companyId,input.assetId,inspectionKind);
    if(existingId){await recordInspectionCreateCommand(client,input,existingId,requestSha256);const existing=await inspectionDetailRow(client,existingId,[input.companyId]);await client.query("commit");return publicDetail(existing);}
    const template = await (dependencies.resolveTemplate || resolvePublishedTemplateForInspection)(client, { companyId: input.companyId, locationId: input.locationId, unitType: asset.unit_type, actorId: input.actorId });
    if (!template) throw new InspectionConflictError("INSPECTION_TEMPLATE_UNAVAILABLE", "No published weekly template is assigned to this unit type.");
    const mechanicIds = [...new Set(input.mechanicUserIds || [])];
    if (mechanicIds.length) {
      const members = await client.query(`select membership.user_id from user_location_memberships membership
        join user_company_memberships company_membership on company_membership.user_id=membership.user_id and company_membership.company_id=membership.company_id and company_membership.role='mechanic' and company_membership.active
        join user_profiles profile on profile.id=membership.user_id and profile.active and profile.deleted_at is null
        where membership.company_id=$1 and membership.location_id=$2 and membership.active and membership.user_id=any($3::uuid[])`, [input.companyId, input.locationId, mechanicIds]);
      if (members.rowCount !== mechanicIds.length) throw new InspectionConflictError("INSPECTION_ASSIGNMENT_INVALID", "Every mechanic must be active at this location.");
    }
    const snapshot = template.definition;
    const number = await (dependencies.reserveSerial || reserveInspectionSerial)(client, input.companyId);
    const status = mechanicIds.length ? "assigned" : "requested";
    const inserted = await client.query(`insert into inspections(company_id,location_id,asset_id,inspection_number,inspection_kind,unit_type,status,
      template_version_id,template_snapshot,template_snapshot_sha256,asset_snapshot,requested_by_user_id,due_at,office_instructions,started_at)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11::jsonb,$12,$13,$14,case when $15 then now() else null end) returning *`,
    [input.companyId,input.locationId,input.assetId,number,inspectionKind,asset.unit_type,status,template.id,JSON.stringify(snapshot),hash(snapshot),JSON.stringify({ unitNo: asset.unit_no, name: asset.name, vin: asset.vin, licensePlate: asset.license_plate, make: asset.make, model: asset.model, year: asset.year }),input.actorId,input.dueAt || null,input.officeInstructions || "",false]);
    const row = inserted.rows[0];
    for (const [index, mechanicId] of mechanicIds.entries()) {
      await client.query("insert into inspection_assignments(company_id,inspection_id,mechanic_user_id,assignment_role,assigned_by_user_id) values($1,$2,$3,$4,$5)", [input.companyId,row.id,mechanicId,index === 0 ? "primary" : "support",input.actorId]);
      await client.query("insert into inspection_assignment_events(company_id,inspection_id,mechanic_user_id,action,actor_id) values($1,$2,$3,'assigned',$4)", [input.companyId,row.id,mechanicId,input.actorId]);
    }
    await addEvent(client,row,"created",input.actorId,null);
    await recordInspectionCreateCommand(client,input,row.id,requestSha256);
    const detail = await inspectionDetailRow(client, row.id, [row.company_id]);
    await client.query("commit"); return publicDetail(detail);
  } catch (error) {
    await client.query("rollback").catch(() => {});
    if(isActiveInspectionUniqueConflict(error)&&inspectionKind){
      try{
        await client.query("begin");
        await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))",[`${input.companyId}:${input.actorId}:${input.idempotencyKey}`]);
        const replay=await inspectionCreateReplay(client,input,requestSha256);if(replay){await client.query("commit");return publicDetail(replay);}
        await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))",[`${input.companyId}:${input.assetId}:${inspectionKind}`]);
        const existingId=await activeInspectionId(client,input.companyId,input.assetId,inspectionKind);if(!existingId)throw error;
        await recordInspectionCreateCommand(client,input,existingId,requestSha256);const existing=await inspectionDetailRow(client,existingId,[input.companyId]);await client.query("commit");return publicDetail(existing);
      }catch(recoveryError){await client.query("rollback").catch(()=>{});throw recoveryError;}
    }
    throw error;
  } finally { client.release(); }
}

export async function getInspectionById({ inspectionId, companyIds }, dependencies = {}) {
  const run = dependencies.query || query;
  const result = await run(`${inspectionDetailSelect} where inspection.id=$1 and inspection.company_id=any($2::uuid[]) limit 1`, [inspectionId, companyIds]);
  return publicDetail(result.rows[0]);
}

export async function listInspections(input, dependencies = {}) {
  const run = dependencies.query || query; const after = decodeInspectionCursor(input.cursor); const values = [input.companyIds,input.locationIds,input.statuses || (input.status ? [input.status] : null),input.unitType || null,input.result || null,input.mechanicId || null,input.search || "",after?.updatedAt || null,after?.id || null,input.limit + 1,input.restrictedMechanicCompanyIds || [],input.actorId || null,input.needsAction === true];
  const result = await run(`select inspection.*,
    (select jsonb_build_object('id',location.id,'name',location.name) from locations location where location.id=inspection.location_id and location.company_id=inspection.company_id) as location,
    (select count(*) from inspection_responses response where response.company_id=inspection.company_id and response.inspection_id=inspection.id)::int as answered_count,
    (select count(*) from inspection_findings finding where finding.company_id=inspection.company_id and finding.inspection_id=inspection.id)::int as defect_count,
  (select count(*) from inspection_finding_follow_ups follow_up where follow_up.company_id=inspection.company_id and follow_up.inspection_id=inspection.id and follow_up.status in ('open','reopened'))::int as follow_up_count,
  ${reinspectionBlockerSql} as reinspection_blocker_code,
    (select jsonb_build_object('id',profile.id,'name',profile.display_name) from inspection_assignments assignment join user_profiles profile on profile.id=assignment.mechanic_user_id where assignment.inspection_id=inspection.id and assignment.company_id=inspection.company_id and assignment.active and assignment.assignment_role='primary' limit 1) as mechanic
    from inspections inspection where inspection.company_id=any($1::uuid[]) and ($2::uuid[] is null or inspection.location_id=any($2::uuid[]))
      and ($3::text[] is null or inspection.status=any($3::text[])) and ($4::text is null or inspection.unit_type=$4) and ($5::text is null or inspection.result=$5)
      and ($6::uuid is null or exists(select 1 from inspection_assignments ia where ia.inspection_id=inspection.id and ia.mechanic_user_id=$6 and ia.active))
      and (not $13::boolean or inspection.status in ('requested','assigned') or (inspection.status='completed' and exists(select 1 from inspection_finding_follow_ups action where action.company_id=inspection.company_id and action.inspection_id=inspection.id and action.status in ('open','reopened'))))
      and (not (inspection.company_id=any($11::uuid[])) or exists(select 1 from inspection_assignments restricted_assignment where restricted_assignment.inspection_id=inspection.id and restricted_assignment.company_id=inspection.company_id and restricted_assignment.mechanic_user_id=$12::uuid and restricted_assignment.active))
      and ($7='' or inspection.inspection_number ilike '%'||$7||'%' or coalesce(inspection.asset_snapshot->>'unitNo','') ilike '%'||$7||'%' or coalesce(inspection.asset_snapshot->>'vin','') ilike '%'||$7||'%' or coalesce(inspection.asset_snapshot->>'licensePlate','') ilike '%'||$7||'%')
      and ($8::timestamptz is null or (inspection.updated_at,inspection.id)<($8::timestamptz,$9::uuid))
    order by inspection.updated_at desc,inspection.id desc limit $10`, values);
  const hasMore = result.rows.length > input.limit; const rows = result.rows.slice(0,input.limit); const last = rows.at(-1);
  return { items: rows.map(publicSummary), nextCursor: hasMore && last ? encodeInspectionCursor(last) : null };
}

export async function saveInspectionResponses(input, dependencies = {}) {
  const pool = dependencies.pool || getPool(); const client = await pool.connect();
  try { await client.query("begin"); const row = await inspectionRow(client,input.inspectionId,input.companyIds,true); if (!row) return null; assertVersion(row,input.expectedVersion); if (row.status !== "in_progress") throw new InspectionConflictError("INSPECTION_NOT_EDITABLE","Only an in-progress inspection can be edited.");
    const itemMap = new Map((row.template_snapshot.sections || []).flatMap((section) => section.items || []).map((item) => [item.key,item]));
    for (const response of input.responses) {
      const item = itemMap.get(response.itemKey); if (!item) throw new InspectionConflictError("INSPECTION_ITEM_UNKNOWN","Checklist item is not part of this inspection snapshot.");
      const linked = await client.query(`select finding.id from inspection_findings finding join inspection_responses response
        on response.company_id=finding.company_id and response.inspection_id=finding.inspection_id and response.id=finding.response_id
        join inspection_workorder_links link on link.company_id=finding.company_id and link.inspection_id=finding.inspection_id and link.finding_id=finding.id
        where finding.company_id=$1 and finding.inspection_id=$2 and response.item_key=$3 limit 1 for key share`, [row.company_id,row.id,response.itemKey]);
      if (linked.rows[0]) throw new InspectionConflictError("INSPECTION_FINDING_LINKED","A finding linked to a workorder cannot be edited. Create a correction instead.");
      if (response.response === "na" && !item.allowNa) throw new InspectionConflictError("INSPECTION_NA_NOT_ALLOWED","N/A is not allowed for this check.");
      if (response.response === "na" && item.requireNaReason && !response.naReason) throw new InspectionConflictError("INSPECTION_NA_REASON_REQUIRED","Explain why this check is N/A.");
      const saved = await client.query(`insert into inspection_responses(company_id,inspection_id,item_key,response,na_reason,updated_by_user_id)
        values($1,$2,$3,$4,$5,$6) on conflict(company_id,inspection_id,item_key) do update set response=excluded.response,na_reason=excluded.na_reason,updated_by_user_id=excluded.updated_by_user_id,updated_at=now() returning id`, [row.company_id,row.id,response.itemKey,response.response,response.naReason || "",input.actorId]);
      await client.query("delete from inspection_findings where company_id=$1 and inspection_id=$2 and response_id=$3", [row.company_id,row.id,saved.rows[0].id]);
      if (response.response === "issue") await client.query(`insert into inspection_findings(company_id,inspection_id,response_id,severity,note,disposition,no_workorder_reason)
        values($1,$2,$3,$4,$5,$6,$7)`, [row.company_id,row.id,saved.rows[0].id,response.finding.severity,response.finding.note,response.finding.disposition,response.finding.noWorkorderReason || ""]);
    }
    const updated = (await client.query("update inspections set version=version+1,updated_at=now() where id=$1 returning *",[row.id])).rows[0]; await addEvent(client,updated,"responses_saved",input.actorId,row.status,{ itemKeys: input.responses.map((entry) => entry.itemKey) }); const detail = await inspectionDetailRow(client, updated.id, [updated.company_id]); await client.query("commit"); return publicDetail(detail);
  } catch(error){ await client.query("rollback").catch(()=>{}); throw error; } finally { client.release(); }
}

export async function transitionInspection(input, dependencies = {}) {
  const pool=dependencies.pool||getPool(); const client=await pool.connect();
  try { await client.query("begin"); const before=await inspectionRow(client,input.inspectionId,input.companyIds,true); if(!before)return null; assertVersion(before,input.expectedVersion); if(!canTransitionInspection(before.status,input.toStatus))throw new InspectionConflictError("INSPECTION_TRANSITION_INVALID","Inspection status transition is not allowed.");
    let eventDetails=input.details||{};
    if(input.toStatus==="in_progress"){
      if(typeof input.previousReportReviewed!=="boolean")throw new InspectionConflictError("INSPECTION_START_EVIDENCE_REQUIRED","Prior-report review evidence is required to start an inspection.");
      if(before.unit_type==="Truck"){
        if(typeof input.odometerMiles!=="number"||!Number.isFinite(input.odometerMiles)||input.odometerMiles<0||input.odometerMiles>99_999_999.9)throw new InspectionConflictError("INSPECTION_ODOMETER_REQUIRED","A valid truck odometer reading is required to start.");
        if(input.engineHours!==undefined&&(typeof input.engineHours!=="number"||!Number.isFinite(input.engineHours)||input.engineHours<0||input.engineHours>9_999_999.9))throw new InspectionConflictError("INSPECTION_ENGINE_HOURS_INVALID","Engine hours must be a valid non-negative reading.");
      }else if(input.odometerMiles!==undefined||input.engineHours!==undefined)throw new InspectionConflictError("INSPECTION_TRAILER_READINGS_UNSUPPORTED","Trailer inspections do not accept odometer or engine-hour readings in V1.");
      const prior=await client.query("select exists(select 1 from inspections prior where prior.company_id=$1 and prior.asset_id=$2 and prior.id<>$3 and prior.status='completed' and prior.completed_at < $4) as previous_report_available",[before.company_id,before.asset_id,before.id,before.requested_at]);
      if(prior.rows[0]?.previous_report_available===true&&input.previousReportReviewed!==true)throw new InspectionConflictError("INSPECTION_PREVIOUS_REPORT_REVIEW_REQUIRED","Review the previous completed inspection before starting.");
      eventDetails={startEvidence:{odometerMilesPresent:input.odometerMiles!==undefined,engineHoursPresent:input.engineHours!==undefined,previousReportReviewedPresent:true}};
    }
    let result=null; let completedAnswers=[]; let completedFindings=[]; if(input.toStatus==="completed"){
      if(input.completionAuthority==="primary_mechanic"){
        const primary=await client.query("select 1 from inspection_assignments where company_id=$1 and inspection_id=$2 and mechanic_user_id=$3 and active and assignment_role='primary' limit 1",[before.company_id,before.id,input.actorId]);
        if(!primary.rows[0])throw new InspectionConflictError("INSPECTION_PRIMARY_REQUIRED","Only the active primary mechanic can complete this inspection.");
      }else if(input.completionAuthority==="admin_inspector"&&input.details?.actingAsInspector===true){
        const admin=await client.query("select 1 from user_company_memberships where company_id=$1 and user_id=$2 and role='admin' and active limit 1",[before.company_id,input.actorId]);
        if(!admin.rows[0])throw new InspectionConflictError("INSPECTION_ADMIN_INSPECTOR_REQUIRED","Admin inspector authority is no longer active.");
      }else throw new InspectionConflictError("INSPECTION_COMPLETION_AUTHORITY_REQUIRED","Completion requires active primary-mechanic or explicit Admin inspector authority.");
      const required=(before.template_snapshot.sections||[]).flatMap((s)=>s.items||[]).filter((i)=>i.required); const answers=await client.query("select * from inspection_responses where company_id=$1 and inspection_id=$2",[before.company_id,before.id]); completedAnswers=answers.rows; const answered=new Set(answers.rows.map((r)=>r.item_key)); if(required.some((item)=>!answered.has(item.key)))throw new InspectionConflictError("INSPECTION_INCOMPLETE","Answer every required check before completion.");
      const findings=await client.query("select * from inspection_findings where company_id=$1 and inspection_id=$2",[before.company_id,before.id]); completedFindings=findings.rows;
      const issueCount=answers.rows.filter((answer)=>answer.response==="issue").length;
      if(issueCount!==findings.rowCount)throw new InspectionConflictError("INSPECTION_FINDING_REQUIRED","Every Issue needs severity, note, and disposition before completion.");
      const missingLinks = await client.query(`select finding.id from inspection_findings finding
        where finding.company_id=$1 and finding.inspection_id=$2 and finding.disposition in ('new_workorder','linked_workorder')
          and not exists (select 1 from inspection_workorder_links link where link.company_id=finding.company_id and link.inspection_id=finding.inspection_id and link.finding_id=finding.id)
        limit 1`, [before.company_id, before.id]);
      if (missingLinks.rows[0]) throw new InspectionConflictError("INSPECTION_WORKORDER_LINK_REQUIRED", "Link every finding marked for a workorder before completion.");
      for(const finding of findings.rows.filter((entry)=>entry.disposition==="office_follow_up")){
        const followUp=(await client.query("insert into inspection_finding_follow_ups(company_id,inspection_id,finding_id) values($1,$2,$3) returning *",[before.company_id,before.id,finding.id])).rows[0];
        await client.query("insert into inspection_finding_follow_up_events(company_id,follow_up_id,event_type,from_status,to_status,actor_id,details) values($1,$2,'opened',null,'open',$3,$4::jsonb)",[before.company_id,followUp.id,input.actorId,JSON.stringify({source:"inspection_completion"})]);
      }
      result=deriveInspectionResult(findings.rows); await client.query(`insert into service_history_orders(company_id,source_provider,external_id,reference,status,asset_id,ordered_at,completed_at,source_updated_at,raw_metadata,last_seen_at,recorded_at,completion_date_kind,inspection_id)
        values($1,'local_inspection',$2::uuid::text,$3,'completed',$4,$5,now(),now(),$6::jsonb,now(),$5,'verified_completed',$2::uuid)
        on conflict(company_id,source_provider,external_id) do nothing`,[before.company_id,before.id,before.inspection_number,before.asset_id,before.requested_at,JSON.stringify({ result, inspectionKind: before.inspection_kind })]);
      const history=await client.query("select id from service_history_orders where company_id=$1 and source_provider='local_inspection' and external_id=$2",[before.company_id,before.id]); for(const [index,finding] of findings.rows.entries())await client.query(`insert into service_history_lines(company_id,service_order_id,external_id,sequence,line_index,line_kind,description,raw_payload)
        values($1,$2,$3,$4::integer::numeric,$4::integer,'service',$5,$6::jsonb) on conflict(company_id,service_order_id,external_id) do nothing`,[before.company_id,history.rows[0].id,finding.id,index,finding.note,JSON.stringify({ severity:finding.severity })]);
    }
    const updated=(await client.query(`update inspections set status=$2,result=$3,final_notes=case when $2='completed' then $4 else final_notes end,
      started_at=case when $2='in_progress' then coalesce(started_at,now()) else started_at end,
      odometer_miles=case when $2='in_progress' then $5 else odometer_miles end,engine_hours=case when $2='in_progress' then $6 else engine_hours end,
      previous_report_reviewed=case when $2='in_progress' then $7 else previous_report_reviewed end,start_evidence_recorded_at=case when $2='in_progress' then now() else start_evidence_recorded_at end,
      completed_at=case when $2='completed' then now() else completed_at end,cancelled_at=case when $2='cancelled' then now() else cancelled_at end,version=version+1,updated_at=now() where id=$1 returning *`,[before.id,input.toStatus,result,input.finalNotes||"",input.odometerMiles??null,input.engineHours??null,input.previousReportReviewed??null])).rows[0]; await addEvent(client,updated,input.toStatus,input.actorId,before.status,eventDetails); if(input.toStatus==="completed") await archiveCompletedInspection(client,updated,completedAnswers,completedFindings,input.actorId); const detail = await inspectionDetailRow(client, updated.id, [updated.company_id]); await client.query("commit"); return publicDetail(detail);
  }catch(error){await client.query("rollback").catch(()=>{});throw error;}finally{client.release();}
}

async function completedSource(client,input){const before=await inspectionRow(client,input.inspectionId,input.companyIds,true);if(!before)return null;assertVersion(before,input.expectedVersion);if(before.status!=="completed")throw new InspectionConflictError("INSPECTION_LINEAGE_NOT_COMPLETED","Only a completed inspection can be corrected or reinspected.");const completion=(await client.query("select id from inspection_events where company_id=$1 and inspection_id=$2 and event_type in ('completed','correction_created') order by created_at desc,id desc limit 1 for share",[before.company_id,before.id])).rows[0];if(!completion)throw new InspectionConflictError("INSPECTION_COMPLETION_EVIDENCE_MISSING","The source completion evidence is unavailable.");return{before,completion};}
async function typedReplay(client,table,idColumn,companyId,input,requestSha256){const replay=await client.query(`select ${idColumn},request_sha256 from ${table} where company_id=$1 and actor_id=$2 and idempotency_key=$3 for update`,[companyId,input.actorId,input.idempotencyKey]);if(!replay.rows[0])return null;if(replay.rows[0].request_sha256!==requestSha256)throw new InspectionConflictError("INSPECTION_LINEAGE_IDEMPOTENCY_CONFLICT","That idempotency key was already used for a different command.");return inspectionDetailRow(client,replay.rows[0][idColumn],[companyId]);}

export async function createInspectionCorrection(input,dependencies={}){
  const pool=dependencies.pool||getPool();const client=await pool.connect();const requestSha256=hash({inspectionId:input.inspectionId,expectedVersion:input.expectedVersion,reason:input.reason,changes:input.changes,actorId:input.actorId});
  try{await client.query("begin");const initial=await inspectionRow(client,input.inspectionId,input.companyIds,true);if(!initial)return null;await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))",[`${initial.company_id}:${input.actorId}:${input.idempotencyKey}`]);const replay=await typedReplay(client,"inspection_correction_commands","correction_inspection_id",initial.company_id,input,requestSha256);if(replay){await client.query("commit");return publicDetail(replay);}const source=await completedSource(client,input);const{before,completion}=source;const successor=await client.query("select id from inspections where company_id=$1 and predecessor_inspection_id=$2 and lineage_kind='correction' limit 1 for update",[before.company_id,before.id]);if(successor.rows[0])throw new InspectionConflictError("INSPECTION_CORRECTION_SUPERSEDED","This inspection already has a correction. Correct the latest effective revision instead.");const number=await reserveInspectionSerial(client,before.company_id);
    const row=(await client.query(`insert into inspections(company_id,location_id,asset_id,inspection_number,inspection_kind,unit_type,status,result,template_version_id,template_snapshot,template_snapshot_sha256,asset_snapshot,requested_by_user_id,due_at,office_instructions,final_notes,requested_at,started_at,completed_at,odometer_miles,engine_hours,previous_report_reviewed,start_evidence_recorded_at,predecessor_inspection_id,revision_reason,lineage_kind,source_observation_inspection_id,source_completion_event_id)
      values($1,$2,$3,$4,$5,$6,'completed',$7,$8,$9::jsonb,$10,$11::jsonb,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,'correction',$25,$26) returning *`,[before.company_id,before.location_id,before.asset_id,number,before.inspection_kind,before.unit_type,before.result,before.template_version_id,JSON.stringify(before.template_snapshot),before.template_snapshot_sha256,JSON.stringify(before.asset_snapshot),input.actorId,before.due_at,before.office_instructions,input.changes.finalNotes??before.final_notes,before.requested_at,before.started_at,before.completed_at,before.odometer_miles,before.engine_hours,before.previous_report_reviewed,before.start_evidence_recorded_at,before.id,input.reason,before.source_observation_inspection_id||before.id,completion.id])).rows[0];
    await client.query(`insert into inspection_assignments(company_id,inspection_id,mechanic_user_id,assignment_role,active,assigned_by_user_id,assigned_at) select company_id,$2,mechanic_user_id,assignment_role,active,$3,assigned_at from inspection_assignments where company_id=$1 and inspection_id=$4 and active`,[before.company_id,row.id,input.actorId,before.id]);
    await client.query(`insert into inspection_responses(company_id,inspection_id,item_key,response,na_reason,updated_by_user_id,created_at,updated_at) select company_id,$2,item_key,response,na_reason,updated_by_user_id,created_at,updated_at from inspection_responses where company_id=$1 and inspection_id=$3`,[before.company_id,row.id,before.id]);
    await client.query(`insert into inspection_findings(company_id,inspection_id,response_id,severity,note,disposition,no_workorder_reason,created_at,updated_at) select finding.company_id,$2,target.id,finding.severity,finding.note,finding.disposition,finding.no_workorder_reason,finding.created_at,finding.updated_at from inspection_findings finding join inspection_responses source on source.company_id=finding.company_id and source.inspection_id=finding.inspection_id and source.id=finding.response_id join inspection_responses target on target.company_id=source.company_id and target.inspection_id=$2 and target.item_key=source.item_key where finding.company_id=$1 and finding.inspection_id=$3`,[before.company_id,row.id,before.id]);
    const itemMap=new Map((before.template_snapshot.sections||[]).flatMap((section)=>section.items||[]).map((item)=>[item.key,item]));for(const change of input.changes.responses||[]){const item=itemMap.get(change.itemKey);if(!item)throw new InspectionConflictError("INSPECTION_ITEM_UNKNOWN","Checklist item is not part of this inspection snapshot.");if(change.response==="na"&&!item.allowNa)throw new InspectionConflictError("INSPECTION_NA_NOT_ALLOWED","N/A is not allowed for this check.");if(change.response==="na"&&item.requireNaReason&&!change.naReason)throw new InspectionConflictError("INSPECTION_NA_REASON_REQUIRED","Explain why this check is N/A.");const response=(await client.query("update inspection_responses set response=$3,na_reason=$4,updated_by_user_id=$5,updated_at=now() where company_id=$1 and inspection_id=$2 and item_key=$6 returning id",[before.company_id,row.id,change.response,change.naReason||"",input.actorId,change.itemKey])).rows[0];if(!response)throw new InspectionConflictError("INSPECTION_RESPONSE_MISSING","The source response is unavailable.");await client.query("delete from inspection_findings where company_id=$1 and inspection_id=$2 and response_id=$3",[before.company_id,row.id,response.id]);if(change.response==="issue")await client.query("insert into inspection_findings(company_id,inspection_id,response_id,severity,note,disposition,no_workorder_reason) values($1,$2,$3,$4,$5,$6,$7)",[before.company_id,row.id,response.id,change.finding.severity,change.finding.note,change.finding.disposition,change.finding.noWorkorderReason||""]);}
    const copiedLinks=await client.query(`select target_finding.id as finding_id,link.workorder_id from inspection_workorder_links link join inspection_findings source_finding on source_finding.company_id=link.company_id and source_finding.inspection_id=link.inspection_id and source_finding.id=link.finding_id join inspection_responses source_response on source_response.company_id=source_finding.company_id and source_response.inspection_id=source_finding.inspection_id and source_response.id=source_finding.response_id join inspection_responses target_response on target_response.company_id=source_response.company_id and target_response.inspection_id=$2 and target_response.item_key=source_response.item_key join inspection_findings target_finding on target_finding.company_id=target_response.company_id and target_finding.inspection_id=target_response.inspection_id and target_finding.response_id=target_response.id where link.company_id=$1 and link.inspection_id=$3 and target_finding.disposition=source_finding.disposition`,[before.company_id,row.id,before.id]);for(const link of copiedLinks.rows){const linkHash=hash({correctionInspectionId:row.id,findingId:link.finding_id,workorderId:link.workorder_id});const linkKey=`correction-${row.id}-${linkHash.slice(0,24)}`;await client.query("insert into inspection_workorder_links(company_id,inspection_id,finding_id,workorder_id,linked_by_user_id,idempotency_key,request_sha256) values($1,$2,$3,$4,$5,$6,$7)",[before.company_id,row.id,link.finding_id,link.workorder_id,input.actorId,linkKey,linkHash]);}
    const missingLinks=await client.query(`select finding.id from inspection_findings finding where finding.company_id=$1 and finding.inspection_id=$2 and finding.disposition in ('new_workorder','linked_workorder') and not exists(select 1 from inspection_workorder_links link where link.company_id=finding.company_id and link.inspection_id=finding.inspection_id and link.finding_id=finding.id) limit 1`,[before.company_id,row.id]);if(missingLinks.rows[0])throw new InspectionConflictError("INSPECTION_CORRECTION_LINK_REQUIRED","A correction cannot introduce a workorder disposition without preserved link evidence.");
    const officeFindings=await client.query(`select target.id as target_finding_id,source_follow_up.id as source_follow_up_id,source_follow_up.status,source_follow_up.workorder_id,source_follow_up.resolution_reason,source_follow_up.resolved_at,source_follow_up.resolved_by_user_id from inspection_findings target join inspection_responses target_response on target_response.company_id=target.company_id and target_response.inspection_id=target.inspection_id and target_response.id=target.response_id left join inspection_responses source_response on source_response.company_id=target_response.company_id and source_response.inspection_id=$3 and source_response.item_key=target_response.item_key left join inspection_findings source_finding on source_finding.company_id=source_response.company_id and source_finding.inspection_id=source_response.inspection_id and source_finding.response_id=source_response.id and source_finding.disposition=target.disposition left join inspection_finding_follow_ups source_follow_up on source_follow_up.company_id=source_finding.company_id and source_follow_up.finding_id=source_finding.id where target.company_id=$1 and target.inspection_id=$2 and target.disposition='office_follow_up'`,[before.company_id,row.id,before.id]);for(const finding of officeFindings.rows){const copiedStatus=finding.status||"open";const followUp=(await client.query("insert into inspection_finding_follow_ups(company_id,inspection_id,finding_id,status,workorder_id,resolution_reason,resolved_at,resolved_by_user_id) values($1,$2,$3,$4,$5,$6,$7,$8) returning *",[before.company_id,row.id,finding.target_finding_id,copiedStatus,finding.workorder_id||null,finding.resolution_reason||"",finding.resolved_at||null,finding.resolved_by_user_id||null])).rows[0];await client.query("insert into inspection_finding_follow_up_events(company_id,follow_up_id,event_type,from_status,to_status,actor_id,workorder_id,reason,details) values($1,$2,'opened',null,'open',$3,$4,$5,$6::jsonb)",[before.company_id,followUp.id,input.actorId,finding.workorder_id||null,finding.resolution_reason||"",JSON.stringify({source:"inspection_correction",sourceInspectionId:before.id})]);if(copiedStatus!=="open")await client.query("insert into inspection_finding_follow_up_events(company_id,follow_up_id,event_type,from_status,to_status,actor_id,workorder_id,reason,details) values($1,$2,$3,'open',$3,$4,$5,$6,$7::jsonb)",[before.company_id,followUp.id,copiedStatus,input.actorId,finding.workorder_id||null,finding.resolution_reason||"",JSON.stringify({source:"inspection_correction_copy",sourceFollowUpId:finding.source_follow_up_id})]);}
    const answers=(await client.query("select * from inspection_responses where company_id=$1 and inspection_id=$2",[before.company_id,row.id])).rows;const findings=(await client.query("select * from inspection_findings where company_id=$1 and inspection_id=$2",[before.company_id,row.id])).rows;row.result=deriveInspectionResult(findings);await client.query("update inspections set result=$2 where id=$1",[row.id,row.result]);const observationId=before.source_observation_inspection_id||before.id;const history=(await client.query(`update service_history_orders set raw_metadata=raw_metadata||$3::jsonb,source_updated_at=now(),last_seen_at=now(),updated_at=now() where company_id=$1 and source_provider='local_inspection' and inspection_id=$2 returning id`,[before.company_id,observationId,JSON.stringify({sourceObservationInspectionId:observationId,latestCorrectionInspectionId:row.id,correctionReason:input.reason,correctedResult:row.result})])).rows[0];if(!history)throw new InspectionConflictError("INSPECTION_SERVICE_HISTORY_MISSING","The source service-history occurrence is unavailable.");await client.query("delete from service_history_lines where company_id=$1 and service_order_id=$2",[before.company_id,history.id]);for(const[index,finding]of findings.entries())await client.query(`insert into service_history_lines(company_id,service_order_id,external_id,sequence,line_index,line_kind,description,raw_payload) values($1,$2,$3,$4::integer::numeric,$4::integer,'service',$5,$6::jsonb)`,[before.company_id,history.id,finding.id,index,finding.note,JSON.stringify({severity:finding.severity,sourceObservationInspectionId:observationId,correctionInspectionId:row.id})]);await addEvent(client,row,"correction_created",input.actorId,"completed",{predecessorInspectionId:before.id,sourceCompletionEventId:completion.id,reason:input.reason,changedFields:{finalNotes:input.changes.finalNotes!==undefined,itemKeys:(input.changes.responses||[]).map((entry)=>entry.itemKey)}});await archiveCompletedInspection(client,row,answers,findings,input.actorId);await client.query("insert into inspection_correction_commands(company_id,predecessor_inspection_id,correction_inspection_id,actor_id,idempotency_key,request_sha256) values($1,$2,$3,$4,$5,$6)",[before.company_id,before.id,row.id,input.actorId,input.idempotencyKey,requestSha256]);const detail=await inspectionDetailRow(client,row.id,[row.company_id]);await client.query("commit");return publicDetail(detail);
  }catch(error){await client.query("rollback").catch(()=>{});if(error?.code==="23505"&&error?.constraint==="inspections_one_correction_successor_uidx")throw new InspectionConflictError("INSPECTION_CORRECTION_SUPERSEDED","This inspection already has a correction. Correct the latest effective revision instead.");throw error;}finally{client.release();}
}

export async function createInspectionReinspection(input,dependencies={}){
  const pool=dependencies.pool||getPool();const client=await pool.connect();const mechanicIds=[...new Set(input.mechanicUserIds||[])];const requestSha256=hash({inspectionId:input.inspectionId,expectedVersion:input.expectedVersion,reason:input.reason,mechanicUserIds:mechanicIds,startImmediately:input.startImmediately===true,actorId:input.actorId});
  if(input.startImmediately===true){client.release();throw new InspectionConflictError("INSPECTION_START_EVIDENCE_REQUIRED","A reinspection must be started separately with current readings and review evidence.");}
  try{await client.query("begin");const initial=await inspectionRow(client,input.inspectionId,input.companyIds,true);if(!initial)return null;await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))",[`${initial.company_id}:${input.actorId}:${input.idempotencyKey}`]);const replay=await typedReplay(client,"inspection_reinspection_commands","reinspection_id",initial.company_id,input,requestSha256);if(replay){await client.query("commit");return publicDetail(replay);}const{before,completion}=await completedSource(client,input);if(before.result==="passed")throw new InspectionConflictError("INSPECTION_REINSPECTION_SOURCE_PASSED","A passed inspection does not require reinspection.");
    const correction=await client.query("select id from inspections where company_id=$1 and predecessor_inspection_id=$2 and lineage_kind='correction' limit 1 for share",[before.company_id,before.id]);if(correction.rows[0])throw new InspectionConflictError("INSPECTION_REINSPECTION_SOURCE_SUPERSEDED","Reinspect the latest corrected inspection instead.");
    const pending=await client.query("select 1 from inspection_finding_follow_ups where company_id=$1 and inspection_id=$2 and status in ('open','reopened') limit 1",[before.company_id,before.id]);if(pending.rows[0])throw new InspectionConflictError("INSPECTION_REINSPECTION_FOLLOW_UP_OPEN","Resolve every Office follow-up before reinspection.");
    const blocker=await client.query(`select repair.id from inspection_findings repair where repair.company_id=$1 and repair.inspection_id=$2 and repair.severity in ('repair_required','out_of_service') and ((repair.disposition='office_follow_up' and not exists(select 1 from inspection_finding_follow_ups resolved where resolved.company_id=repair.company_id and resolved.finding_id=repair.id and (resolved.status='resolved_no_workorder' or (resolved.status='resolved_workorder' and exists(select 1 from operational_workorders wo where wo.company_id=resolved.company_id and wo.id=resolved.workorder_id and wo.status in ('closed','odoo_entered')))))) or (repair.disposition in ('new_workorder','linked_workorder') and (not exists(select 1 from inspection_workorder_links link where link.company_id=repair.company_id and link.finding_id=repair.id) or exists(select 1 from inspection_workorder_links link join operational_workorders wo on wo.company_id=link.company_id and wo.id=link.workorder_id where link.company_id=repair.company_id and link.finding_id=repair.id and wo.status not in ('closed','odoo_entered'))))) limit 1`,[before.company_id,before.id]);if(blocker.rows[0])throw new InspectionConflictError("INSPECTION_REINSPECTION_REPAIR_INCOMPLETE","Every repair-required finding must have an approved no-workorder resolution or terminal repair workorder.");
    if(mechanicIds.length){const members=await client.query(`select membership.user_id from user_location_memberships membership join user_company_memberships company_membership on company_membership.user_id=membership.user_id and company_membership.company_id=membership.company_id and company_membership.role='mechanic' and company_membership.active join user_profiles profile on profile.id=membership.user_id and profile.active and profile.deleted_at is null where membership.company_id=$1 and membership.location_id=$2 and membership.active and membership.user_id=any($3::uuid[])`,[before.company_id,before.location_id,mechanicIds]);if(members.rowCount!==mechanicIds.length)throw new InspectionConflictError("INSPECTION_ASSIGNMENT_INVALID","Every mechanic must be active at this location.");}
    const template=await(dependencies.resolveTemplate||resolvePublishedTemplateForInspection)(client,{companyId:before.company_id,locationId:before.location_id,unitType:before.unit_type,actorId:null});if(!template)throw new InspectionConflictError("INSPECTION_REINSPECTION_TEMPLATE_UNAVAILABLE","A current published template assignment is required.");await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))",[`${before.company_id}:${before.asset_id}:${before.inspection_kind}`]);const active=await activeInspectionId(client,before.company_id,before.asset_id,before.inspection_kind);if(active)throw new InspectionConflictError("INSPECTION_ACTIVE_EXISTS","This unit already has an active weekly inspection.");const number=await reserveInspectionSerial(client,before.company_id);const status=input.startImmediately?"in_progress":mechanicIds.length?"assigned":"requested";const sourceObservationId=before.source_observation_inspection_id||before.id;
    const row=(await client.query(`insert into inspections(company_id,location_id,asset_id,inspection_number,inspection_kind,unit_type,status,template_version_id,template_snapshot,template_snapshot_sha256,asset_snapshot,requested_by_user_id,due_at,office_instructions,started_at,predecessor_inspection_id,revision_reason,lineage_kind,source_observation_inspection_id,source_completion_event_id) values($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11::jsonb,$12,$13,$14,case when $7='in_progress' then now() end,$15,$16,'reinspection',$17,$18) returning *`,[before.company_id,before.location_id,before.asset_id,number,before.inspection_kind,before.unit_type,status,template.id,JSON.stringify(template.definition),template.definitionSha256,JSON.stringify(before.asset_snapshot),input.actorId,before.due_at,"",before.id,input.reason,sourceObservationId,completion.id])).rows[0];for(const[index,mechanicId]of mechanicIds.entries()){await client.query("insert into inspection_assignments(company_id,inspection_id,mechanic_user_id,assignment_role,assigned_by_user_id) values($1,$2,$3,$4,$5)",[row.company_id,row.id,mechanicId,index===0?"primary":"support",input.actorId]);await client.query("insert into inspection_assignment_events(company_id,inspection_id,mechanic_user_id,action,actor_id) values($1,$2,$3,'assigned',$4)",[row.company_id,row.id,mechanicId,input.actorId]);}await addEvent(client,row,"reinspection_created",input.actorId,"completed",{predecessorInspectionId:before.id,sourceCompletionEventId:completion.id,reason:input.reason,templateVersionId:template.id});await client.query("insert into inspection_reinspection_commands(company_id,predecessor_inspection_id,reinspection_id,actor_id,idempotency_key,request_sha256) values($1,$2,$3,$4,$5,$6)",[before.company_id,before.id,row.id,input.actorId,input.idempotencyKey,requestSha256]);const detail=await inspectionDetailRow(client,row.id,[row.company_id]);await client.query("commit");return publicDetail(detail);
  }catch(error){await client.query("rollback").catch(()=>{});throw mapActiveAssetConflict(error);}finally{client.release();}
}

export async function createInspectionWorkorder(input, dependencies = {}) {
  const pool=dependencies.pool||getPool(); const client=await pool.connect();
  try { await client.query("begin"); const row=await inspectionRow(client,input.inspectionId,input.companyIds,true); if(!row)return null;
    const findingIds=[...new Set(input.findingIds||[])].sort(); const requestSha256=hash({inspectionId:row.id,findingIds,actorId:input.actorId,concern:input.concern||"",officeNotes:input.officeNotes||""});
    await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`${row.company_id}:${row.id}:${input.idempotencyKey}`]);
    const replay=await client.query("select workorder_id,request_sha256 from inspection_workorder_create_commands where company_id=$1 and actor_id=$2 and idempotency_key=$3 for update",[row.company_id,input.actorId,input.idempotencyKey]);
    if(replay.rows[0]) { if(replay.rows[0].request_sha256!==requestSha256) throw linkConflict("INSPECTION_WORKORDER_CREATE_IDEMPOTENCY_CONFLICT","That idempotency key was already used for a different inspection workorder."); const detail=await inspectionDetailRow(client,row.id,[row.company_id]); await client.query("commit"); return { inspection:publicDetail(detail),workorderId:replay.rows[0].workorder_id,replayed:true }; }
    assertVersion(row,input.expectedVersion); if(row.status!=="in_progress") throw linkConflict("INSPECTION_NOT_EDITABLE","Only an in-progress inspection can create a workorder."); if(!findingIds.length) throw linkConflict("INSPECTION_FINDING_REQUIRED","Select at least one finding for the workorder.");
    const findings=await client.query("select * from inspection_findings where company_id=$1 and inspection_id=$2 and id=any($3::uuid[]) for update",[row.company_id,row.id,findingIds]); if(findings.rowCount!==findingIds.length||findings.rows.some((finding)=>finding.disposition!=="new_workorder")) throw linkConflict("INSPECTION_FINDING_NOT_ELIGIBLE","Selected findings must be marked Create workorder.");
    const alreadyLinked=await client.query("select 1 from inspection_workorder_links where company_id=$1 and inspection_id=$2 and finding_id=any($3::uuid[]) limit 1",[row.company_id,row.id,findingIds]); if(alreadyLinked.rows[0]) throw linkConflict("INSPECTION_FINDING_ALREADY_LINKED","A selected finding is already linked to a workorder.");
    const concern=input.concern || findings.rows.map((finding)=>finding.note).join("; "); const createWorkorder=dependencies.createWorkorder||createOperationalWorkorderInTransaction; const workorder=await createWorkorder({companyId:row.company_id,locationId:row.location_id,assetId:row.asset_id,createdByUserId:input.actorId,concern,officeNotes:input.officeNotes||`Created from inspection ${row.inspection_number}.`,formData:{unitNo:row.asset_snapshot?.unitNo||"",unitType:row.unit_type,vinNo:row.asset_snapshot?.vin||"",licenseNo:row.asset_snapshot?.licensePlate||""}},client);
    for(const finding of findings.rows){const linkKey=`inspection-create-${row.id}-${finding.id}`; const linkHash=hash({inspectionId:row.id,findingId:finding.id,workorderId:workorder.id,actorId:input.actorId}); await client.query("insert into inspection_workorder_links(company_id,inspection_id,finding_id,workorder_id,linked_by_user_id,idempotency_key,request_sha256) values($1,$2,$3,$4,$5,$6,$7)",[row.company_id,row.id,finding.id,workorder.id,input.actorId,linkKey,linkHash]);}
    const updated=(await client.query("update inspections set version=version+1,updated_at=now() where id=$1 returning *",[row.id])).rows[0]; await addEvent(client,updated,"workorder_created",input.actorId,row.status,{findingIds,workorderId:workorder.id,workorderSerial:workorder.serial}); await client.query("insert into inspection_workorder_create_commands(company_id,inspection_id,workorder_id,actor_id,idempotency_key,request_sha256) values($1,$2,$3,$4,$5,$6)",[row.company_id,row.id,workorder.id,input.actorId,input.idempotencyKey,requestSha256]); const detail=await inspectionDetailRow(client,row.id,[row.company_id]); await client.query("commit"); return {inspection:publicDetail(detail),workorderId:workorder.id,workorderSerial:workorder.serial,replayed:false};
  } catch(error){await client.query("rollback").catch(()=>{});throw mapActiveAssetConflict(error);} finally {client.release();}
}

export async function resolveInspectionFollowUp(input, dependencies = {}) {
  const pool=dependencies.pool||getPool();const client=await pool.connect();
  try{
    await client.query("begin");
    const inspection=await inspectionRow(client,input.inspectionId,input.companyIds,true);if(!inspection)return null;
    if(inspection.status!=="completed")throw new InspectionConflictError("INSPECTION_FOLLOW_UP_NOT_COMPLETED","Only a completed inspection follow-up can be resolved.");
    const requestSha256=hash({inspectionId:inspection.id,findingId:input.findingId,action:input.action,expectedVersion:input.expectedVersion,workorderId:input.workorderId||null,reason:input.reason||"",concern:input.concern||"",officeNotes:input.officeNotes||""});
    await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))",[`${inspection.company_id}:${input.actorId}:${input.idempotencyKey}`]);
    const replay=await client.query(`select command.request_sha256,command.workorder_id,follow_up.inspection_id from inspection_follow_up_commands command
      join inspection_finding_follow_ups follow_up on follow_up.company_id=command.company_id and follow_up.id=command.follow_up_id
      where command.company_id=$1 and command.actor_id=$2 and command.idempotency_key=$3 for update of command`,[inspection.company_id,input.actorId,input.idempotencyKey]);
    if(replay.rows[0]){if(replay.rows[0].request_sha256!==requestSha256)throw new InspectionConflictError("INSPECTION_FOLLOW_UP_IDEMPOTENCY_CONFLICT","That idempotency key was already used for a different follow-up decision.");const detail=await inspectionDetailRow(client,replay.rows[0].inspection_id,[inspection.company_id]);await client.query("commit");return{inspection:publicDetail(detail),workorderId:replay.rows[0].workorder_id||null,replayed:true};}
    const followUpResult=await client.query(`select follow_up.*,finding.note from inspection_finding_follow_ups follow_up
      join inspection_findings finding on finding.company_id=follow_up.company_id and finding.inspection_id=follow_up.inspection_id and finding.id=follow_up.finding_id
      where follow_up.company_id=$1 and follow_up.inspection_id=$2 and follow_up.finding_id=$3 for update of follow_up`,[inspection.company_id,inspection.id,input.findingId]);
    const followUp=followUpResult.rows[0];if(!followUp)throw new InspectionConflictError("INSPECTION_FOLLOW_UP_NOT_FOUND","Inspection follow-up not found.");
    if(Number(followUp.version)!==Number(input.expectedVersion))throw new InspectionConflictError();
    if(!["open","reopened"].includes(followUp.status))throw new InspectionConflictError("INSPECTION_FOLLOW_UP_RESOLVED","This follow-up is already resolved.");
    let workorder=null;
    if(input.action==="link_workorder"){
      const target=await client.query("select id,serial,status from operational_workorders where company_id=$1 and id=$2 and location_id=$3 and asset_id=$4 and status in ('open','accepted','in_progress') for update",[inspection.company_id,input.workorderId,inspection.location_id,inspection.asset_id]);
      if(!target.rows[0])throw new InspectionConflictError("INSPECTION_WORKORDER_INELIGIBLE","Workorder must be active for the same unit and location.");workorder=target.rows[0];
    }else if(input.action==="create_workorder"){
      const createWorkorder=dependencies.createWorkorder||createOperationalWorkorderInTransaction;workorder=await createWorkorder({companyId:inspection.company_id,locationId:inspection.location_id,assetId:inspection.asset_id,createdByUserId:input.actorId,concern:input.concern||followUp.note,officeNotes:input.officeNotes||`Created from completed inspection ${inspection.inspection_number}.`,formData:{unitNo:inspection.asset_snapshot?.unitNo||"",unitType:inspection.unit_type,vinNo:inspection.asset_snapshot?.vin||"",licenseNo:inspection.asset_snapshot?.licensePlate||""}},client);
    }else if(input.action!=="no_workorder")throw new InspectionConflictError("INSPECTION_FOLLOW_UP_ACTION_INVALID","Follow-up action is invalid.");
    if(workorder){const linkKey=`inspection-follow-up-${followUp.id}-${workorder.id}`;await client.query("insert into inspection_workorder_links(company_id,inspection_id,finding_id,workorder_id,linked_by_user_id,idempotency_key,request_sha256) values($1,$2,$3,$4,$5,$6,$7)",[inspection.company_id,inspection.id,followUp.finding_id,workorder.id,input.actorId,linkKey,hash({inspectionId:inspection.id,findingId:followUp.finding_id,workorderId:workorder.id,actorId:input.actorId})]);}
    const nextStatus=workorder?"resolved_workorder":"resolved_no_workorder";const reason=workorder?"":input.reason;
    const updated=(await client.query("update inspection_finding_follow_ups set status=$2,workorder_id=$3,resolution_reason=$4,resolved_at=now(),resolved_by_user_id=$5,version=version+1,updated_at=now() where id=$1 returning *",[followUp.id,nextStatus,workorder?.id||null,reason,input.actorId])).rows[0];
    await client.query("insert into inspection_finding_follow_up_events(company_id,follow_up_id,event_type,from_status,to_status,actor_id,workorder_id,reason,details) values($1,$2,$3,$4,$3,$5,$6,$7,$8::jsonb)",[inspection.company_id,followUp.id,nextStatus,followUp.status,input.actorId,workorder?.id||null,reason,JSON.stringify({action:input.action,version:Number(updated.version)})]);
    await client.query("insert into inspection_follow_up_commands(company_id,follow_up_id,actor_id,action,idempotency_key,request_sha256,workorder_id) values($1,$2,$3,$4,$5,$6,$7)",[inspection.company_id,followUp.id,input.actorId,input.action,input.idempotencyKey,requestSha256,workorder?.id||null]);
    const detail=await inspectionDetailRow(client,inspection.id,[inspection.company_id]);await client.query("commit");return{inspection:publicDetail(detail),workorderId:workorder?.id||null,workorderSerial:workorder?.serial||null,replayed:false};
  }catch(error){await client.query("rollback").catch(()=>{});throw input.action==="create_workorder"?mapActiveAssetConflict(error):error;}finally{client.release();}
}

export async function replaceInspectionAssignments(input, dependencies = {}) {
  const pool = dependencies.pool || getPool(); const client = await pool.connect();
  try {
    await client.query("begin");
    const row = await inspectionRow(client, input.inspectionId, input.companyIds, true);
    if (!row) return null;
    assertVersion(row, input.expectedVersion);
    if (!["requested", "assigned", "in_progress"].includes(row.status)) throw new InspectionConflictError("INSPECTION_ASSIGNMENT_LOCKED", "Completed or cancelled inspections cannot be reassigned.");
    const mechanicIds = [...new Set(input.mechanicUserIds || [])];
    if(row.status==="in_progress"&&!mechanicIds.length)throw new InspectionConflictError("INSPECTION_PRIMARY_REQUIRED","An in-progress inspection must retain one primary mechanic.");
    if (mechanicIds.length) {
      const members = await client.query(`select membership.user_id from user_location_memberships membership
        join user_company_memberships company_membership on company_membership.user_id=membership.user_id and company_membership.company_id=membership.company_id and company_membership.role='mechanic' and company_membership.active
        join user_profiles profile on profile.id=membership.user_id and profile.active and profile.deleted_at is null
        where membership.company_id=$1 and membership.location_id=$2 and membership.active and membership.user_id=any($3::uuid[])`, [row.company_id, row.location_id, mechanicIds]);
      if (members.rowCount !== mechanicIds.length) throw new InspectionConflictError("INSPECTION_ASSIGNMENT_INVALID", "Every mechanic must be active at this location.");
    }
    const existing = await client.query("select * from inspection_assignments where company_id=$1 and inspection_id=$2 and active for update", [row.company_id, row.id]);
    const previousIds = new Set(existing.rows.map((assignment) => assignment.mechanic_user_id));
    await client.query("update inspection_assignments set active=false,released_at=now() where company_id=$1 and inspection_id=$2 and active", [row.company_id, row.id]);
    for (const [index, mechanicId] of mechanicIds.entries()) {
      await client.query(`insert into inspection_assignments(company_id,inspection_id,mechanic_user_id,assignment_role,active,assigned_by_user_id,assigned_at,released_at)
        values($1,$2,$3,$4,true,$5,now(),null)
        on conflict(company_id,inspection_id,mechanic_user_id) do update set assignment_role=excluded.assignment_role,active=true,assigned_by_user_id=excluded.assigned_by_user_id,assigned_at=excluded.assigned_at,released_at=null`, [row.company_id,row.id,mechanicId,index === 0 ? "primary" : "support",input.actorId]);
      await client.query("insert into inspection_assignment_events(company_id,inspection_id,mechanic_user_id,action,actor_id,details) values($1,$2,$3,$4,$5,$6::jsonb)", [row.company_id,row.id,mechanicId,previousIds.has(mechanicId) ? "reassigned" : "assigned",input.actorId,JSON.stringify({ assignmentRole:index === 0 ? "primary" : "support" })]);
    }
    for (const previousId of previousIds) if (!mechanicIds.includes(previousId)) await client.query("insert into inspection_assignment_events(company_id,inspection_id,mechanic_user_id,action,actor_id) values($1,$2,$3,'released',$4)", [row.company_id,row.id,previousId,input.actorId]);
    const nextStatus = row.status === "in_progress" ? row.status : mechanicIds.length ? "assigned" : "requested";
    const updated = (await client.query("update inspections set status=$2,version=version+1,updated_at=now() where id=$1 returning *", [row.id, nextStatus])).rows[0];
    await addEvent(client, updated, "assignment_changed", input.actorId, row.status, { mechanicUserIds: mechanicIds });
    const detail = await inspectionDetailRow(client, updated.id, [updated.company_id]);
    await client.query("commit"); return publicDetail(detail);
  } catch (error) { await client.query("rollback").catch(() => {}); throw error; } finally { client.release(); }
}

function linkConflict(code, message) { return new InspectionConflictError(code, message); }
export async function linkInspectionWorkorder(input, dependencies = {}) {
  const pool = dependencies.pool || getPool(); const client = await pool.connect();
  try {
    await client.query("begin");
    const row = await inspectionRow(client, input.inspectionId, input.companyIds, true);
    if (!row) return null;
    const requestSha256 = hash({ inspectionId: row.id, findingId: input.findingId, workorderId: input.workorderId, actorId: input.actorId });
    const replay = await client.query("select * from inspection_workorder_links where company_id=$1 and linked_by_user_id=$2 and idempotency_key=$3 for update", [row.company_id,input.actorId,input.idempotencyKey]);
    if (replay.rows[0]) {
      if (replay.rows[0].request_sha256 !== requestSha256) throw linkConflict("INSPECTION_LINK_IDEMPOTENCY_CONFLICT", "That idempotency key was already used for a different workorder link.");
      const detail = await inspectionDetailRow(client, row.id, [row.company_id]); await client.query("commit"); return publicDetail(detail);
    }
    assertVersion(row, input.expectedVersion);
    if (row.status !== "in_progress") throw linkConflict("INSPECTION_NOT_EDITABLE", "Only an in-progress inspection can link a workorder.");
    const finding = await client.query("select * from inspection_findings where company_id=$1 and inspection_id=$2 and id=$3 for update", [row.company_id,row.id,input.findingId]);
    if (!finding.rows[0]) throw linkConflict("INSPECTION_FINDING_NOT_FOUND", "Inspection finding not found.");
    if (!["new_workorder", "linked_workorder"].includes(finding.rows[0].disposition)) throw linkConflict("INSPECTION_LINK_DISPOSITION_INVALID", "Only a finding marked for a workorder can be linked.");
    const workorder = await client.query("select id,asset_id,serial from operational_workorders where company_id=$1 and id=$2 and location_id=$3 and asset_id=$4 and status in ('open','accepted','in_progress') for update", [row.company_id,input.workorderId,input.locationId,row.asset_id]);
    if (!workorder.rows[0]) throw linkConflict("INSPECTION_WORKORDER_INELIGIBLE", "Workorder must be active for the same unit and location.");
    const existing = await client.query("select * from inspection_workorder_links where company_id=$1 and inspection_id=$2 and finding_id=$3 for update", [row.company_id,row.id,input.findingId]);
    if (existing.rows[0]) {
      if (existing.rows[0].workorder_id !== input.workorderId) throw linkConflict("INSPECTION_FINDING_ALREADY_LINKED", "This finding is already linked to a different workorder.");
      const detail = await inspectionDetailRow(client, row.id, [row.company_id]); await client.query("commit"); return publicDetail(detail);
    }
    await client.query(`insert into inspection_workorder_links(company_id,inspection_id,finding_id,workorder_id,linked_by_user_id,idempotency_key,request_sha256)
      values($1,$2,$3,$4,$5,$6,$7)`, [row.company_id,row.id,input.findingId,input.workorderId,input.actorId,input.idempotencyKey,requestSha256]);
    const updated = (await client.query("update inspections set version=version+1,updated_at=now() where id=$1 returning *", [row.id])).rows[0];
    await addEvent(client, updated, "workorder_linked", input.actorId, row.status, { findingId: input.findingId, workorderId: input.workorderId, workorderSerial: workorder.rows[0].serial });
    const detail = await inspectionDetailRow(client, row.id, [row.company_id]);
    await client.query("commit"); return publicDetail(detail);
  } catch (error) { await client.query("rollback").catch(() => {}); throw error; } finally { client.release(); }
}

export async function listEligibleInspectionWorkorders(input, dependencies = {}) {
  const run = dependencies.query || query;
  const result = await run(`select id,serial,status,concern,updated_at from operational_workorders
    where company_id=$1 and location_id=$2 and asset_id=$3 and status in ('open','accepted','in_progress')
      and ($4='' or serial ilike '%'||$4||'%' or concern ilike '%'||$4||'%')
      and ($5::uuid is null or exists(select 1 from workorder_mechanic_assignments assignment where assignment.workorder_id=operational_workorders.id and assignment.mechanic_user_id=$5 and assignment.active)
        or (status='open' and not exists(select 1 from workorder_mechanic_assignments assignment where assignment.workorder_id=operational_workorders.id and assignment.active)))
    order by updated_at desc,id desc limit $6`, [input.companyId,input.locationId,input.assetId,input.search || "",input.actorId || null,Math.min(Math.max(input.limit || 20,1),50)]);
  return result.rows.map((row) => ({ id:row.id, serial:row.serial, status:row.status, concern:row.concern || "", updatedAt:row.updated_at }));
}

const reinspectionBlockerMessages={
  source_passed:"This inspection passed and does not require reinspection.",
  superseded_by_correction:"Reinspect the latest corrected inspection instead.",
  primary_required:"The primary mechanic must create the reinspection.",
  follow_up_open:"Resolve every Office follow-up before reinspection.",
  repair_incomplete:"Complete or resolve every required repair before reinspection.",
  active_inspection_exists:"This unit already has an active weekly inspection.",
  template_unavailable:"A current published inspection template is required.",
  not_completed:"Only a completed inspection can be reinspected.",
};

export async function listWorkorderInspectionSources(input,dependencies={}){
  const run=dependencies.query||query;
  const result=await run(`select inspection.id,inspection.inspection_number,inspection.completed_at,inspection.result,
    case when $4::boolean and not exists(select 1 from inspection_assignments primary_assignment where primary_assignment.company_id=inspection.company_id and primary_assignment.inspection_id=inspection.id and primary_assignment.mechanic_user_id=$5 and primary_assignment.active and primary_assignment.assignment_role='primary') then 'primary_required' else ${reinspectionBlockerSql} end as reinspection_blocker_code
    from inspections inspection
    where inspection.company_id=$1 and inspection.location_id=$2 and inspection.status='completed'
      and exists(select 1 from inspection_workorder_links link where link.company_id=inspection.company_id and link.inspection_id=inspection.id and link.workorder_id=$3)
      and ($4::boolean=false or exists(select 1 from inspection_assignments assignment where assignment.company_id=inspection.company_id and assignment.inspection_id=inspection.id and assignment.mechanic_user_id=$5 and assignment.active))
    order by inspection.completed_at desc,inspection.id desc`,[input.companyId,input.locationId,input.workorderId,input.restrictToActor===true,input.actorId||null]);
  return result.rows.map((row)=>{const blockerCode=row.reinspection_blocker_code||null;return{inspectionId:row.id,inspectionNumber:row.inspection_number,completedAt:row.completed_at,result:row.result,eligible:blockerCode===null,blockerCode,blockerMessage:blockerCode?reinspectionBlockerMessages[blockerCode]||"Reinspection is currently unavailable.":null};});
}

export const inspectionRepositoryInternals={hash,publicSummary,publicDetail,assertVersion,inspectionDetailSelect,reinspectionBlockerSql,reinspectionBlockerMessages,archiveSnapshot,inspectionCreateRequestHash,isActiveInspectionUniqueConflict,typedReplay};
