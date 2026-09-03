import { createHash } from "node:crypto";
import { permissionDenied, resourceNotFound } from "../../auth/errors.js";
import { requireActor } from "../../auth/authorize.js";
import { authorizeProductModule, productModuleBootstrap } from "../access/product-module-access.service.js";
import { listProductAccessLocations } from "../../db/repositories/product-module-access.repo.js";
import { modeAllows } from "../../../../shared/product-modules.js";
import { createInspection, createInspectionRevision, createInspectionWorkorder, getInspectionById, linkInspectionWorkorder, listEligibleInspectionWorkorders, listInspections, replaceInspectionAssignments, saveInspectionResponses, transitionInspection } from "../../db/repositories/inspections.repo.js";
import { createInspectionPrintArchive, findInspectionPrintArchive, findLatestInspectionPrintArchive } from "../../db/repositories/inspection-print-archives.repo.js";
import { getLocationById } from "../../db/repositories/locations.repo.js";
import { listUsersByLocation } from "../../db/repositories/users.repo.js";
import { searchVehicles } from "../../db/repositories/assets.repo.js";
import { renderInspectionSlip } from "../../../../shared/inspection-template.js";
import { requireWorkorderAccess } from "../../auth/resource-access.js";

function summary(record) { return { id:record.id,companyId:record.companyId,locationId:record.locationId,assetId:record.assetId,inspectionNumber:record.inspectionNumber,inspectionKind:record.inspectionKind,unitType:record.unitType,status:record.status,result:record.result,version:record.version,asset:record.asset,location:record.location||null,requestedAt:record.requestedAt,startedAt:record.startedAt,completedAt:record.completedAt,dueAt:record.dueAt,defectCount:record.defectCount,mechanic:record.mechanic||null }; }
function completedSlip(record, includeWorkorderLinks = false) { return { ...summary(record),templateSnapshot:record.templateSnapshot,responses:record.responses,findings:(record.findings||[]).map(({ id,responseId,severity,note,disposition,noWorkorderReason })=>({id,responseId,severity,note,disposition,noWorkorderReason})),finalNotes:record.finalNotes,...(includeWorkorderLinks ? { workorderLinks:record.workorderLinks || [] } : {}),workordersLinked:(record.workorderLinks || []).length > 0 }; }
function assigned(record, actorId) { return (record.assignments||[]).some((assignment)=>assignment.mechanicUserId===actorId); }
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
  return create({...input,mechanicUserIds:mechanic?[actor.id]:input.mechanicUserIds,actorId:actor.id,startImmediately:mechanic});
}

