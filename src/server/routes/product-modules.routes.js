import { z } from "zod";
import { listProductModuleAccessRules } from "../db/repositories/product-module-access.repo.js";
import {
  patchProductModuleAccess,
  requireAdminProductModuleScope,
} from "../modules/access/product-module-access.service.js";
import { DATABASE_UUID_PATTERN } from "../db/company.js";

const patchSchema = z.object({
  companyId: z.string().regex(DATABASE_UUID_PATTERN, "Invalid company ID"),
  locationId: z.string().uuid().nullable().optional(),
  subjectType: z.literal("role"),
  subjectId: z.enum(["mechanic", "office", "surveillance", "admin"]),
  moduleKey: z.enum(["workorders", "inspections"]),
  mode: z.enum(["inherit", "off", "read", "full"]),
  expectedVersion: z.number().int().min(0),
}).strict();

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const error = new Error(result.error.issues[0]?.message || "Invalid product module request.");
  error.statusCode = 400;
  throw error;
}

export async function handleProductModulesApi(req, res, url, helpers, dependencies = {}) {
  if (url.pathname !== "/api/admin/product-modules") return false;
  const { requestContext, sendJson, readBody } = helpers;
  if (req.method === "GET") {
    const companyId = url.searchParams.get("companyId") || "";
    const locationId = url.searchParams.get("locationId") || null;
    await requireAdminProductModuleScope(requestContext, companyId, locationId, dependencies);
    const rules = await (dependencies.list || listProductModuleAccessRules)({ companyIds: [companyId], locationIds: locationId ? [locationId] : [] });
    sendJson(res, 200, { rules: rules.filter((rule) => (locationId ? rule.locationId === locationId : rule.locationId === null)) });
    return true;
  }
  if (req.method === "PATCH") {
    const input = parse(patchSchema, await readBody(req));
    await requireAdminProductModuleScope(requestContext, input.companyId, input.locationId || null, dependencies);
    sendJson(res, 200, { rule: await (dependencies.patch || patchProductModuleAccess)(requestContext, input) });
    return true;
  }
  return false;
}

export const productModuleRouteInternals = { parse };
