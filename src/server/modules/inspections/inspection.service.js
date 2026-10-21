import { createHash } from "node:crypto";
import { permissionDenied, resourceNotFound } from "../../auth/errors.js";
import { requireActor } from "../../auth/authorize.js";
import { authorizeProductModule, productModuleBootstrap } from "../access/product-module-access.service.js";
import { listProductAccessLocations } from "../../db/repositories/product-module-access.repo.js";
import { modeAllows } from "../../../../shared/product-modules.js";
import { listEffectiveInspectionTemplates } from "../../db/repositories/template-definitions.repo.js";
import { createInspection, createInspectionCorrection, createInspectionReinspection, createInspectionWorkorder, getInspectionById, linkInspectionWorkorder, listEligibleInspectionWorkorders, listInspections, listWorkorderInspectionSources, replaceInspectionAssignments, resolveInspectionFollowUp, saveInspectionResponses, transitionInspection } from "../../db/repositories/inspections.repo.js";
import { createInspectionPrintArchive, findInspectionPrintArchive, findLatestInspectionPrintArchive, recordInspectionPrintLegacyAcceptance } from "../../db/repositories/inspection-print-archives.repo.js";
import { getLocationById } from "../../db/repositories/locations.repo.js";
import { getOperationalWorkorderById } from "../../db/repositories/operational-workorders.repo.js";
import { listUsersByLocation } from "../../db/repositories/users.repo.js";
import { searchVehicles } from "../../db/repositories/assets.repo.js";
import { acceptProviderAssetMileage, readAssetMileage, recordManualAssetMileage } from "../../db/repositories/asset-mileage.repo.js";
import { getMaintenanceAsset, listInspectionMaintenance } from "../../db/repositories/inspection-maintenance.repo.js";
import { renderInspectionSlip } from "../../../../shared/inspection-template.js";
import { canonicalizeInspectionDeferral, evaluateInspectionMaintenance } from "../../../../shared/inspection-maintenance.js";
import { requireWorkorderAccess } from "../../auth/resource-access.js";
import { canonicalInspectionPrintJson, inspectionPrintSnapshotDigest, normalizeInspectionPrintSnapshot, verifyInspectionPrintSnapshot } from "./inspection-print-integrity.js";
import { materializeInspectionPdf, readInspectionArchivedPdf } from "../../print/inspection-print-archive.service.js";

