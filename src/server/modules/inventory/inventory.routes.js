import { ZodError } from "zod";
import { InventoryError } from "./inventory.errors.js";
import {
  readInventoryReceiptLabels,
  receiveReviewedInvoice,
  renderInventoryUnitQr,
  resolveInventoryCode,
} from "./inventory-receiving.service.js";

function pathId(pathname, pattern) {
  const match = pattern.exec(pathname);
  return match ? decodeURIComponent(match[1]) : null;
}

function sendError(helpers, res, error) {
  if (error instanceof ZodError) {
    helpers.sendJson(res, 400, { error: "Invalid inventory request.", code: "validation_error", issues: error.issues });
    return;
  }
  if (error instanceof InventoryError) {
    helpers.sendJson(res, error.statusCode, { error: error.message, code: error.code, retryable: error.retryable });
    return;
  }
  throw error;
}

export async function handleInventoryApi(req, res, url, helpers, dependencies = {}) {
  const relevant = url.pathname.startsWith("/api/inventory/")
    || url.pathname.startsWith("/api/office/inventory/")
    || /\/receive$/.test(url.pathname) && url.pathname.startsWith("/api/office/invoice-extractions/");
  if (!relevant) return false;
  try {
    const runId = pathId(url.pathname, /^\/api\/office\/invoice-extractions\/([^/]+)\/receive$/);
    if (req.method === "POST" && runId) {
      helpers.sendJson(res, 200, await receiveReviewedInvoice(runId, await helpers.readBody(req), helpers.requestContext, dependencies));
      return true;
    }
    const receiptId = pathId(url.pathname, /^\/api\/office\/inventory\/receipts\/([^/]+)\/labels$/);
    if (req.method === "GET" && receiptId) {
      helpers.sendJson(res, 200, await readInventoryReceiptLabels(receiptId, helpers.requestContext, dependencies));
      return true;
    }
    const unitId = pathId(url.pathname, /^\/api\/office\/inventory\/units\/([^/]+)\/qr\.svg$/);
    if (req.method === "GET" && unitId) {
      const svg = await renderInventoryUnitQr(unitId, helpers.requestContext, dependencies);
      res.writeHead(200, {
        "content-type": "image/svg+xml; charset=utf-8",
        "cache-control": "private, no-store",
        "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
      });
      res.end(svg);
      return true;
    }
    if (req.method === "POST" && url.pathname === "/api/inventory/resolve") {
      helpers.sendJson(res, 200, await resolveInventoryCode(await helpers.readBody(req), helpers.requestContext, dependencies));
      return true;
    }
    helpers.sendJson(res, 404, { error: "Inventory route was not found.", code: "route_not_found" });
    return true;
  } catch (error) {
    sendError(helpers, res, error);
    return true;
  }
}
