import { ZodError } from "zod";
import { InventoryError } from "./inventory.errors.js";
import {
  readInventoryReceiptLabels,
  receiveReviewedInvoice,
  renderInventoryUnitQr,
  resolveInventoryCode,
} from "./inventory-receiving.service.js";
import {
  confirmReviewedInvoiceFullDelivery,
  readLocalInventoryStock,
  readLocalInvoiceHistory,
} from "./local-inventory.service.js";
import {
  readInventoryLabelBatchItems,
  renderInventoryLabelBatchPrint,
  renderInventoryUnitLabel,
  renderPartLocationLabels,
} from "./inventory-labels.service.js";
import {
  createSerializedUnitsForPart,
  readPartLocationSerialization,
  readSerializedInventoryUnit,
} from "./inventory-part-serialization.service.js";
import {
  confirmInventoryCount,
  downloadInventoryCountFile,
  readInventoryCount,
  readInventoryCounts,
  resolveInventoryCountLine,
  searchInventoryMasterParts,
  uploadInventoryCount,
} from "./inventory-count-imports.service.js";

function inventoryDownloadDisposition(fileName) {
  const source = String(fileName || "inventory-count.xlsx").replace(/[\r\n]/g, "_");
  const ascii = source.normalize("NFKD").replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_").slice(0, 180) || "inventory-count.xlsx";
  const encoded = encodeURIComponent(source).replace(/[!'()*]/g, (value) => `%${value.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

async function emitInventoryAudit(helpers, event) {
  if (!helpers.emitAdministrativeAuditEvent) return false;
  try {
    await helpers.emitAdministrativeAuditEvent(event);
    return true;
  } catch (error) {
    const failure = {
      type: "inventory_audit_sink_failed",
      auditType: event.type,
      requestId: event.requestId || null,
      message: error?.message || "Unknown audit sink failure",
    };
    if (helpers.logAuditFailure) helpers.logAuditFailure(failure);
    else console.warn(JSON.stringify(failure));
    return false;
  }
}

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
    || /\/(receive|confirm-receipt)$/.test(url.pathname) && url.pathname.startsWith("/api/office/invoice-extractions/");
  if (!relevant) return false;
  try {
    if (req.method === "GET" && url.pathname === "/api/office/inventory/catalog") {
      helpers.sendJson(res, 200, await searchInventoryMasterParts(url.searchParams, helpers.requestContext, dependencies));
      return true;
    }
    if (req.method === "POST" && url.pathname === "/api/office/inventory/count-imports") {
      const result = await uploadInventoryCount(await helpers.readBody(req), helpers.requestContext, dependencies);
      await emitInventoryAudit(helpers, {
        type: "inventory_count_upload",
        requestId: req.requestId || null,
        actorId: helpers.requestContext.actor.id,
        importId: result.import.id,
        locationId: result.import.locationId,
        replayed: result.replayed,
      });
      helpers.sendJson(res, 201, result);
      return true;
    }
    if (req.method === "GET" && url.pathname === "/api/office/inventory/count-imports") {
      helpers.sendJson(res, 200, await readInventoryCounts(url.searchParams, helpers.requestContext, dependencies));
      return true;
    }
    const countImportId = pathId(url.pathname, /^\/api\/office\/inventory\/count-imports\/([^/]+)$/);
    if (req.method === "GET" && countImportId) {
      helpers.sendJson(res, 200, await readInventoryCount(countImportId, helpers.requestContext, dependencies));
      return true;
    }
    const countFileId = pathId(url.pathname, /^\/api\/office\/inventory\/count-imports\/([^/]+)\/file$/);
    if (req.method === "GET" && countFileId) {
      const file = await downloadInventoryCountFile(countFileId, helpers.requestContext, dependencies);
      res.writeHead(200, {
        "content-type": file.contentType,
        "content-length": Buffer.byteLength(file.bytes),
        "content-disposition": inventoryDownloadDisposition(file.fileName),
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      });
      res.end(file.bytes);
      return true;
    }
    const countLineMatch = /^\/api\/office\/inventory\/count-imports\/([^/]+)\/lines\/([^/]+)$/.exec(url.pathname);
    if (req.method === "PATCH" && countLineMatch) {
      const importId = decodeURIComponent(countLineMatch[1]);
      const lineId = decodeURIComponent(countLineMatch[2]);
      const resolutionInput = await helpers.readBody(req);
      const result = await resolveInventoryCountLine(
        importId,
        lineId,
        resolutionInput,
        helpers.requestContext,
        dependencies,
      );
      await emitInventoryAudit(helpers, {
        type: "inventory_count_line_review",
        requestId: req.requestId || null,
        actorId: helpers.requestContext.actor.id,
        importId,
        lineId,
        locationId: result.import.locationId,
        action: resolutionInput.action,
      });
      helpers.sendJson(res, 200, result);
      return true;
    }
    const applyCountId = pathId(url.pathname, /^\/api\/office\/inventory\/count-imports\/([^/]+)\/apply$/);
    if (req.method === "POST" && applyCountId) {
      const result = await confirmInventoryCount(
        applyCountId,
        await helpers.readBody(req),
        helpers.requestContext,
        dependencies,
      );
      await emitInventoryAudit(helpers, {
        type: "inventory_count_apply",
        requestId: req.requestId || null,
        actorId: helpers.requestContext.actor.id,
        importId: result.import.id,
        locationId: result.import.locationId,
        replayed: result.replayed,
      });
      helpers.sendJson(res, 200, result);
      return true;
    }
    const localRunId = pathId(url.pathname, /^\/api\/office\/invoice-extractions\/([^/]+)\/confirm-receipt$/);
    if (req.method === "POST" && localRunId) {
      helpers.sendJson(res, 200, await confirmReviewedInvoiceFullDelivery(
        localRunId,
        await helpers.readBody(req),
        helpers.requestContext,
        dependencies,
      ));
      return true;
    }
    const labelBatchId = pathId(url.pathname, /^\/api\/office\/inventory\/label-batches\/([^/]+)\/items$/);
    if (req.method === "GET" && labelBatchId) {
      helpers.sendJson(res, 200, await readInventoryLabelBatchItems(labelBatchId, url.searchParams, helpers.requestContext, dependencies));
      return true;
    }
    const printBatchId = pathId(url.pathname, /^\/api\/office\/inventory\/label-batches\/([^/]+)\/print$/);
    if (req.method === "GET" && printBatchId) {
      const html = await renderInventoryLabelBatchPrint(printBatchId, helpers.requestContext, dependencies);
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "private, no-store",
        "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:",
      });
      res.end(html);
      return true;
    }
    if (req.method === "GET" && url.pathname === "/api/office/inventory/invoices") {
      helpers.sendJson(res, 200, await readLocalInvoiceHistory(url.searchParams, helpers.requestContext, dependencies));
      return true;
    }
    if (req.method === "GET" && url.pathname === "/api/office/inventory/stock") {
      helpers.sendJson(res, 200, await readLocalInventoryStock(url.searchParams, helpers.requestContext, dependencies));
      return true;
    }
    const partLocationMatch = /^\/api\/office\/inventory\/parts\/([^/]+)\/locations\/([^/]+)\/units$/.exec(url.pathname);
    if (partLocationMatch && req.method === "GET") {
      helpers.sendJson(res, 200, await readPartLocationSerialization(
        decodeURIComponent(partLocationMatch[1]),
        decodeURIComponent(partLocationMatch[2]),
        helpers.requestContext,
        dependencies,
      ));
      return true;
    }
    if (partLocationMatch && req.method === "POST") {
      const result = await createSerializedUnitsForPart(
        decodeURIComponent(partLocationMatch[1]),
        decodeURIComponent(partLocationMatch[2]),
        await helpers.readBody(req),
        helpers.requestContext,
        dependencies,
      );
      await emitInventoryAudit(helpers, {
        type: "inventory_serialized_units_created",
        requestId: req.requestId || null,
        actorId: helpers.requestContext.actor.id,
        catalogPartId: decodeURIComponent(partLocationMatch[1]),
        locationId: decodeURIComponent(partLocationMatch[2]),
        quantity: result.quantity,
        replayed: result.replayed,
      });
      helpers.sendJson(res, 201, result);
      return true;
    }
    const partLabelsMatch = /^\/api\/office\/inventory\/parts\/([^/]+)\/locations\/([^/]+)\/labels$/.exec(url.pathname);
    if (partLabelsMatch && req.method === "GET") {
      const html = await renderPartLocationLabels(
        decodeURIComponent(partLabelsMatch[1]),
        decodeURIComponent(partLabelsMatch[2]),
        helpers.requestContext,
        dependencies,
      );
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "private, no-store",
        "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:",
      });
      res.end(html);
      return true;
    }
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
    const unitDetailsId = pathId(url.pathname, /^\/api\/office\/inventory\/units\/([^/]+)$/);
    if (req.method === "GET" && unitDetailsId) {
      helpers.sendJson(res, 200, await readSerializedInventoryUnit(unitDetailsId, helpers.requestContext, dependencies));
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
    const unitLabelId = pathId(url.pathname, /^\/api\/office\/inventory\/units\/([^/]+)\/label$/);
    if (req.method === "GET" && unitLabelId) {
      const html = await renderInventoryUnitLabel(unitLabelId, helpers.requestContext, dependencies);
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "private, no-store",
        "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:",
      });
      res.end(html);
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

export const inventoryRouteInternals = { emitInventoryAudit, inventoryDownloadDisposition };
