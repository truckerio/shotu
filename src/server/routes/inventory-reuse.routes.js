import { ZodError } from "zod";
import { InventoryError } from "../modules/inventory/inventory.errors.js";
import { commandInventoryReuse, getInventoryReuse, saveInventoryReuseConfiguration } from "../modules/inventory/inventory-reuse.service.js";

export async function handleInventoryReuseApi(req,res,url,helpers,dependencies = {}) {
  if (!/^\/api\/inventory-reuse(?:\/|$)/.test(url.pathname)) return false;
  const suffix = url.pathname.slice("/api/inventory-reuse".length);
  const scope = {companyId:url.searchParams.get("companyId"),locationId:url.searchParams.get("locationId")};
  try {
    if (req.method === "GET") {
      const asset = /^\/asset\/([^/]+)$/.exec(suffix);
      const operation = /^\/operations\/([^/]+)$/.exec(suffix);
      if (suffix === "" || suffix === "/config" || asset || operation) {
        helpers.sendJson(res,200,await getInventoryReuse(asset ? "asset" : operation ? "operation" : suffix === "/config" ? "config" : "queue",
          scope,decodeURIComponent(asset?.[1] || operation?.[1] || ""),helpers.requestContext,dependencies));
        return true;
      }
    }
    if (req.method === "POST") {
      if (suffix === "/config/grant" || suffix === "/config/policy") {
        helpers.sendJson(res,200,await saveInventoryReuseConfiguration(suffix.endsWith("/grant") ? "grant" : "policy",await helpers.readBody(req),helpers.requestContext,dependencies));
        return true;
      }
      const transition = /^\/([^/]+)\/(receive|review)$/.exec(suffix);
      if (suffix === "/remove" || transition) {
        helpers.sendJson(res,200,await commandInventoryReuse(suffix === "/remove" ? "remove" : transition[2] === "review" ? "release" : "receive",
          transition?.[1],await helpers.readBody(req),helpers.requestContext,dependencies));
        return true;
      }
    }
    helpers.sendJson(res,405,{error:"Unsupported inventory custody action."});
    return true;
  } catch (error) {
    if (error instanceof ZodError) { helpers.sendJson(res,400,{error:"Invalid inventory custody request.",code:"validation_error",issues:error.issues}); return true; }
    if (error instanceof InventoryError) { helpers.sendJson(res,error.statusCode,{error:error.message,code:error.code,retryable:error.retryable}); return true; }
    throw error;
  }
}
