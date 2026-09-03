import { createHash } from "node:crypto";
import { permissionDenied, resourceNotFound } from "../../auth/errors.js";
import { requireActor } from "../../auth/authorize.js";
import { authorizeProductModule, productModuleBootstrap } from "../access/product-module-access.service.js";
import { listProductAccessLocations } from "../../db/repositories/product-module-access.repo.js";
import { modeAllows } from "../../../../shared/product-modules.js";
import { createInspection, createInspectionCorrection, createInspectionReinspection, createInspectionWorkorder, getInspectionById, linkInspectionWorkorder, listEligibleInspectionWorkorders, listInspections, listWorkorderInspectionSources, replaceInspectionAssignments, resolveInspectionFollowUp, saveInspectionResponses, transitionInspection } from "../../db/repositories/inspections.repo.js";
import { createInspectionPrintArchive, findInspectionPrintArchive, findLatestInspectionPrintArchive, recordInspectionPrintLegacyAcceptance } from "../../db/repositories/inspection-print-archives.repo.js";
import { getLocationById } from "../../db/repositories/locations.repo.js";
import { getOperationalWorkorderById } from "../../db/repositories/operational-workorders.repo.js";
import { listUsersByLocation } from "../../db/repositories/users.repo.js";
import { searchVehicles } from "../../db/repositories/assets.repo.js";
import { renderInspectionSlip } from "../../../../shared/inspection-template.js";
import { requireWorkorderAccess } from "../../auth/resource-access.js";
import { canonicalInspectionPrintJson, inspectionPrintSnapshotDigest, normalizeInspectionPrintSnapshot, verifyInspectionPrintSnapshot } from "./inspection-print-integrity.js";
import { materializeInspectionPdf, readInspectionArchivedPdf } from "../../print/inspection-print-archive.service.js";

function summary(record) { return { id:record.id,companyId:record.companyId,locationId:record.locationId,assetId:record.assetId,inspectionNumber:record.inspectionNumber,inspectionKind:record.inspectionKind,unitType:record.unitType,status:record.status,result:record.result,version:record.version,asset:record.asset,location:record.location||null,requestedAt:record.requestedAt,startedAt:record.startedAt,completedAt:record.completedAt,dueAt:record.dueAt,defectCount:record.defectCount,mechanic:record.mechanic||null,lineage:record.lineage||null,...(record.status==="completed"?{reinspectionEligible:record.reinspectionEligible===true,reinspectionBlockerCode:record.reinspectionBlockerCode||null}:{}) }; }
function followUpProjection(record,includeWorkorders=false){return(record.followUps||[]).map(({id,findingId,status,version,workorderId,reason})=>({id,findingId,status,version,...(includeWorkorders&&workorderId?{workorderId}:{}),...(status==="resolved_no_workorder"?{reason}:{} )}));}
function completedSlip(record, includeWorkorderLinks = false) { return { ...summary(record),templateSnapshot:record.templateSnapshot,responses:record.responses,findings:(record.findings||[]).map(({ id,responseId,severity,note,disposition,noWorkorderReason })=>({id,responseId,severity,note,disposition,noWorkorderReason})),finalNotes:record.finalNotes,followUps:followUpProjection(record,includeWorkorderLinks),...(includeWorkorderLinks ? { workorderLinks:record.workorderLinks || [] } : {}),workordersLinked:(record.workorderLinks || []).length > 0 }; }
function assigned(record, actorId) { return (record.assignments||[]).some((assignment)=>assignment.mechanicUserId===actorId); }
function primaryAssigned(record, actorId) { return (record.assignments||[]).some((assignment)=>assignment.mechanicUserId===actorId&&assignment.role==="primary"); }
function inspectionConflict(code,message){const error=new Error(message);error.statusCode=409;error.code=code;return error;}
async function scoped(context, inspectionId, dependencies) {
  const actor=requireActor(context); const load=dependencies.load||getInspectionById; const record=await load({inspectionId,companyIds:[...(context.companyIds||[])]});
  if(!record)throw resourceNotFound("Inspection"); const role=context.companyRoles?.get(record.companyId); if(!role)throw resourceNotFound("Inspection");
  if(role!=="admin"&&!context.locationIds?.has(record.locationId))throw resourceNotFound("Inspection");
  if(role==="mechanic"&&!assigned(record,actor.id))throw resourceNotFound("Inspection"); return {actor,record,role};
}

