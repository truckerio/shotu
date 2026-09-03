import { z } from "zod";
import { assignInspectionSchema, cancelInspectionSchema, completeInspectionSchema, createInspectionCorrectionSchema, createInspectionFollowUpWorkorderSchema, createInspectionPrintArchiveSchema, createInspectionReinspectionSchema, createInspectionSchema, createInspectionWorkorderSchema, inspectionListSchema, inspectionVersionActionSchema, linkInspectionFollowUpSchema, linkInspectionWorkorderSchema, resolveInspectionFollowUpNoWorkorderSchema, saveInspectionResponsesSchema, workorderInspectionContextParamsSchema } from "../modules/inspections/inspection.schemas.js";
import { assignInspection, cancelInspection, completeInspection, correctInspection, createInspectionFindingWorkorder, createInspectionFollowUpWorkorder, createInspectionPrintArchiveRecord, eligibleInspectionWorkorders, inspectionCreateContext, linkInspectionFollowUpWorkorder, linkInspectionToWorkorder, patchInspectionResponses, printInspectionSlip, queryInspectionSummaries, readInspection, readInspectionPrintArchivePdf, readInspectionPrintArchiveRecord, reinspectInspection, requestInspection, resolveInspectionFollowUpNoWorkorder, startInspection, workorderInspectionContext } from "../modules/inspections/inspection.service.js";

function parse(schema,value){const result=schema.safeParse(value);if(result.success)return result.data;const error=new Error(result.error.issues[0]?.message||"Invalid inspection request.");error.statusCode=400;throw error;}
function detailRoute(pathname){const match=/^\/api\/inspections\/([^/]+)(?:\/(responses|print)|\/actions\/(start|complete|cancel|assign))?$/.exec(pathname);return match?{id:decodeURIComponent(match[1]),responses:match[2]==="responses",print:match[2]==="print",action:match[3]||null}:null;}
function nestedRoute(pathname) {
  const match = /^\/api\/inspections\/([^/]+)(?:\/assignments|\/workorders|\/actions\/(correct|reinspect)|\/findings\/([^/]+)\/workorder-links|\/print-archives(?:\/([^/]+)(?:\/(pdf))?)?)$/.exec(pathname);
  if (!match) return null;
  if (pathname.endsWith("/assignments")) return { id:decodeURIComponent(match[1]), kind:"assignments" };
  if (pathname.endsWith("/workorders")) return { id:decodeURIComponent(match[1]), kind:"workorders" };
  if (match[2]) return { id:decodeURIComponent(match[1]), action:match[2], kind:"lineage" };
  if (match[3]) return { id:decodeURIComponent(match[1]), findingId:decodeURIComponent(match[3]), kind:"workorder-links" };
  return { id:decodeURIComponent(match[1]), archiveId:match[4] ? decodeURIComponent(match[4]) : null, pdf:match[5] === "pdf", kind:"print-archives" };
}
function followUpRoute(pathname) {
  const match = /^\/api\/inspections\/([^/]+)\/follow-ups\/([^/]+)\/actions\/(link-workorder|create-workorder|no-workorder)$/.exec(pathname);
  return match ? { id:decodeURIComponent(match[1]), findingId:decodeURIComponent(match[2]), action:match[3] } : null;
}

