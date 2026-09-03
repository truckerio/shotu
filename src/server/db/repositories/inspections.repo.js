import crypto from "node:crypto";
import { getPool, query } from "../pool.js";
import { reserveInspectionSerial } from "./inspection-serial-counters.repo.js";
import { resolvePublishedTemplateForInspection } from "./template-definitions.repo.js";
import { canTransitionInspection, deriveInspectionResult } from "../../modules/inspections/inspection.lifecycle.js";
import { createOperationalWorkorderInTransaction, mapActiveAssetConflict } from "./operational-workorders.repo.js";
import { ensureInspectionPrintArchiveInTransaction } from "./inspection-print-archives.repo.js";
import { renderInspectionSlip } from "../../../../shared/inspection-template.js";

export class InspectionConflictError extends Error {
  constructor(code = "INSPECTION_VERSION_CONFLICT", message = "Inspection changed elsewhere. Reload and try again.") {
    super(message); this.name = "InspectionConflictError"; this.statusCode = 409; this.code = code;
  }
}
function hash(value) { return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function publicSummary(row) { return row ? { id: row.id, companyId: row.company_id, locationId: row.location_id, assetId: row.asset_id, inspectionNumber: row.inspection_number, inspectionKind: row.inspection_kind, unitType: row.unit_type, status: row.status, result: row.result || null, version: Number(row.version), asset: row.asset_snapshot, location: row.location || null, requestedAt: row.requested_at, startedAt: row.started_at || null, completedAt: row.completed_at || null, dueAt: row.due_at || null, defectCount: Number(row.defect_count || 0), mechanic: row.mechanic || null, ...(row.answered_count == null ? {} : { progress: { answered: Number(row.answered_count), total: (row.template_snapshot?.sections || []).flatMap((section) => section.items || []).length, issues: Number(row.defect_count || 0) } }) } : null; }
function publicDetail(row) { const summary = publicSummary(row); return summary ? { ...summary, templateVersionId: row.template_version_id, templateSnapshot: row.template_snapshot, officeInstructions: row.office_instructions, finalNotes: row.final_notes, responses: row.responses || [], findings: row.findings || [], assignments: row.assignments || [], workorderLinks: row.workorder_links || [] } : null; }
export function encodeInspectionCursor(row) { return Buffer.from(JSON.stringify({ updatedAt: row.updated_at || row.updatedAt, id: row.id }), "utf8").toString("base64url"); }
export function decodeInspectionCursor(value) { if (!value) return null; try { const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")); if (!parsed.id || Number.isNaN(new Date(parsed.updatedAt).valueOf())) throw new Error(); return parsed; } catch { const error = new Error("Invalid inspection cursor."); error.statusCode = 400; error.code = "INVALID_INSPECTION_CURSOR"; throw error; } }

async function inspectionRow(client, id, companyIds, lock = false) {
  const result = await client.query(`select inspection.*,
    (select count(*) from inspection_findings finding where finding.company_id=inspection.company_id and finding.inspection_id=inspection.id)::int as defect_count
    from inspections inspection where inspection.id=$1 and inspection.company_id=any($2::uuid[]) ${lock ? "for update of inspection" : ""}`, [id, companyIds]);
  return result.rows[0] || null;
}
const inspectionDetailSelect = `select inspection.*,
  (select jsonb_build_object('id',location.id,'name',location.name) from locations location where location.id=inspection.location_id and location.company_id=inspection.company_id) as location,
  (select jsonb_build_object('id',profile.id,'name',profile.display_name) from inspection_assignments assignment join user_profiles profile on profile.id=assignment.mechanic_user_id where assignment.inspection_id=inspection.id and assignment.company_id=inspection.company_id and assignment.active and assignment.assignment_role='primary' limit 1) as mechanic,
  coalesce((select jsonb_agg(jsonb_build_object('id',response.id,'itemKey',response.item_key,'response',response.response,'naReason',response.na_reason) order by response.item_key) from inspection_responses response where response.company_id=inspection.company_id and response.inspection_id=inspection.id),'[]') as responses,
  coalesce((select jsonb_agg(jsonb_build_object('id',finding.id,'responseId',finding.response_id,'severity',finding.severity,'note',finding.note,'disposition',finding.disposition,'noWorkorderReason',finding.no_workorder_reason) order by finding.created_at,finding.id) from inspection_findings finding where finding.company_id=inspection.company_id and finding.inspection_id=inspection.id),'[]') as findings,
  coalesce((select jsonb_agg(jsonb_build_object('mechanicUserId',assignment.mechanic_user_id,'role',assignment.assignment_role) order by assignment.assignment_role,assignment.assigned_at) from inspection_assignments assignment where assignment.company_id=inspection.company_id and assignment.inspection_id=inspection.id and assignment.active),'[]') as assignments,
  coalesce((select jsonb_agg(jsonb_build_object('id',link.id,'findingId',link.finding_id,'workorderId',link.workorder_id,'workorderSerial',workorder.serial,'createdAt',link.created_at) order by link.created_at,link.id) from inspection_workorder_links link join operational_workorders workorder on workorder.company_id=link.company_id and workorder.id=link.workorder_id where link.company_id=inspection.company_id and link.inspection_id=inspection.id),'[]') as workorder_links,
  (select count(*) from inspection_findings finding where finding.company_id=inspection.company_id and finding.inspection_id=inspection.id)::int as defect_count
  from inspections inspection`;
async function inspectionDetailRow(client, id, companyIds) {
  const result = await client.query(`${inspectionDetailSelect} where inspection.id=$1 and inspection.company_id=any($2::uuid[]) limit 1`, [id, companyIds]);
  return result.rows[0] || null;
}
async function addEvent(client, row, eventType, actorId, fromStatus = null, details = {}) {
  await client.query("insert into inspection_events(company_id,inspection_id,event_type,from_status,to_status,actor_id,version,details) values($1,$2,$3,$4,$5,$6,$7,$8::jsonb)", [row.company_id, row.id, eventType, fromStatus, row.status, actorId, row.version, JSON.stringify(details)]);
}
function assertVersion(row, expectedVersion) { if (Number(row.version) !== Number(expectedVersion)) throw new InspectionConflictError(); }
function stableJson(value) { if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`; return JSON.stringify(value); }
function archiveSnapshot(row, responses, findings, workorderLinks = []) {
  const snapshot = { schemaVersion:1, rendererVersion:row.template_snapshot?.rendererVersion || "inspection-slip-v1", inspectionId:row.id, companyId:row.company_id, locationId:row.location_id, inspectionNumber:row.inspection_number, status:row.status, result:row.result, completedAt:row.completed_at, unit:row.asset_snapshot, templateLabel:row.template_snapshot?.label || "Weekly Inspection", templateSnapshot:row.template_snapshot, responses:responses.map((response) => ({ id:response.id, itemKey:response.item_key, response:response.response, naReason:response.na_reason })), findings:findings.map((finding) => ({ id:finding.id, responseId:finding.response_id, severity:finding.severity, note:finding.note, disposition:finding.disposition, noWorkorderReason:finding.no_workorder_reason })), finalNotes:row.final_notes || "", workordersLinked:workorderLinks.length > 0 };
  const html = renderInspectionSlip(snapshot);
  return { snapshot:{ ...snapshot, html }, documentSha256:crypto.createHash("sha256").update(html).digest("hex"), documentByteSize:Buffer.byteLength(html) };
}
async function archiveCompletedInspection(client, row, responses, findings, actorId) {
  let predecessor = null;
  if (row.predecessor_inspection_id) {
    const result = await client.query(`select * from inspection_print_archives where company_id=$1 and inspection_id=$2 and status='ready' order by revision_number desc limit 1 for share`, [row.company_id,row.predecessor_inspection_id]);
    predecessor = result.rows[0] || null;
    if (!predecessor) throw new InspectionConflictError("INSPECTION_REVISION_ARCHIVE_MISSING", "The original inspection archive is unavailable for this correction.");
  }
  const workorderLinks = await client.query("select finding_id from inspection_workorder_links where company_id=$1 and inspection_id=$2", [row.company_id,row.id]);
  const document = archiveSnapshot(row,responses,findings,workorderLinks.rows); const snapshotSha256=crypto.createHash("sha256").update(stableJson(document.snapshot)).digest("hex");
  return ensureInspectionPrintArchiveInTransaction({ companyId:row.company_id, inspectionId:row.id, locationId:row.location_id, inspectionNumber:row.inspection_number, actorId, idempotencyKey:`inspection-complete-${row.id}`, requestSha256:crypto.createHash("sha256").update(`${row.id}:${snapshotSha256}`).digest("hex"), snapshot:document.snapshot, snapshotSha256, documentSha256:document.documentSha256, documentByteSize:document.documentByteSize, predecessorArchiveId:predecessor?.id || null, revisionNumber:predecessor ? Number(predecessor.revision_number) + 1 : 1, revisionReason:row.revision_reason || "" },client);
}

export async function createInspection(input, dependencies = {}) {
  const pool = dependencies.pool || getPool(); const client = await pool.connect();
  try {
    await client.query("begin isolation level repeatable read");
    const scope = await client.query(`select asset.*, location.id as selected_location_id from assets asset
      join locations location on location.id=$2 and location.company_id=asset.company_id and location.active=true
      where asset.id=$1 and asset.company_id=$3 and asset.unit_type in ('Truck','Trailer') for share of asset, location`, [input.assetId, input.locationId, input.companyId]);
    const asset = scope.rows[0]; if (!asset) { const error = new Error("Inspection target not found."); error.statusCode = 404; throw error; }
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
    const status = mechanicIds.length ? (input.startImmediately ? "in_progress" : "assigned") : "requested";
    const inserted = await client.query(`insert into inspections(company_id,location_id,asset_id,inspection_number,inspection_kind,unit_type,status,
      template_version_id,template_snapshot,template_snapshot_sha256,asset_snapshot,requested_by_user_id,due_at,office_instructions,started_at)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11::jsonb,$12,$13,$14,case when $15 then now() else null end) returning *`,
    [input.companyId,input.locationId,input.assetId,number,asset.unit_type === "Truck" ? "weekly_truck" : "weekly_trailer",asset.unit_type,status,template.id,JSON.stringify(snapshot),hash(snapshot),JSON.stringify({ unitNo: asset.unit_no, name: asset.name, vin: asset.vin, licensePlate: asset.license_plate, make: asset.make, model: asset.model, year: asset.year }),input.actorId,input.dueAt || null,input.officeInstructions || "",input.startImmediately === true]);
    const row = inserted.rows[0];
    for (const [index, mechanicId] of mechanicIds.entries()) {
      await client.query("insert into inspection_assignments(company_id,inspection_id,mechanic_user_id,assignment_role,assigned_by_user_id) values($1,$2,$3,$4,$5)", [input.companyId,row.id,mechanicId,index === 0 ? "primary" : "support",input.actorId]);
      await client.query("insert into inspection_assignment_events(company_id,inspection_id,mechanic_user_id,action,actor_id) values($1,$2,$3,'assigned',$4)", [input.companyId,row.id,mechanicId,input.actorId]);
    }
    await addEvent(client,row,"created",input.actorId,null);
    const detail = await inspectionDetailRow(client, row.id, [row.company_id]);
    await client.query("commit"); return publicDetail(detail);
  } catch (error) { await client.query("rollback").catch(() => {}); throw error; } finally { client.release(); }
}

export async function getInspectionById({ inspectionId, companyIds }, dependencies = {}) {
  const run = dependencies.query || query;
  const result = await run(`${inspectionDetailSelect} where inspection.id=$1 and inspection.company_id=any($2::uuid[]) limit 1`, [inspectionId, companyIds]);
  return publicDetail(result.rows[0]);
}

export async function listInspections(input, dependencies = {}) {
  const run = dependencies.query || query; const after = decodeInspectionCursor(input.cursor); const values = [input.companyIds,input.locationIds,input.statuses || (input.status ? [input.status] : null),input.unitType || null,input.result || null,input.mechanicId || null,input.search || "",after?.updatedAt || null,after?.id || null,input.limit + 1,input.restrictedMechanicCompanyIds || [],input.actorId || null];
  const result = await run(`select inspection.*,
    (select jsonb_build_object('id',location.id,'name',location.name) from locations location where location.id=inspection.location_id and location.company_id=inspection.company_id) as location,
    (select count(*) from inspection_responses response where response.company_id=inspection.company_id and response.inspection_id=inspection.id)::int as answered_count,
    (select count(*) from inspection_findings finding where finding.company_id=inspection.company_id and finding.inspection_id=inspection.id)::int as defect_count,
    (select jsonb_build_object('id',profile.id,'name',profile.display_name) from inspection_assignments assignment join user_profiles profile on profile.id=assignment.mechanic_user_id where assignment.inspection_id=inspection.id and assignment.company_id=inspection.company_id and assignment.active and assignment.assignment_role='primary' limit 1) as mechanic
    from inspections inspection where inspection.company_id=any($1::uuid[]) and ($2::uuid[] is null or inspection.location_id=any($2::uuid[]))
      and ($3::text[] is null or inspection.status=any($3::text[])) and ($4::text is null or inspection.unit_type=$4) and ($5::text is null or inspection.result=$5)
      and ($6::uuid is null or exists(select 1 from inspection_assignments ia where ia.inspection_id=inspection.id and ia.mechanic_user_id=$6 and ia.active))
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
    let result=null; let completedAnswers=[]; let completedFindings=[]; if(input.toStatus==="completed"){
      const required=(before.template_snapshot.sections||[]).flatMap((s)=>s.items||[]).filter((i)=>i.required); const answers=await client.query("select * from inspection_responses where company_id=$1 and inspection_id=$2",[before.company_id,before.id]); completedAnswers=answers.rows; const answered=new Set(answers.rows.map((r)=>r.item_key)); if(required.some((item)=>!answered.has(item.key)))throw new InspectionConflictError("INSPECTION_INCOMPLETE","Answer every required check before completion.");
      const findings=await client.query("select * from inspection_findings where company_id=$1 and inspection_id=$2",[before.company_id,before.id]); completedFindings=findings.rows;
      const issueCount=answers.rows.filter((answer)=>answer.response==="issue").length;
      if(issueCount!==findings.rowCount)throw new InspectionConflictError("INSPECTION_FINDING_REQUIRED","Every Issue needs severity, note, and disposition before completion.");
      const missingLinks = await client.query(`select finding.id from inspection_findings finding
        where finding.company_id=$1 and finding.inspection_id=$2 and finding.disposition in ('new_workorder','linked_workorder')
          and not exists (select 1 from inspection_workorder_links link where link.company_id=finding.company_id and link.inspection_id=finding.inspection_id and link.finding_id=finding.id)
        limit 1`, [before.company_id, before.id]);
      if (missingLinks.rows[0]) throw new InspectionConflictError("INSPECTION_WORKORDER_LINK_REQUIRED", "Link every finding marked for a workorder before completion.");
      result=deriveInspectionResult(findings.rows); await client.query(`insert into service_history_orders(company_id,source_provider,external_id,reference,status,asset_id,ordered_at,completed_at,source_updated_at,raw_metadata,last_seen_at,recorded_at,completion_date_kind,inspection_id)
        values($1,'local_inspection',$2::uuid::text,$3,'completed',$4,$5,now(),now(),$6::jsonb,now(),$5,'verified_completed',$2::uuid)
        on conflict(company_id,source_provider,external_id) do nothing`,[before.company_id,before.id,before.inspection_number,before.asset_id,before.requested_at,JSON.stringify({ result, inspectionKind: before.inspection_kind })]);
      const history=await client.query("select id from service_history_orders where company_id=$1 and source_provider='local_inspection' and external_id=$2",[before.company_id,before.id]); for(const [index,finding] of findings.rows.entries())await client.query(`insert into service_history_lines(company_id,service_order_id,external_id,sequence,line_index,line_kind,description,raw_payload)
        values($1,$2,$3,$4::integer::numeric,$4::integer,'service',$5,$6::jsonb) on conflict(company_id,service_order_id,external_id) do nothing`,[before.company_id,history.rows[0].id,finding.id,index,finding.note,JSON.stringify({ severity:finding.severity })]);
    }
    const updated=(await client.query(`update inspections set status=$2,result=$3,final_notes=case when $2='completed' then $4 else final_notes end,
      started_at=case when $2='in_progress' then coalesce(started_at,now()) else started_at end,completed_at=case when $2='completed' then now() else completed_at end,
      cancelled_at=case when $2='cancelled' then now() else cancelled_at end,version=version+1,updated_at=now() where id=$1 returning *`,[before.id,input.toStatus,result,input.finalNotes||""])).rows[0]; await addEvent(client,updated,input.toStatus,input.actorId,before.status,input.details||{}); if(input.toStatus==="completed") await archiveCompletedInspection(client,updated,completedAnswers,completedFindings,input.actorId); const detail = await inspectionDetailRow(client, updated.id, [updated.company_id]); await client.query("commit"); return publicDetail(detail);
  }catch(error){await client.query("rollback").catch(()=>{});throw error;}finally{client.release();}
}

export async function createInspectionRevision(input, dependencies = {}) {
  const pool=dependencies.pool||getPool(); const client=await pool.connect();
  try { await client.query("begin"); const before=await inspectionRow(client,input.inspectionId,input.companyIds,true); if(!before)return null;
    const requestSha256=hash({ inspectionId:before.id, reason:input.reason, mechanicUserIds:[...(input.mechanicUserIds||[])].sort(), actorId:input.actorId });
    await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`${before.company_id}:${before.id}:${input.idempotencyKey}`]);
    const replay=await client.query("select successor_inspection_id,request_sha256 from inspection_revision_commands where company_id=$1 and actor_id=$2 and idempotency_key=$3 for update",[before.company_id,input.actorId,input.idempotencyKey]);
    if(replay.rows[0]) { if(replay.rows[0].request_sha256!==requestSha256) throw new InspectionConflictError("INSPECTION_REVISION_IDEMPOTENCY_CONFLICT","That idempotency key was already used for a different correction."); const detail=await inspectionDetailRow(client,replay.rows[0].successor_inspection_id,[before.company_id]); await client.query("commit"); return publicDetail(detail); }
    assertVersion(before,input.expectedVersion); if(before.status!=="completed") throw new InspectionConflictError("INSPECTION_REVISION_NOT_COMPLETED","Only a completed inspection can be corrected.");
    const mechanicIds=[...new Set(input.mechanicUserIds||[])]; if(mechanicIds.length) { const members=await client.query(`select membership.user_id from user_location_memberships membership join user_company_memberships company_membership on company_membership.user_id=membership.user_id and company_membership.company_id=membership.company_id and company_membership.role='mechanic' and company_membership.active join user_profiles profile on profile.id=membership.user_id and profile.active and profile.deleted_at is null where membership.company_id=$1 and membership.location_id=$2 and membership.active and membership.user_id=any($3::uuid[])`,[before.company_id,before.location_id,mechanicIds]); if(members.rowCount!==mechanicIds.length) throw new InspectionConflictError("INSPECTION_ASSIGNMENT_INVALID","Every mechanic must be active at this location."); }
    const number=await reserveInspectionSerial(client,before.company_id); const status=mechanicIds.length?"assigned":"requested";
    const inserted=await client.query(`insert into inspections(company_id,location_id,asset_id,inspection_number,inspection_kind,unit_type,status,template_version_id,template_snapshot,template_snapshot_sha256,asset_snapshot,requested_by_user_id,due_at,office_instructions,predecessor_inspection_id,revision_reason)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11::jsonb,$12,$13,$14,$15,$16) returning *`,[before.company_id,before.location_id,before.asset_id,number,before.inspection_kind,before.unit_type,status,before.template_version_id,JSON.stringify(before.template_snapshot),before.template_snapshot_sha256,JSON.stringify(before.asset_snapshot),input.actorId,before.due_at,before.office_instructions,before.id,input.reason]);
    const row=inserted.rows[0]; for(const [index,mechanicId] of mechanicIds.entries()){await client.query("insert into inspection_assignments(company_id,inspection_id,mechanic_user_id,assignment_role,assigned_by_user_id) values($1,$2,$3,$4,$5)",[row.company_id,row.id,mechanicId,index===0?"primary":"support",input.actorId]); await client.query("insert into inspection_assignment_events(company_id,inspection_id,mechanic_user_id,action,actor_id) values($1,$2,$3,'assigned',$4)",[row.company_id,row.id,mechanicId,input.actorId]);}
    await addEvent(client,row,"revision_created",input.actorId,"completed",{ predecessorInspectionId:before.id,reason:input.reason }); await client.query("insert into inspection_revision_commands(company_id,predecessor_inspection_id,successor_inspection_id,actor_id,idempotency_key,request_sha256) values($1,$2,$3,$4,$5,$6)",[before.company_id,before.id,row.id,input.actorId,input.idempotencyKey,requestSha256]); const detail=await inspectionDetailRow(client,row.id,[row.company_id]); await client.query("commit"); return publicDetail(detail);
  } catch(error){await client.query("rollback").catch(()=>{});throw error;} finally {client.release();}
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

export async function replaceInspectionAssignments(input, dependencies = {}) {
  const pool = dependencies.pool || getPool(); const client = await pool.connect();
  try {
    await client.query("begin");
    const row = await inspectionRow(client, input.inspectionId, input.companyIds, true);
    if (!row) return null;
    assertVersion(row, input.expectedVersion);
    if (!["requested", "assigned", "in_progress"].includes(row.status)) throw new InspectionConflictError("INSPECTION_ASSIGNMENT_LOCKED", "Completed or cancelled inspections cannot be reassigned.");
    const mechanicIds = [...new Set(input.mechanicUserIds || [])];
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

export const inspectionRepositoryInternals={hash,publicSummary,publicDetail,assertVersion,inspectionDetailSelect,archiveSnapshot};
