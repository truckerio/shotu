import { z, ZodError } from "zod";
import { readBusinessSetup, writeBusinessSetup } from "../modules/business-setup/business-setup.service.js";
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
const scope = z.object({ companyId: uuid, locationId: uuid.optional() }).strict();
const identity = z.object({ legalName: z.string().trim().max(300), address: z.string().trim().max(1000), phone: z.string().trim().max(100), email: z.union([z.string().trim().length(0), z.string().trim().email().max(320)]) }).strict();
const save = scope.extend({ expectedVersion: z.number().int().nonnegative(), idempotencyKey: z.string().trim().min(8).max(200), operatingMode: z.enum(["fleet_only", "customer_repairs", "both"]), shopIdentity: identity, step: z.number().int().min(1).max(3), status: z.enum(["draft", "completed"]) }).strict().superRefine((value, ctx) => {
  if (value.status === "completed" && (!value.shopIdentity.legalName || !value.shopIdentity.address)) ctx.addIssue({ code: "custom", message: "Legal name and address are required to complete setup." });
});
export async function handleBusinessSetupApi(req, res, url, helpers, dependencies = {}) {
  if (url.pathname !== "/api/admin/business-setup" || !["GET", "PUT"].includes(req.method)) return false;
  try {
    const input = req.method === "GET" ? scope.parse({ companyId: url.searchParams.get("companyId"), ...(url.searchParams.has("locationId") ? { locationId: url.searchParams.get("locationId") } : {}) }) : save.parse(await helpers.readBody(req));
    const service = req.method === "GET" ? dependencies.readBusinessSetup || readBusinessSetup : dependencies.writeBusinessSetup || writeBusinessSetup;
    helpers.sendJson(res, 200, await service(helpers.requestContext, input));
    return true;
  } catch (error) {
    if (!(error instanceof ZodError)) throw error;
    helpers.sendJson(res, 400, { error: "Invalid business setup request.", code: "validation_error", issues: error.issues });
    return true;
  }
}