function summary(record) { return { id:record.id,companyId:record.companyId,locationId:record.locationId,assetId:record.assetId,inspectionNumber:record.inspectionNumber,inspectionKind:record.inspectionKind,inspectionType:record.inspectionType || record.inspectionKind?.replace(/_(truck|trailer)$/, "") || "weekly",templateLabel:record.templateLabel || record.templateSnapshot?.label || "Weekly Inspection",unitType:record.unitType,status:record.status,result:record.result,version:record.version,asset:record.asset,location:record.location||null,requestedAt:record.requestedAt,startedAt:record.startedAt,completedAt:record.completedAt,dueAt:record.dueAt,defectCount:record.defectCount,mechanic:record.mechanic||null,lineage:record.lineage||null,...(record.status==="completed"?{reinspectionEligible:record.reinspectionEligible===true,reinspectionBlockerCode:record.reinspectionBlockerCode||null}:{}) }; }
function followUpProjection(record,includeWorkorders=false){return(record.followUps||[]).map(({id,findingId,status,version,workorderId,reason,deferral,deferCount})=>({id,findingId,status,version,...(deferral?{deferral,deferCount:Number(deferCount||0)}:{}),...(includeWorkorders&&workorderId?{workorderId}:{}),...(status==="resolved_no_workorder"?{reason}:{} )}));}
function completedSlip(record, includeWorkorderLinks = false) { return { ...summary(record),templateSnapshot:record.templateSnapshot,responses:record.responses,findings:(record.findings||[]).map(({ id,responseId,severity,note,disposition,noWorkorderReason,deferral })=>({id,responseId,severity,note,disposition,noWorkorderReason,...(deferral?{deferral}:{})})),finalNotes:record.finalNotes,followUps:followUpProjection(record,includeWorkorderLinks),...(includeWorkorderLinks ? { workorderLinks:record.workorderLinks || [] } : {}),workordersLinked:(record.workorderLinks || []).length > 0 }; }
function assigned(record, actorId) { return (record.assignments||[]).some((assignment)=>assignment.mechanicUserId===actorId); }
function primaryAssigned(record, actorId) { return (record.assignments||[]).some((assignment)=>assignment.mechanicUserId===actorId&&assignment.role==="primary"); }
function inspectionConflict(code,message){const error=new Error(message);error.statusCode=409;error.code=code;return error;}
async function scoped(context, inspectionId, dependencies, { allowMechanicAvailable = false } = {}) {
  const actor=requireActor(context); const load=dependencies.load||getInspectionById; const record=await load({inspectionId,companyIds:[...(context.companyIds||[])]});
  if(!record)throw resourceNotFound("Inspection"); const role=context.companyRoles?.get(record.companyId); if(!role)throw resourceNotFound("Inspection");
  if(role!=="admin"&&!context.locationIds?.has(record.locationId))throw resourceNotFound("Inspection");
  const mechanicAvailable = allowMechanicAvailable && record.status === "requested" && !(record.assignments || []).length;
  if(role==="mechanic"&&!assigned(record,actor.id)&&!mechanicAvailable)throw resourceNotFound("Inspection"); return {actor,record,role};
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

export async function inspectionQueueOptions(context, dependencies = {}) {
  const actor = requireActor(context);
  const access = await (dependencies.bootstrap || productModuleBootstrap)(context);
  const readable = new Set(access.companies.flatMap(company => company.locations.filter(location => modeAllows(location.modules.inspections, "read")).map(location => `${company.companyId}:${location.locationId}`)));
  const listLocations = dependencies.listLocations || listProductAccessLocations;
  const locations = (await Promise.all([...(context.companyIds || [])].map(companyId => listLocations({ companyIds: [companyId], locationIds: context.companyRoles?.get(companyId) === "admin" ? null : [...(context.locationIds || [])] })))).flat().filter(location => readable.has(`${location.companyId}:${location.locationId}`));
  const mechanics = new Map();
  const locationRows = await Promise.all(locations.map(async location => {
    const row = location.name ? location : await (dependencies.readLocation || getLocationById)(location.locationId, [location.companyId]);
    if (!row) return null;
    const role = context.companyRoles?.get(location.companyId);
    if (["office", "admin"].includes(role)) {
      const users = await (dependencies.listMechanics || listUsersByLocation)(location.locationId);
      for (const user of users.filter(user => user.role === "mechanic" && user.active && user.membership_active)) {
        const option = mechanics.get(user.id) || { id: user.id, name: user.name, locationIds: [] };
        option.locationIds.push(location.locationId); mechanics.set(user.id, option);
      }
    } else if (role === "mechanic") {
      const option = mechanics.get(actor.id) || { id: actor.id, name: actor.name || "Me", locationIds: [] };
      option.locationIds.push(location.locationId); mechanics.set(actor.id, option);
    }
    return { id: location.locationId, name: row.name };
  }));
  return { locations: locationRows.filter(Boolean), mechanics: [...mechanics.values()] };
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
  })))).flat().filter((location) => ["office", "admin", "mechanic"].includes(context.companyRoles?.get(location.companyId)) && writable.has(`${location.companyId}:${location.locationId}`));
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
    templates: selected ? await (dependencies.listTemplates || listEffectiveInspectionTemplates)({companyId:selected.companyId,locationId:selected.id}) : [],
    mechanics,
    units: assets.filter((asset) => asset.unit_type === "Truck" || asset.unit_type === "Trailer").map((asset) => ({
      id: asset.id,
      companyId: asset.company_id,
      unitNo: asset.unit_no,
      name: asset.name,
      unitType: asset.unit_type,
      ownerName: asset.owner_name || "",
      vin: asset.vin,
      plate: asset.license_plate,
    })),
    actor: { id: actor.id, role: actor.role },
  };
}