export async function requestInspection(context,input,dependencies={}){
  const actor=requireActor(context); const role=context.companyRoles?.get(input.companyId); if(!role||!context.companyIds?.has(input.companyId))throw resourceNotFound("Inspection");
  if(role!=="admin"&&!context.locationIds?.has(input.locationId))throw resourceNotFound("Inspection");
  await (dependencies.authorizeProduct||authorizeProductModule)(context,{companyId:input.companyId,locationId:input.locationId,moduleKey:"inspections"},"write");
  if(!["mechanic","office","admin"].includes(role))throw permissionDenied();
  const mechanic=role==="mechanic"; const create=dependencies.create||createInspection;
  const inspection=await create({...input,mechanicUserIds:mechanic?[actor.id]:input.mechanicUserIds,actorId:actor.id,startImmediately:false});
  if(inspection&&role!=="admin"&&!context.locationIds?.has(inspection.locationId))throw resourceNotFound("Inspection");
  return inspection;
}

export async function queryInspectionSummaries(context,input,dependencies={}){
  const actor=requireActor(context); const companyIds=[...(context.companyIds||[])]; const requestedLocation=input.locationId||null;
  const access = await (dependencies.bootstrap || productModuleBootstrap)(context);
  const locationIds = access.companies.flatMap((company) => company.locations.filter((location) => modeAllows(location.modules.inspections,"read")).map((location) => location.locationId));
  if(requestedLocation&&!locationIds.includes(requestedLocation))throw resourceNotFound("Location");
  const restrictedMechanicCompanyIds = companyIds.filter((companyId) => context.companyRoles?.get(companyId) === "mechanic");
  const list=dependencies.list||listInspections; const needsAction=input.status==="needs_action"; const statuses=needsAction?null:input.status==="not_completed"?["requested","assigned","in_progress"]:input.status?[input.status]:null; return list({...input,statuses,needsAction,companyIds,locationIds:requestedLocation?[requestedLocation]:locationIds,mechanicId:input.mechanicId,restrictedMechanicCompanyIds,actorId:actor.id});
}

export async function inspectionCreateContext(context, input = {}, dependencies = {}) {
  const actor = requireActor(context);
  const listLocations = dependencies.listLocations || listProductAccessLocations;
  const readLocation = dependencies.readLocation || getLocationById;
  const listMechanics = dependencies.listMechanics || listUsersByLocation;
  const searchAssets = dependencies.searchAssets || searchVehicles;
  const access = await (dependencies.bootstrap || productModuleBootstrap)(context);
  const writable = new Set(access.companies.flatMap((company) => company.locations.filter((location) => modeAllows(location.modules.inspections,"write")).map((location) => `${company.companyId}:${location.locationId}`)));
  const allowed = (await Promise.all([...(context.companyIds || [])].map((companyId) => listLocations({
    companyIds: [companyId],
    locationIds: context.companyRoles?.get(companyId) === "admin" ? null : [...(context.locationIds || [])],
  })))).flat().filter((location) => writable.has(`${location.companyId}:${location.locationId}`));
  const locationRows = (await Promise.all(allowed.map(async (entry) => {
    if (entry.name) return { id: entry.locationId, companyId: entry.companyId, name: entry.name };
    const row = await readLocation(entry.locationId, [entry.companyId]);
    return row ? { id: row.id, companyId: row.company_id || row.companyId, name: row.name } : null;
  }))).filter(Boolean);
  const selectedLocationId = input.locationId || (locationRows.length === 1 ? locationRows[0].id : "");
  const selected = locationRows.find((location) => location.id === selectedLocationId) || null;
  const mechanics = selected && ["office", "admin"].includes(context.companyRoles?.get(selected.companyId))
    ? (await listMechanics(selected.id)).filter((user) => user.role === "mechanic" && user.active && user.membership_active)
      .map((user) => ({ id: user.id, name: user.name }))
    : [];
  const companyIds = [...new Set(locationRows.map((location) => location.companyId))];
  const assets = input.search?.trim()?.length >= 2 ? await searchAssets(input.search, 20, companyIds) : [];
  return {
    locations: locationRows,
    mechanics,
    units: assets.filter((asset) => asset.unit_type === "Truck" || asset.unit_type === "Trailer").map((asset) => ({
      id: asset.id,
      companyId: asset.company_id,
      unitNo: asset.unit_no,
      name: asset.name,
      unitType: asset.unit_type,
      vin: asset.vin,
      plate: asset.license_plate,
    })),
    actor: { id: actor.id, role: actor.role },
  };
}

