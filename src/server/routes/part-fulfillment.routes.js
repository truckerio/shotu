import { ZodError } from "zod";
import { catalogUomConflictError, InventoryError } from "../modules/inventory/inventory.errors.js";
import { approveRecommendedFulfillment, recommendPartFulfillment } from "../modules/parts/part-fulfillment.service.js";

function approvalId(pathname) {
  const match = /^\/api\/office\/part-fulfillments\/([^/]+)\/approve$/.exec(pathname);
  return match ? decodeURIComponent(match[1]) : null;
}

function sendError(sendJson, res, error) {
  error = catalogUomConflictError(error) || error;
  if (error instanceof ZodError) return sendJson(res, 400, { error: "Invalid Get Parts request.", code: "validation_error", issues: error.issues });
  if (error instanceof InventoryError) return sendJson(res, error.statusCode, { error: error.message, code: error.code, retryable: error.retryable });
  throw error;
}

export async function handlePartFulfillmentApi(req, res, url, helpers, dependencies = {}) {
  const relevant = url.pathname === "/api/office/part-fulfillments" || /^\/api\/office\/part-fulfillments\/[^/]+\/approve$/.test(url.pathname);
  if (!relevant) return false;
  try {
    if (req.method === "POST" && url.pathname === "/api/office/part-fulfillments") {
      helpers.sendJson(res, 201, await recommendPartFulfillment(await helpers.readBody(req), helpers.requestContext, dependencies));
      return true;
    }
    const id = approvalId(url.pathname);
    if (req.method === "POST" && id) {
      helpers.sendJson(res, 200, await approveRecommendedFulfillment(id, await helpers.readBody(req), helpers.requestContext, dependencies));
      return true;
    }
    helpers.sendJson(res, 405, { error: "Unsupported Get Parts action." }); return true;
  } catch (error) { sendError(helpers.sendJson, res, error); return true; }
}