export async function readInspection(context,inspectionId,dependencies={}){
  const {record:scopedRecord,role,actor}=await scoped(context,inspectionId,dependencies,{allowMechanicAvailable:true}); const record=role==="mechanic"&&!primaryAssigned(scopedRecord,actor.id)?{...scopedRecord,reinspectionEligible:false,reinspectionBlockerCode:"primary_required"}:scopedRecord; const decision=await (dependencies.authorizeProduct||authorizeProductModule)(context,{companyId:record.companyId,locationId:record.locationId,moduleKey:"inspections"},"read");
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
    ...(record.inspector ? {inspector:record.inspector} : {}),
    ...((record.inspectionLocation?.name || record.location?.name) ? {inspectionLocation:record.inspectionLocation || {name:record.location.name}} : {}),
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
  try{return await(dependencies.saveResponses||saveInspectionResponses)({...input,inspectionId,companyIds:[...(context.companyIds||[])],actorId:actor.id});}catch(error){throw mapInspectionDeferralError(error);}
}

export async function assignInspection(context, inspectionId, input, dependencies = {}) {
  const { actor, record, role } = await scoped(context, inspectionId, dependencies);
  await (dependencies.authorizeProduct || authorizeProductModule)(context, { companyId:record.companyId, locationId:record.locationId, moduleKey:"inspections" }, "write");
  if (!["office", "admin"].includes(role)) throw permissionDenied();
  if(record.status==="in_progress"&&!input.mechanicUserIds.length)throw inspectionConflict("INSPECTION_PRIMARY_REQUIRED","An in-progress inspection must retain one primary mechanic.");
  return (dependencies.assign || replaceInspectionAssignments)({ ...input, inspectionId, companyIds:[...(context.companyIds || [])], actorId:actor.id });
}
export async function claimInspection(context, inspectionId, input, dependencies = {}) {
  const { actor, record, role } = await scoped(context, inspectionId, dependencies, { allowMechanicAvailable:true });
  await (dependencies.authorizeProduct || authorizeProductModule)(context, { companyId:record.companyId, locationId:record.locationId, moduleKey:"inspections" }, "write");
  if (role !== "mechanic") throw permissionDenied();
  if (assigned(record, actor.id) && ["assigned", "in_progress"].includes(record.status)) return record;
  if (record.status !== "requested" || (record.assignments || []).length) throw inspectionConflict("INSPECTION_NOT_AVAILABLE", "This inspection is no longer available.");
  return (dependencies.assign || replaceInspectionAssignments)({ expectedVersion:input.expectedVersion, mechanicUserIds:[actor.id], inspectionId, companyIds:[...(context.companyIds || [])], actorId:actor.id });
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
function mapInspectionDeferralError(error){if(error?.statusCode)return error;if(String(error?.code||"").startsWith("INSPECTION_DEFERRAL_")){error.statusCode=400;}return error;}
export async function deferInspectionFollowUp(context,inspectionId,findingId,input,dependencies={}){const{actor,record}=await followUpScope(context,inspectionId,dependencies,false);let deferral;try{deferral=canonicalizeInspectionDeferral(input.deferral,{unitType:record.unitType});}catch(error){throw mapInspectionDeferralError(error);}if(input.reason!==deferral.reason){const error=new Error("Follow-up reason must match the deferral reason.");error.statusCode=400;error.code="INSPECTION_DEFERRAL_REASON_MISMATCH";throw error;}if(deferral.additionalMiles!=null){const mileage=await(dependencies.readMileage||readAssetMileage)({assetId:record.assetId,companyId:record.companyId});if(mileage.state!=="fresh"||mileage.miles!==deferral.baselineMiles)throw inspectionConflict("INSPECTION_DEFERRAL_BASELINE_UNVERIFIED","Additional miles must use the current verified mileage.");}return(dependencies.resolveFollowUp||resolveInspectionFollowUp)({...input,reason:deferral.reason,deferral,action:"defer",inspectionId,findingId,companyIds:[...(context.companyIds||[])],actorId:actor.id});}
export async function verifyInspectionFollowUp(context,inspectionId,findingId,input,dependencies={}){const{actor}=await followUpScope(context,inspectionId,dependencies,false);return(dependencies.resolveFollowUp||resolveInspectionFollowUp)({...input,action:"verify",inspectionId,findingId,companyIds:[...(context.companyIds||[])],actorId:actor.id});}

async function allowsModule(context,record,moduleKey,capability,dependencies){const authorize=moduleKey==="workorders"?dependencies.authorizeWorkorders:dependencies.authorizeInspections;try{await(authorize||dependencies.authorizeProduct||authorizeProductModule)(context,{companyId:record.companyId,locationId:record.locationId,moduleKey},capability);return true;}catch(error){if(error?.statusCode===403)return false;throw error;}}
function effectiveMaintenanceMileage(record,mileage,now=new Date()) { if(record?.unitType!=="Truck"||!record.startEvidence||!record.startedAt)return mileage;const started=new Date(record.startedAt);const startedAt=started.getTime();const canonicalObserved=mileage?.observedAt?new Date(mileage.observedAt).getTime():Number.NEGATIVE_INFINITY;if(mileage?.state==="conflict"||!Number.isFinite(startedAt)||startedAt>now.getTime()+5*60*1000||now.getTime()-startedAt>24*60*60*1000||canonicalObserved>=startedAt)return mileage;return{...mileage,miles:record.startEvidence.odometerMiles,observedAt:started.toISOString(),source:"inspection_start",state:"fresh"}; }
async function maintenancePayload(context,rawItems,mileage,record,role,capabilities,dependencies={}){const now=dependencies.now?.()||new Date();const capabilityCache=new Map();const sourceCapabilities=async(locationId)=>{const key=locationId||record.locationId;if(!capabilityCache.has(key))capabilityCache.set(key,maintenanceCapabilities(context,{...record,locationId:key},role,dependencies));return capabilityCache.get(key);};const items=await Promise.all(rawItems.map(async(item)=>{const itemCapabilities=await sourceCapabilities(item.sourceLocationId);const evaluated={...item,...evaluateInspectionMaintenance({deferral:item.deferral,mileage,now,timeZone:dependencies.timeZone||"America/Los_Angeles",visitStartedAt:item.visitStartedAt||record.visitStartedAt||null,sourceCompletedAt:item.sourceCompletedAt,workorderStatus:item.workorderStatus||null})};const{sourceCompletedAt,sourceLocationId,visitStartedAt,workorderId,workorderStatus,...publicItem}=evaluated;return{...publicItem,canManage:itemCapabilities.canManage,canManageWorkorders:itemCapabilities.canManageWorkorders,...(itemCapabilities.canReadWorkorders&&workorderId?{workorderId}:{}),...(itemCapabilities.canReadWorkorders&&workorderStatus?{workorderStatus}:{})};}));const{canReadWorkorders,...publicCapabilities}=capabilities;return{items,mileage,...publicCapabilities};}
async function maintenanceCapabilities(context,record,role,dependencies={}){const canReadWorkorders=["mechanic","office","admin"].includes(role)&&await allowsModule(context,record,"workorders","read",dependencies);const canManage=["office","admin"].includes(role)&&await allowsModule(context,record,"inspections","write",dependencies);const canManageWorkorders=canManage&&await allowsModule(context,record,"workorders","write",dependencies);return{canManage,canManageWorkorders,canReadWorkorders};}
async function maintenanceLocationIds(context,companyId,dependencies={}){const access=await(dependencies.bootstrap||productModuleBootstrap)(context);return access.companies.filter((company)=>company.companyId===companyId).flatMap((company)=>company.locations.filter((location)=>modeAllows(location.modules.inspections,"read")).map((location)=>location.locationId));}

export async function inspectionMaintenanceContext(context,inspectionId,dependencies={}){
  const{record,role,actor}=await scoped(context,inspectionId,dependencies,{allowMechanicAvailable:true});await(dependencies.authorizeProduct||authorizeProductModule)(context,{companyId:record.companyId,locationId:record.locationId,moduleKey:"inspections"},"read");
  const rawMileage=await(dependencies.readMileage||readAssetMileage)({assetId:record.assetId,companyId:record.companyId});const now=dependencies.now?.()||new Date();const mileage=effectiveMaintenanceMileage(record,rawMileage,now);const locationIds=await maintenanceLocationIds(context,record.companyId,dependencies);const items=await(dependencies.listMaintenance||listInspectionMaintenance)({companyId:record.companyId,assetId:record.assetId,locationIds});const capabilities=await maintenanceCapabilities(context,record,role,dependencies);const canRecordMileage=record.unitType==="Truck"&&record.status==="in_progress"&&(["office","admin"].includes(role)||assigned(record,actor.id))&&await allowsModule(context,record,"inspections","write",dependencies);return maintenancePayload(context,items,mileage,{...record,visitStartedAt:record.status==="in_progress"?record.startedAt:null},role,{...capabilities,canRecordMileage},{...dependencies,now:()=>now});
}

export async function workorderMaintenanceContext(context,workorderId,dependencies={}){
  const candidate=await(dependencies.loadWorkorder||getOperationalWorkorderById)(workorderId);if(!candidate||!context.companyIds?.has(candidate.companyId))throw resourceNotFound("Workorder");const role=context.companyRoles?.get(candidate.companyId);if(!role||!candidate.locationId)throw resourceNotFound("Workorder");const effectiveContext={...context,actor:{...requireActor(context),role}};const workorder=await(dependencies.requireWorkorder||requireWorkorderAccess)(effectiveContext,workorderId,{requireLocationMembership:true,getWorkorder:async()=>candidate});const record={companyId:workorder.companyId,locationId:workorder.locationId,assetId:workorder.assetId};await(dependencies.authorizeWorkorders||authorizeProductModule)(effectiveContext,{...record,moduleKey:"workorders"},"read");await(dependencies.authorizeInspections||authorizeProductModule)(effectiveContext,{...record,moduleKey:"inspections"},"read");const mileage=await(dependencies.readMileage||readAssetMileage)({assetId:record.assetId,companyId:record.companyId});const locationIds=await maintenanceLocationIds(effectiveContext,record.companyId,dependencies);const items=await(dependencies.listMaintenance||listInspectionMaintenance)({...record,locationIds});const capabilities=await maintenanceCapabilities(effectiveContext,record,role,dependencies);return maintenancePayload(effectiveContext,items,mileage,{...record,visitStartedAt:workorder.startedAt||null},role,{...capabilities,canRecordMileage:false},dependencies);
}

export async function unitMaintenanceContext(context,assetId,dependencies={}){
  const actor=requireActor(context);const asset=await(dependencies.loadAsset||getMaintenanceAsset)({assetId,companyIds:[...(context.companyIds||[])]});if(!asset)throw resourceNotFound("Unit");const role=context.companyRoles?.get(asset.companyId);if(!["office","admin"].includes(role)||(asset.locationId&&!context.locationIds?.has(asset.locationId)&&role!=="admin"))throw resourceNotFound("Unit");const locationIds=await maintenanceLocationIds(context,asset.companyId,dependencies);if(!locationIds.length)throw resourceNotFound("Unit");const record={companyId:asset.companyId,locationId:asset.locationId||locationIds[0],assetId:asset.id};await(dependencies.authorizeProduct||authorizeProductModule)(context,{...record,moduleKey:"inspections"},"read");const mileage=await(dependencies.readMileage||readAssetMileage)({assetId:asset.id,companyId:asset.companyId});const items=await(dependencies.listMaintenance||listInspectionMaintenance)({...record,locationIds});const capabilities=await maintenanceCapabilities(context,record,role,dependencies);void actor;return maintenancePayload(context,items,mileage,{...record,visitStartedAt:null},role,{...capabilities,canRecordMileage:false},dependencies);
}

async function mutableInspectionMileageScope(context,inspectionId,dependencies){const{actor,record,role}=await scoped(context,inspectionId,dependencies);await(dependencies.authorizeProduct||authorizeProductModule)(context,{companyId:record.companyId,locationId:record.locationId,moduleKey:"inspections"},"write");if(record.status!=="in_progress")throw inspectionConflict("INSPECTION_MILEAGE_NOT_EDITABLE","Mileage can be recorded only while the inspection is in progress.");if(record.unitType!=="Truck")throw inspectionConflict("INSPECTION_TRAILER_MILEAGE_UNSUPPORTED","Trailer inspections do not accept mileage.");if(role==="mechanic"&&!assigned(record,actor.id))throw permissionDenied();if(!["mechanic","office","admin"].includes(role))throw permissionDenied();return{actor,record};}
function mapInspectionMileageError(error){if(error?.statusCode)return error;const statusByCode={ASSET_MILEAGE_ASSET_NOT_FOUND:404,ASSET_MILEAGE_STALE:409,ASSET_MILEAGE_IDEMPOTENCY_CONFLICT:409,ASSET_MILEAGE_BACKWARDS:409,ASSET_MILEAGE_UNKNOWN:409,ASSET_MILEAGE_PROVIDER_UNKNOWN:409,ASSET_MILEAGE_INVALID:400,ASSET_MILEAGE_TIME_INVALID:400,ASSET_MILEAGE_TIME_FUTURE:400,ASSET_MILEAGE_REASON_INVALID:400,ASSET_MILEAGE_VERSION_INVALID:400,ASSET_MILEAGE_IDEMPOTENCY_INVALID:400};if(statusByCode[error?.code])error.statusCode=statusByCode[error.code];return error;}
async function runInspectionMileageCommand(command,input){try{return await command(input);}catch(error){throw mapInspectionMileageError(error);}}
export async function recordInspectionMileage(context,inspectionId,input,dependencies={}){const{actor,record}=await mutableInspectionMileageScope(context,inspectionId,dependencies);return runInspectionMileageCommand(dependencies.recordMileage||recordManualAssetMileage,{...input,assetId:record.assetId,companyId:record.companyId,actorId:actor.id,inspectionId:record.id});}
export async function acceptInspectionProviderMileage(context,inspectionId,input,dependencies={}){const{actor,record}=await mutableInspectionMileageScope(context,inspectionId,dependencies);return runInspectionMileageCommand(dependencies.acceptProviderMileage||acceptProviderAssetMileage,{...input,assetId:record.assetId,companyId:record.companyId,actorId:actor.id,inspectionId:record.id});}

async function lineageScope(context,inspectionId,dependencies){const scopedResult=await scoped(context,inspectionId,dependencies);const{record}=scopedResult;await(dependencies.authorizeProduct||authorizeProductModule)(context,{companyId:record.companyId,locationId:record.locationId,moduleKey:"inspections"},"write");if(record.status!=="completed")throw inspectionConflict("INSPECTION_LINEAGE_NOT_COMPLETED","Only a completed inspection can be corrected or reinspected.");return scopedResult;}
export async function correctInspection(context,inspectionId,input,dependencies={}){const{actor,role}=await lineageScope(context,inspectionId,dependencies);if(!["office","admin"].includes(role))throw permissionDenied();return(dependencies.correct||createInspectionCorrection)({...input,inspectionId,companyIds:[...(context.companyIds||[])],actorId:actor.id});}
export async function reinspectInspection(context,inspectionId,input,dependencies={}){const{actor,record,role}=await lineageScope(context,inspectionId,dependencies);if(record.result==="passed")throw inspectionConflict("INSPECTION_REINSPECTION_SOURCE_PASSED","A passed inspection does not require reinspection.");if(role==="mechanic"){if(!primaryAssigned(record,actor.id)||input.startImmediately!==false||input.mechanicUserIds.length!==1||input.mechanicUserIds[0]!==actor.id)throw permissionDenied();}else if(!["office","admin"].includes(role))throw permissionDenied();return(dependencies.reinspect||createInspectionReinspection)({...input,startImmediately:false,inspectionId,companyIds:[...(context.companyIds||[])],actorId:actor.id});}

export const inspectionServiceInternals={summary,completedSlip,followUpProjection,assigned,primaryAssigned,printSnapshot,stableJson:canonicalInspectionPrintJson};
