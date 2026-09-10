import { ZodError } from "zod";
import {
  addLaborProduct,
  changeLaborProductPin,
  readLaborProducts,
} from "../modules/labor/labor-products.service.js";

async function emitLaborAudit(helpers, event) {
  if (!helpers.emitAdministrativeAuditEvent) return;
  try {
    await helpers.emitAdministrativeAuditEvent(event);
  } catch (error) {
    console.warn(JSON.stringify({
      type: "labor_product_audit_sink_failed",
      auditType: event.type,
      requestId: event.requestId || null,
      message: error?.message || "Unknown audit sink failure",
    }));
  }
}

export async function handleLaborProductsApi(req, res, url, helpers, dependencies = {}) {
  if (url.pathname !== "/api/labor-products" && !url.pathname.startsWith("/api/labor-products/")) return false;
  try {
    if (req.method === "GET" && url.pathname === "/api/labor-products") {
      helpers.sendJson(res, 200, await readLaborProducts(url.searchParams, helpers.requestContext, dependencies));
      return true;
    }
    if (req.method === "POST" && url.pathname === "/api/labor-products") {
      const body = await helpers.readBody(req);
      const item = await addLaborProduct(body, helpers.requestContext, dependencies);
      await emitLaborAudit(helpers, {
        type: "labor_product_created",
        requestId: req.requestId || null,
        actorId: helpers.requestContext.actor.id,
        laborProductId: item.id,
        locationId: body.locationId,
      });
      helpers.sendJson(res, 201, { item });
      return true;
    }
    const match = /^\/api\/labor-products\/([^/]+)$/.exec(url.pathname);
    if (req.method === "PATCH" && match) {
      const body = await helpers.readBody(req);
      const item = await changeLaborProductPin(
        decodeURIComponent(match[1]),
        body,
        helpers.requestContext,
        dependencies,
      );
      await emitLaborAudit(helpers, {
        type: "labor_product_pin_changed",
        requestId: req.requestId || null,
        actorId: helpers.requestContext.actor.id,
        laborProductId: item.id,
        locationId: body.locationId,
        pinned: item.pinned,
      });
      helpers.sendJson(res, 200, { item });
      return true;
    }
    return false;
  } catch (error) {
    if (!(error instanceof ZodError)) throw error;
    const validation = new Error(error.issues[0]?.message || "Invalid labor product request.");
    validation.statusCode = 400;
    validation.code = "LABOR_PRODUCT_INVALID";
    throw validation;
  }
}
