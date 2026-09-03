import { z } from "zod";
import { createTemplateRevisionSchema, createTemplateSchema, publishInspectionTemplateSchema, updateTemplateDraftSchema } from "../modules/templates/template.schemas.js";
import { createInspectionTemplate, createInspectionTemplateRevision, listInspectionTemplates, publishAndAssignInspectionTemplate, saveInspectionTemplateDraft } from "../modules/templates/template.service.js";
import { DATABASE_UUID_PATTERN } from "../db/company.js";

const companySchema = z.string().regex(DATABASE_UUID_PATTERN, "Invalid company ID");
function parse(schema, value) { const result = schema.safeParse(value); if (result.success) return result.data; const error = new Error(result.error.issues[0]?.message || "Invalid template request."); error.statusCode = 400; throw error; }
function detail(pathname) { const match = /^\/api\/admin\/inspection-templates\/([^/]+)(?:\/(publish|revisions))?$/.exec(pathname); return match ? { versionId: decodeURIComponent(match[1]), publish: match[2] === "publish", revisions:match[2] === "revisions" } : null; }

export async function handleInspectionTemplatesApi(req, res, url, helpers, dependencies = {}) {
  if (!url.pathname.startsWith("/api/admin/inspection-templates")) return false;
  const { requestContext, sendJson, readBody } = helpers;
  if (req.method === "GET" && url.pathname === "/api/admin/inspection-templates") {
    const companyId = parse(companySchema, url.searchParams.get("companyId"));
    sendJson(res, 200, await (dependencies.list || listInspectionTemplates)(requestContext, companyId)); return true;
  }
  if (req.method === "POST" && url.pathname === "/api/admin/inspection-templates") {
    sendJson(res, 201, await (dependencies.create || createInspectionTemplate)(requestContext, parse(createTemplateSchema, await readBody(req)))); return true;
  }
  const route = detail(url.pathname); if (!route) return false;
  if (req.method === "PATCH" && !route.publish && !route.revisions) {
    const companyId = parse(companySchema, url.searchParams.get("companyId"));
    sendJson(res, 200, { version: await (dependencies.save || saveInspectionTemplateDraft)(requestContext, companyId, route.versionId, parse(updateTemplateDraftSchema, await readBody(req))) }); return true;
  }
  if (req.method === "POST" && route.publish) {
    const input = parse(publishInspectionTemplateSchema, await readBody(req));
    sendJson(res, 200, await (dependencies.publishAndAssign || publishAndAssignInspectionTemplate)(requestContext, input.companyId, route.versionId, input.expectedVersion, input.definition, input.assignment)); return true;
  }
  if (req.method === "POST" && route.revisions) { const input = parse(createTemplateRevisionSchema, await readBody(req)); sendJson(res,201,{version:await (dependencies.createRevision || createInspectionTemplateRevision)(requestContext,input.companyId,route.versionId,input.expectedVersion)}); return true; }
  return false;
}

export const inspectionTemplateRouteInternals = { detail, parse };