export async function readInspection(context,inspectionId,dependencies={}){
  const {record:scopedRecord,role,actor}=await scoped(context,inspectionId,dependencies); const record=role==="mechanic"&&!primaryAssigned(scopedRecord,actor.id)?{...scopedRecord,reinspectionEligible:false,reinspectionBlockerCode:"primary_required"}:scopedRecord; const decision=await (dependencies.authorizeProduct||authorizeProductModule)(context,{companyId:record.companyId,locationId:record.locationId,moduleKey:"inspections"},"read");
  let includeWorkorderLinks=false;
  if (["mechanic", "office", "admin"].includes(role)) try { await (dependencies.authorizeWorkorders||authorizeProductModule)(context,{companyId:record.companyId,locationId:record.locationId,moduleKey:"workorders"},"read"); includeWorkorderLinks=true; } catch(error) { if(error?.statusCode!==403) throw error; }
  if(decision.mode==="read") return record.status==="completed"?completedSlip(record,includeWorkorderLinks):summary(record);
  if(role==="surveillance") return record.status==="completed"?completedSlip(record,includeWorkorderLinks):summary(record);
  return includeWorkorderLinks ? record : { ...record, workorderLinks:undefined,followUps:followUpProjection(record,false), workordersLinked:(record.workorderLinks || []).length > 0 };
}
export async function printInspectionSlip(context, inspectionId, dependencies = {}) {
  const { actor, record } = await scoped(context, inspectionId, dependencies);
  await (dependencies.authorizeProduct || authorizeProductModule)(context, { companyId: record.companyId, locationId: record.locationId, moduleKey: "inspections" }, "read");
  if (record.status !== "completed") {
    const error = new Error("Only a completed inspection can be printed."); error.statusCode = 409; error.code = "INSPECTION_NOT_COMPLETED"; throw error;
  }
  const archive = await (dependencies.findLatestArchive || findLatestInspectionPrintArchive)({ inspectionId:record.id, companyId:record.companyId });
  const verification = archive?.snapshot ? verifyInspectionPrintSnapshot(archive.snapshot, archive.snapshotSha256) : { valid:false };
  if (!verification.valid) { const error = new Error("Inspection print archive is unavailable."); error.statusCode = 409; error.code = "INSPECTION_PRINT_ARCHIVE_UNAVAILABLE"; throw error; }
  if (verification.legacy) await (dependencies.recordLegacyAcceptance || recordInspectionPrintLegacyAcceptance)({ archiveId:archive.id, inspectionId:record.id, companyId:record.companyId, actorId:actor.id, legacyFormat:verification.legacyFormat, storedSnapshotSha256:archive.snapshotSha256, canonicalSnapshotSha256:verification.canonicalDigest });
  return { archive:{ ...archive,snapshot:undefined,downloadUrl:`/api/inspections/${encodeURIComponent(record.id)}/print-archives/${encodeURIComponent(archive.id)}/pdf` }, html:archive.snapshot.html || renderInspectionSlip(archive.snapshot) };
}