export async function queryInspectionSummaries(context,input,dependencies={}){
  const actor=requireActor(context); const companyIds=[...(context.companyIds||[])]; const requestedLocation=input.locationId||null;
  const access = await (dependencies.bootstrap || productModuleBootstrap)(context);
  const locationIds = access.companies.flatMap((company) => company.locations.filter((location) => modeAllows(location.modules.inspections,"read")).map((location) => location.locationId));
  if(requestedLocation&&!locationIds.includes(requestedLocation))throw resourceNotFound("Location");
  const restrictedMechanicCompanyIds = companyIds.filter((companyId) => context.companyRoles?.get(companyId) === "mechanic");
  const list=dependencies.list||listInspections; const statuses=input.status === "needs_action" ? ["requested","assigned"] : input.status ? [input.status] : null; return list({...input,statuses,companyIds,locationIds:requestedLocation?[requestedLocation]:locationIds,mechanicId:input.mechanicId,restrictedMechanicCompanyIds,actorId:actor.id});
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
  const {record,role}=await scoped(context,inspectionId,dependencies); const decision=await (dependencies.authorizeProduct||authorizeProductModule)(context,{companyId:record.companyId,locationId:record.locationId,moduleKey:"inspections"},"read");
  let includeWorkorderLinks=false; try { await (dependencies.authorizeWorkorders||authorizeProductModule)(context,{companyId:record.companyId,locationId:record.locationId,moduleKey:"workorders"},"read"); includeWorkorderLinks=true; } catch(error) { if(error?.statusCode!==403) throw error; }
  if(decision.mode==="read") return record.status==="completed"?completedSlip(record,includeWorkorderLinks):summary(record);
  if(role==="surveillance") return record.status==="completed"?completedSlip(record,includeWorkorderLinks):summary(record);
  return includeWorkorderLinks ? record : { ...record, workorderLinks:undefined, workordersLinked:(record.workorderLinks || []).length > 0 };
}
export async function printInspectionSlip(context, inspectionId, dependencies = {}) {
  const { record } = await scoped(context, inspectionId, dependencies);
  await (dependencies.authorizeProduct || authorizeProductModule)(context, { companyId: record.companyId, locationId: record.locationId, moduleKey: "inspections" }, "read");
  if (record.status !== "completed") {
    const error = new Error("Only a completed inspection can be printed."); error.statusCode = 409; error.code = "INSPECTION_NOT_COMPLETED"; throw error;
  }
  const archive = await (dependencies.findLatestArchive || findLatestInspectionPrintArchive)({ inspectionId:record.id, companyId:record.companyId });
  if (!archive?.snapshot || sha256(stableJson(archive.snapshot)) !== archive.snapshotSha256) { const error = new Error("Inspection print archive is unavailable."); error.statusCode = 409; error.code = "INSPECTION_PRINT_ARCHIVE_UNAVAILABLE"; throw error; }
  return { archive:{ ...archive,snapshot:undefined }, html:archive.snapshot.html || renderInspectionSlip(archive.snapshot) };
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
    workordersLinked: (record.workorderLinks || []).length > 0,
  };
}
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
export async function createInspectionPrintArchiveRecord(context, inspectionId, input, dependencies = {}) {
  const { actor, record } = await scoped(context, inspectionId, dependencies);
  await (dependencies.authorizeProduct || authorizeProductModule)(context, { companyId: record.companyId, locationId: record.locationId, moduleKey: "inspections" }, "write");
  if (record.status !== "completed") { const error = new Error("Only a completed inspection can be archived for print."); error.statusCode = 409; error.code = "INSPECTION_NOT_COMPLETED"; throw error; }
  const baseSnapshot = printSnapshot(record);
  const html = renderInspectionSlip(baseSnapshot);
  const snapshot = { ...baseSnapshot, html };
  const snapshotJson = stableJson(snapshot);
  return (dependencies.createArchive || createInspectionPrintArchive)({
    companyId: record.companyId, inspectionId: record.id, locationId: record.locationId, inspectionNumber: record.inspectionNumber,
    actorId: actor.id, idempotencyKey: input.idempotencyKey, snapshot, snapshotSha256: sha256(snapshotJson),
    requestSha256: sha256(JSON.stringify({ inspectionId:record.id, snapshotSha256:sha256(snapshotJson), actorId:actor.id })),
    // The v1 browser-print renderer persists its exact printable HTML in the immutable snapshot.
    documentSha256: sha256(html), documentByteSize: Buffer.byteLength(html),
  });
}
export async function readInspectionPrintArchiveRecord(context, inspectionId, archiveId, dependencies = {}) {
  const { record } = await scoped(context, inspectionId, dependencies);
  await (dependencies.authorizeProduct || authorizeProductModule)(context, { companyId: record.companyId, locationId: record.locationId, moduleKey: "inspections" }, "read");
  const archive = await (dependencies.findArchive || findInspectionPrintArchive)({ archiveId, inspectionId:record.id, companyId:record.companyId });
  if (!archive) throw resourceNotFound("Inspection print archive");
  if (archive.status !== "ready" || !archive.snapshot || sha256(stableJson(archive.snapshot)) !== archive.snapshotSha256) { const error = new Error("Inspection print archive failed integrity verification."); error.statusCode = 409; error.code = "INSPECTION_PRINT_ARCHIVE_INTEGRITY_FAILURE"; throw error; }
  return { archive: { ...archive, snapshot: undefined }, html: archive.snapshot.html || renderInspectionSlip(archive.snapshot) };
}

export async function reviseInspection(context, inspectionId, input, dependencies = {}) {
  const { actor, record, role } = await scoped(context, inspectionId, dependencies);
  await (dependencies.authorizeProduct || authorizeProductModule)(context, { companyId:record.companyId, locationId:record.locationId, moduleKey:"inspections" }, "write");
  if (!['office','admin'].includes(role)) throw permissionDenied();
  return (dependencies.revise || createInspectionRevision)({ ...input, inspectionId, companyIds:[...(context.companyIds || [])], actorId:actor.id });
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
  if(toStatus==="cancelled"&&!['office','admin'].includes(role))throw permissionDenied();
  return (dependencies.transition||transitionInspection)({inspectionId,companyIds:[...(context.companyIds||[])],expectedVersion:input.expectedVersion,toStatus,finalNotes:input.finalNotes,details:input.reason?{reason:input.reason}:{},actorId:actor.id});
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

export const inspectionServiceInternals={summary,completedSlip,assigned,printSnapshot,stableJson};