export async function handleInspectionsApi(req,res,url,helpers,dependencies={}){
  if(!url.pathname.startsWith("/api/inspections"))return false; const {sendJson,readBody,requestContext}=helpers;
  const workorderContext=/^\/api\/inspections\/workorders\/([^/]+)\/context$/.exec(url.pathname);
  if(req.method==="GET"&&workorderContext){const {workorderId}=parse(workorderInspectionContextParamsSchema,{workorderId:decodeURIComponent(workorderContext[1])});sendJson(res,200,await (dependencies.workorderContext||workorderInspectionContext)(requestContext,workorderId));return true;}
  if(req.method==="GET"&&url.pathname==="/api/inspections/create-context"){
    const search=(url.searchParams.get("search")||"").slice(0,120); const locationId=url.searchParams.get("locationId")||undefined;
    sendJson(res,200,await (dependencies.createContext||inspectionCreateContext)(requestContext,{search,locationId}));return true;
  }
  if(req.method==="POST"&&url.pathname==="/api/inspections"){const input=parse(createInspectionSchema,await readBody(req));sendJson(res,201,{inspection:await (dependencies.request||requestInspection)(requestContext,input)});return true;}
  if(req.method==="GET"&&url.pathname==="/api/inspections"){const raw={};for(const key of ["status","unitType","result","locationId","mechanicId","search","cursor","limit"]){const value=url.searchParams.get(key);if(value!==null)raw[key]=value;}sendJson(res,200,await (dependencies.list||queryInspectionSummaries)(requestContext,parse(inspectionListSchema,raw)));return true;}
  const followUp=followUpRoute(url.pathname);
  if (followUp && req.method === "POST") {
    if (followUp.action === "link-workorder") { sendJson(res,200,await (dependencies.linkFollowUp || linkInspectionFollowUpWorkorder)(requestContext,followUp.id,followUp.findingId,parse(linkInspectionFollowUpSchema,await readBody(req)))); return true; }
    if (followUp.action === "create-workorder") { sendJson(res,201,await (dependencies.createFollowUpWorkorder || createInspectionFollowUpWorkorder)(requestContext,followUp.id,followUp.findingId,parse(createInspectionFollowUpWorkorderSchema,await readBody(req)))); return true; }
    sendJson(res,200,await (dependencies.noWorkorderFollowUp || resolveInspectionFollowUpNoWorkorder)(requestContext,followUp.id,followUp.findingId,parse(resolveInspectionFollowUpNoWorkorderSchema,await readBody(req)))); return true;
  }
  const nested=nestedRoute(url.pathname);
  if (nested) {
    if (nested.kind === "assignments" && req.method === "POST") { sendJson(res,200,{inspection:await (dependencies.assign || assignInspection)(requestContext,nested.id,parse(assignInspectionSchema,await readBody(req)))}); return true; }
    if (nested.kind === "workorders" && req.method === "GET") { const search=(url.searchParams.get("search") || "").trim().slice(0,120); const limit=Number(url.searchParams.get("limit") || 20); sendJson(res,200,await (dependencies.eligibleWorkorders || eligibleInspectionWorkorders)(requestContext,nested.id,{search,limit:Number.isInteger(limit) ? Math.min(Math.max(limit,1),50) : 20})); return true; }
    if (nested.kind === "workorders" && req.method === "POST") { sendJson(res,201,await (dependencies.createWorkorder || createInspectionFindingWorkorder)(requestContext,nested.id,parse(createInspectionWorkorderSchema,await readBody(req)))); return true; }
    if (nested.kind === "lineage" && req.method === "POST") { const correction=nested.action==="correct";const service=correction?(dependencies.correct||correctInspection):(dependencies.reinspect||reinspectInspection);const schema=correction?createInspectionCorrectionSchema:createInspectionReinspectionSchema;sendJson(res,201,{inspection:await service(requestContext,nested.id,parse(schema,await readBody(req)))});return true; }
    if (nested.kind === "workorder-links" && req.method === "POST") { sendJson(res,200,{inspection:await (dependencies.link || linkInspectionToWorkorder)(requestContext,nested.id,nested.findingId,parse(linkInspectionWorkorderSchema,await readBody(req)))}); return true; }
    if (nested.kind === "print-archives" && !nested.archiveId && req.method === "POST") { sendJson(res,201,await (dependencies.createArchive || createInspectionPrintArchiveRecord)(requestContext,nested.id,parse(createInspectionPrintArchiveSchema,await readBody(req)),helpers.inspectionPrintDependencies)); return true; }
    if (nested.kind === "print-archives" && nested.archiveId && nested.pdf && req.method === "GET") { const pdf=await (dependencies.readArchivePdf || readInspectionPrintArchivePdf)(requestContext,nested.id,nested.archiveId,helpers.inspectionPrintDependencies); helpers.sendPdfBytes(res,pdf.bytes,pdf.fileName); return true; }
    if (nested.kind === "print-archives" && nested.archiveId && req.method === "GET") { sendJson(res,200,await (dependencies.readArchive || readInspectionPrintArchiveRecord)(requestContext,nested.id,nested.archiveId)); return true; }
    return false;
  }
  const route=detailRoute(url.pathname);if(!route)return false;
  if(req.method==="GET"&&route.print){sendJson(res,200,await (dependencies.print||printInspectionSlip)(requestContext,route.id));return true;}
  if(req.method==="GET"&&!route.responses&&!route.action){sendJson(res,200,{inspection:await (dependencies.read||readInspection)(requestContext,route.id)});return true;}
  if(req.method==="PATCH"&&route.responses){sendJson(res,200,{inspection:await (dependencies.responses||patchInspectionResponses)(requestContext,route.id,parse(saveInspectionResponsesSchema,await readBody(req)))});return true;}
  if(req.method==="POST"&&route.action){const schemas={start:inspectionVersionActionSchema,complete:completeInspectionSchema,cancel:cancelInspectionSchema,assign:assignInspectionSchema};const actions={start:dependencies.start||startInspection,complete:dependencies.complete||completeInspection,cancel:dependencies.cancel||cancelInspection,assign:dependencies.assign||assignInspection};sendJson(res,200,{inspection:await actions[route.action](requestContext,route.id,parse(schemas[route.action],await readBody(req)))});return true;}
  return false;
}

export const inspectionRouteInternals={detailRoute,followUpRoute,nestedRoute,parse};