function printSnapshot(record) {
  return {
    schemaVersion: 1,
    rendererVersion: record.templateSnapshot?.rendererVersion || "inspection-slip-v1",
    inspectionId: record.id,
    companyId: record.companyId,
    locationId: record.locationId,
    inspectionNumber: record.inspectionNumber,
    status: record.status,
    result: record.result,
    completedAt: record.completedAt,
    unit: record.asset,
    templateLabel: record.templateSnapshot?.label || "Weekly Inspection",
    templateSnapshot: record.templateSnapshot,
    responses: record.responses || [],
    findings: record.findings || [],
    finalNotes: record.finalNotes || "",
    startEvidence: record.startEvidence || null,
    previousReportAvailable: record.previousReportAvailable === true,
    workordersLinked: (record.workorderLinks || []).length > 0,
    lineageKind:record.lineage?.kind || null,
    predecessorInspectionId:record.lineage?.predecessorInspectionId || null,
    revisionReason:record.revisionReason || "",
  };
}
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
export async function createInspectionPrintArchiveRecord(context, inspectionId, input, dependencies = {}) {
  const { actor, record } = await scoped(context, inspectionId, dependencies);
  await (dependencies.authorizeProduct || authorizeProductModule)(context, { companyId: record.companyId, locationId: record.locationId, moduleKey: "inspections" }, "write");
  if (record.status !== "completed") { const error = new Error("Only a completed inspection can be archived for print."); error.statusCode = 409; error.code = "INSPECTION_NOT_COMPLETED"; throw error; }
  const baseSnapshot = normalizeInspectionPrintSnapshot(printSnapshot(record));
  const html = renderInspectionSlip(baseSnapshot);
  const snapshot = normalizeInspectionPrintSnapshot({ ...baseSnapshot, html });
  const snapshotSha256 = inspectionPrintSnapshotDigest(snapshot);
  const claimed=await (dependencies.createArchive || createInspectionPrintArchive)({
    companyId: record.companyId, inspectionId: record.id, locationId: record.locationId, inspectionNumber: record.inspectionNumber,
    actorId: actor.id, idempotencyKey: input.idempotencyKey, snapshot, snapshotSha256,
    requestSha256: sha256(JSON.stringify({ inspectionId:record.id, snapshotSha256, actorId:actor.id })),
  });
  if (!claimed.archive?.status) return claimed;
  if (claimed.archive.status === "ready") return { ...claimed,archive:{...claimed.archive,downloadUrl:`/api/inspections/${encodeURIComponent(record.id)}/print-archives/${encodeURIComponent(claimed.archive.id)}/pdf`} };
  const archiveVerification=claimed.archive.snapshot?verifyInspectionPrintSnapshot(claimed.archive.snapshot,claimed.archive.snapshotSha256):{valid:false};
  if(!archiveVerification.valid){const error=new Error("Inspection print archive failed integrity verification.");error.statusCode=409;error.code="INSPECTION_PRINT_ARCHIVE_INTEGRITY_FAILURE";throw error;}
  const archivedHtml=claimed.archive.snapshot.html||renderInspectionSlip(claimed.archive.snapshot);
  const materialized=await materializeInspectionPdf({archive:claimed.archive,html:archivedHtml},dependencies);
  return { ...claimed,replayed:claimed.replayed || materialized.replayed,archive:{...materialized.archive,downloadUrl:`/api/inspections/${encodeURIComponent(record.id)}/print-archives/${encodeURIComponent(materialized.archive.id)}/pdf`} };
}
export async function readInspectionPrintArchiveRecord(context, inspectionId, archiveId, dependencies = {}) {
  const { actor, record } = await scoped(context, inspectionId, dependencies);
  await (dependencies.authorizeProduct || authorizeProductModule)(context, { companyId: record.companyId, locationId: record.locationId, moduleKey: "inspections" }, "read");
  const archive = await (dependencies.findArchive || findInspectionPrintArchive)({ archiveId, inspectionId:record.id, companyId:record.companyId });
  if (!archive) throw resourceNotFound("Inspection print archive");
  const verification = archive.snapshot ? verifyInspectionPrintSnapshot(archive.snapshot, archive.snapshotSha256) : { valid:false };
  if (archive.status !== "ready" || !verification.valid) { const error = new Error("Inspection print archive failed integrity verification."); error.statusCode = 409; error.code = "INSPECTION_PRINT_ARCHIVE_INTEGRITY_FAILURE"; throw error; }
  if (verification.legacy) await (dependencies.recordLegacyAcceptance || recordInspectionPrintLegacyAcceptance)({ archiveId:archive.id, inspectionId:record.id, companyId:record.companyId, actorId:actor.id, legacyFormat:verification.legacyFormat, storedSnapshotSha256:archive.snapshotSha256, canonicalSnapshotSha256:verification.canonicalDigest });
  return { archive: { ...archive, snapshot: undefined,downloadUrl:`/api/inspections/${encodeURIComponent(record.id)}/print-archives/${encodeURIComponent(archive.id)}/pdf` }, html: archive.snapshot.html || renderInspectionSlip(archive.snapshot) };
}

