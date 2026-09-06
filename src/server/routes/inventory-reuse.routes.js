import { ZodError } from "zod";
import { InventoryError } from "../modules/inventory/inventory.errors.js";
import { commandInventoryReuse, getInventoryReuse, saveInventoryReuseConfiguration } from "../modules/inventory/inventory-reuse.service.js";

export async function handleInventoryReuseApi(req, res, url, helpers, dependencies = {}) {
  if (!/^\/api\/inventory-reuse(?:\/|$)/.test(url.pathname)) return false;
  const suffix = url.pathname.slice("/api/inventory-reuse".length);
  const scope = Object.fromEntries(["companyId", "locationId", "limit", "cursor", "q", "status", "route", "condition", "catalogPartId", "code"].map((key) => [key, url.searchParams.get(key)]).filter(([, value]) => value !== null));
  try {
    if (req.method === "GET") {
      const asset = /^\/asset\/([^/]+)$/.exec(suffix), operation = /^\/operations\/([^/]+)$/.exec(suffix), unit = /^\/units\/([^/]+)$/.exec(suffix), children = /^\/stock\/([^/]+)\/units$/.exec(suffix);
      let view = suffix === "/stock" ? "stock" : suffix === "/queue" || suffix === "" ? "queue" : suffix === "/scan" ? "scan" : children ? "units" : unit ? "unit" : asset ? "asset" : operation ? "operation" : suffix === "/config" ? "config" : null;
      if (view) { helpers.sendJson(res, 200, await getInventoryReuse(view, { ...scope, ...(children ? { catalogPartId: decodeURIComponent(children[1]) } : {}) }, decodeURIComponent(unit?.[1] || asset?.[1] || operation?.[1] || ""), helpers.requestContext, dependencies)); return true; }
    }
    if (req.method === "POST") {
      if (suffix === "/config/grant" || suffix === "/config/policy") { helpers.sendJson(res, 200, await saveInventoryReuseConfiguration(suffix.endsWith("/grant") ? "grant" : "policy", await helpers.readBody(req), helpers.requestContext, dependencies)); return true; }
      if (suffix === "/remove") { helpers.sendJson(res, 200, await commandInventoryReuse("remove", null, await helpers.readBody(req), helpers.requestContext, dependencies)); return true; }
      if (suffix === "/legacy-track") { helpers.sendJson(res, 200, await commandInventoryReuse("legacy_track", null, await helpers.readBody(req), helpers.requestContext, dependencies)); return true; }
      if (suffix === "/location-correction") { helpers.sendJson(res, 200, await commandInventoryReuse("correct_location", null, await helpers.readBody(req), helpers.requestContext, dependencies)); return true; }
      const command = /^\/([^/]+)\/(receive|review|release|route|repair\/start|repair\/complete|core-return|scrap|quarantine\/resolve)$/.exec(suffix);
      if (command) {
        const action = { receive: "receive", review: "release", release: "release", route: "route", "repair/start": "repair_start", "repair/complete": "repair_complete", "core-return": "core_return", scrap: "scrap", "quarantine/resolve": "quarantine_resolve" }[command[2]];
        const body = await helpers.readBody(req);
        helpers.sendJson(res, 200, await commandInventoryReuse(action, command[1], body, helpers.requestContext, dependencies)); return true;
      }
    }
    helpers.sendJson(res, 405, { error: "Unsupported inventory custody action." }); return true;
  } catch (error) {
    if (error instanceof ZodError) { helpers.sendJson(res, 400, { error: "Invalid inventory custody request.", code: "validation_error", issues: error.issues }); return true; }
    if (error instanceof InventoryError) { helpers.sendJson(res, error.statusCode, { error: error.message, code: error.code, retryable: error.retryable }); return true; }
    throw error;
  }
}