export async function readInspectionPrintArchivePdf(context,inspectionId,archiveId,dependencies={}) {
  const {actor,record}=await scoped(context,inspectionId,dependencies);
  await (dependencies.authorizeProduct || authorizeProductModule)(context,{companyId:record.companyId,locationId:record.locationId,moduleKey:"inspections"},"read");
  const archive=await (dependencies.findArchive || findInspectionPrintArchive)({archiveId,inspectionId:record.id,companyId:record.companyId,internal:true});
  if(!archive)throw resourceNotFound("Inspection print archive");
  const verification=archive.snapshot?verifyInspectionPrintSnapshot(archive.snapshot,archive.snapshotSha256):{valid:false};
  if(!verification.valid){const error=new Error("Inspection print archive failed integrity verification.");error.statusCode=409;error.code="INSPECTION_PRINT_ARCHIVE_INTEGRITY_FAILURE";throw error;}
  if(verification.legacy)await(dependencies.recordLegacyAcceptance||recordInspectionPrintLegacyAcceptance)({archiveId:archive.id,inspectionId:record.id,companyId:record.companyId,actorId:actor.id,legacyFormat:verification.legacyFormat,storedSnapshotSha256:archive.snapshotSha256,canonicalSnapshotSha256:verification.canonicalDigest});
  return readInspectionArchivedPdf({archive,html:archive.snapshot.html||renderInspectionSlip(archive.snapshot)},dependencies);
}

export async function createInspectionFindingWorkorder(context, inspectionId, input, dependencies = {}) {
  const { actor, record, role } = await scoped(context, inspectionId, dependencies);
  await (dependencies.authorizeProduct || authorizeProductModule)(context, { companyId:record.companyId, locationId:record.locationId, moduleKey:"inspections" }, "write");
  await (dependencies.authorizeWorkorders || authorizeProductModule)(context, { companyId:record.companyId, locationId:record.locationId, moduleKey:"workorders" }, "write");
  if (!['mechanic','office','admin'].includes(role)) throw permissionDenied();
  return (dependencies.createWorkorder || createInspectionWorkorder)({ ...input, inspectionId, companyIds:[...(context.companyIds || [])], actorId:actor.id });
}

async function mutate(context,inspectionId,input,toStatus,dependencies={}){
  const {actor,record,role}=await scoped(context,inspectionId,dependencies); await (dependencies.authorizeProduct||authorizeProductModule)(context,{companyId:record.companyId,locationId:record.locationId,moduleKey:"inspections"},"write");
  if(toStatus==="in_progress"&&role!=="mechanic"&&role!=="admin")throw permissionDenied();
  if(toStatus==="completed"&&role!=="mechanic"&&role!=="admin")throw permissionDenied();
  if(toStatus==="completed"&&role==="mechanic"&&!primaryAssigned(record,actor.id))throw permissionDenied();
  if(toStatus==="completed"&&role==="admin"&&input.actingAsInspector!==true)throw permissionDenied();
  if(toStatus==="cancelled"&&!['office','admin'].includes(role))throw permissionDenied();
  const completionAuthority=toStatus==="completed"?(role==="admin"?"admin_inspector":"primary_mechanic"):undefined;
  const details=input.reason?{reason:input.reason}:completionAuthority?{completionAuthority,...(role==="admin"?{actingAsInspector:true}:{})}:{};
  return (dependencies.transition||transitionInspection)({inspectionId,companyIds:[...(context.companyIds||[])],expectedVersion:input.expectedVersion,toStatus,finalNotes:input.finalNotes,details,actorId:actor.id,completionAuthority,...(toStatus==="in_progress"?{odometerMiles:input.odometerMiles,engineHours:input.engineHours,previousReportReviewed:input.previousReportReviewed}:{})});
}
export function startInspection(context,id,input,deps){return mutate(context,id,input,"in_progress",deps);}
export function completeInspection(context,id,input,deps){return mutate(context,id,input,"completed",deps);}
export function cancelInspection(context,id,input,deps){return mutate(context,id,input,"cancelled",deps);}
export async function patchInspectionResponses(context,inspectionId,input,dependencies={}){
  const {actor,record,role}=await scoped(context,inspectionId,dependencies); await (dependencies.authorizeProduct||authorizeProductModule)(context,{companyId:record.companyId,locationId:record.locationId,moduleKey:"inspections"},"write"); if(role!=="mechanic"&&role!=="admin")throw permissionDenied();
  return (dependencies.saveResponses||saveInspectionResponses)({...input,inspectionId,companyIds:[...(context.companyIds||[])],actorId:actor.id});
}

export async function assignInspection(context, inspectionId, input, dependencies = {}) {
  const { actor, record, role } = await scoped(context, inspectionId, dependencies);
  await (dependencies.authorizeProduct || authorizeProductModule)(context, { companyId:record.companyId, locationId:record.locationId, moduleKey:"inspections" }, "write");
  if (!["office", "admin"].includes(role)) throw permissionDenied();
  if(record.status==="in_progress"&&!input.mechanicUserIds.length)throw inspectionConflict("INSPECTION_PRIMARY_REQUIRED","An in-progress inspection must retain one primary mechanic.");
  return (dependencies.assign || replaceInspectionAssignments)({ ...input, inspectionId, companyIds:[...(context.companyIds || [])], actorId:actor.id });
}
export async function linkInspectionToWorkorder(context, inspectionId, findingId, input, dependencies = {}) {
  const { actor, record, role } = await scoped(context, inspectionId, dependencies);
  await (dependencies.authorizeProduct || authorizeProductModule)(context, { companyId:record.companyId, locationId:record.locationId, moduleKey:"inspections" }, "write");
  await (dependencies.authorizeWorkorders || authorizeProductModule)(context, { companyId:record.companyId, locationId:record.locationId, moduleKey:"workorders" }, "write");
  if (!["mechanic", "office", "admin"].includes(role)) throw permissionDenied();
  const target = await (dependencies.requireWorkorder || requireWorkorderAccess)(context,input.workorderId,{ requireLocationMembership:true, allowAvailable:true, allowActiveAtLocation:true });
  if (target.companyId !== record.companyId || target.locationId !== record.locationId || target.assetId !== record.assetId || !["open","accepted","in_progress"].includes(target.status)) throw resourceNotFound("Workorder");
  return (dependencies.link || linkInspectionWorkorder)({ ...input, inspectionId, findingId, companyIds:[...(context.companyIds || [])], locationId:record.locationId, actorId:actor.id });
}
export async function eligibleInspectionWorkorders(context, inspectionId, input = {}, dependencies = {}) {
  const { actor, record, role } = await scoped(context, inspectionId, dependencies);
  await (dependencies.authorizeProduct || authorizeProductModule)(context, { companyId:record.companyId, locationId:record.locationId, moduleKey:"inspections" }, "write");
  await (dependencies.authorizeWorkorders || authorizeProductModule)(context, { companyId:record.companyId, locationId:record.locationId, moduleKey:"workorders" }, "write");
  if (!["mechanic", "office", "admin"].includes(role)) throw permissionDenied();
  return { items:await (dependencies.listEligible || listEligibleInspectionWorkorders)({ companyId:record.companyId, locationId:record.locationId, assetId:record.assetId, actorId:null, search:input.search || "", limit:input.limit || 20 }) };
}

export async function workorderInspectionContext(context,workorderId,dependencies={}){
  const candidate=await (dependencies.loadWorkorder||getOperationalWorkorderById)(workorderId);
  if(!candidate||!context.companyIds?.has(candidate.companyId))throw resourceNotFound("Workorder");
  const role=context.companyRoles?.get(candidate.companyId);
  if(!role||!candidate.locationId)throw resourceNotFound("Workorder");
  const effectiveContext={...context,actor:{...requireActor(context),role}};
  const requireWorkorder=dependencies.requireWorkorder||requireWorkorderAccess;
  const workorder=await requireWorkorder(effectiveContext,workorderId,{requireLocationMembership:true,getWorkorder:async()=>candidate});
  await (dependencies.authorizeWorkorders||authorizeProductModule)(effectiveContext,{companyId:workorder.companyId,locationId:workorder.locationId,moduleKey:"workorders"},"read");
  await (dependencies.authorizeInspections||authorizeProductModule)(effectiveContext,{companyId:workorder.companyId,locationId:workorder.locationId,moduleKey:"inspections"},"read");
  const sources=await (dependencies.listSources||listWorkorderInspectionSources)({companyId:workorder.companyId,locationId:workorder.locationId,workorderId:workorder.id,restrictToActor:role==="mechanic",actorId:effectiveContext.actor.id});
  return{inspectionContext:{workorderId:workorder.id,sources}};
}

async function followUpScope(context,inspectionId,dependencies,requireWorkorders){const scopedResult=await scoped(context,inspectionId,dependencies);const{record,role}=scopedResult;await(dependencies.authorizeProduct||authorizeProductModule)(context,{companyId:record.companyId,locationId:record.locationId,moduleKey:"inspections"},"write");if(!["office","admin"].includes(role))throw permissionDenied();if(record.status!=="completed")throw inspectionConflict("INSPECTION_FOLLOW_UP_NOT_COMPLETED","Only completed inspection follow-ups can be resolved.");if(requireWorkorders)await(dependencies.authorizeWorkorders||authorizeProductModule)(context,{companyId:record.companyId,locationId:record.locationId,moduleKey:"workorders"},"write");return scopedResult;}
export async function linkInspectionFollowUpWorkorder(context,inspectionId,findingId,input,dependencies={}){const{actor,record}=await followUpScope(context,inspectionId,dependencies,true);const target=await(dependencies.requireWorkorder||requireWorkorderAccess)(context,input.workorderId,{requireLocationMembership:true,allowAvailable:true,allowActiveAtLocation:true});if(target.companyId!==record.companyId||target.locationId!==record.locationId||target.assetId!==record.assetId||!["open","accepted","in_progress"].includes(target.status))throw resourceNotFound("Workorder");return(dependencies.resolveFollowUp||resolveInspectionFollowUp)({...input,action:"link_workorder",inspectionId,findingId,companyIds:[...(context.companyIds||[])],actorId:actor.id});}
export async function createInspectionFollowUpWorkorder(context,inspectionId,findingId,input,dependencies={}){const{actor}=await followUpScope(context,inspectionId,dependencies,true);return(dependencies.resolveFollowUp||resolveInspectionFollowUp)({...input,action:"create_workorder",inspectionId,findingId,companyIds:[...(context.companyIds||[])],actorId:actor.id});}
export async function resolveInspectionFollowUpNoWorkorder(context,inspectionId,findingId,input,dependencies={}){const{actor}=await followUpScope(context,inspectionId,dependencies,false);return(dependencies.resolveFollowUp||resolveInspectionFollowUp)({...input,action:"no_workorder",inspectionId,findingId,companyIds:[...(context.companyIds||[])],actorId:actor.id});}

async function lineageScope(context,inspectionId,dependencies){const scopedResult=await scoped(context,inspectionId,dependencies);const{record}=scopedResult;await(dependencies.authorizeProduct||authorizeProductModule)(context,{companyId:record.companyId,locationId:record.locationId,moduleKey:"inspections"},"write");if(record.status!=="completed")throw inspectionConflict("INSPECTION_LINEAGE_NOT_COMPLETED","Only a completed inspection can be corrected or reinspected.");return scopedResult;}
export async function correctInspection(context,inspectionId,input,dependencies={}){const{actor,role}=await lineageScope(context,inspectionId,dependencies);if(!["office","admin"].includes(role))throw permissionDenied();return(dependencies.correct||createInspectionCorrection)({...input,inspectionId,companyIds:[...(context.companyIds||[])],actorId:actor.id});}
export async function reinspectInspection(context,inspectionId,input,dependencies={}){const{actor,record,role}=await lineageScope(context,inspectionId,dependencies);if(record.result==="passed")throw inspectionConflict("INSPECTION_REINSPECTION_SOURCE_PASSED","A passed inspection does not require reinspection.");if(role==="mechanic"){if(!primaryAssigned(record,actor.id)||input.startImmediately!==false||input.mechanicUserIds.length!==1||input.mechanicUserIds[0]!==actor.id)throw permissionDenied();}else if(!["office","admin"].includes(role))throw permissionDenied();return(dependencies.reinspect||createInspectionReinspection)({...input,startImmediately:false,inspectionId,companyIds:[...(context.companyIds||[])],actorId:actor.id});}

export const inspectionServiceInternals={summary,completedSlip,followUpProjection,assigned,primaryAssigned,printSnapshot,stableJson:canonicalInspectionPrintJson};
