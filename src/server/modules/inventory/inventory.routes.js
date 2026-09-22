import { handleInventoryPositionsApi } from "./inventory-positions.routes.js";
import { handleInventoryPricingApi } from "./inventory-pricing.routes.js";
import { readInventoryPartCommercial, updateInventoryPartPrice } from "./inventory-part-prices.service.js";
import { listPurchaseBills, uploadPurchaseBill, downloadPurchaseBill } from './purchase-order-bills.service.js';
import { getBills,postBill } from './inventory-bills.service.js';
import { getInventoryReports } from './inventory-reports.service.js';
import { getInbound,getInboundDetail } from './inventory-inbound.service.js';
import { getInventoryTask, getInventoryTaskQueue, postInventoryTaskAssignment } from './inventory-task-queue.service.js';
import { getStockTask,getStockTasks,getStockTaskSnapshot,postStockTask } from './inventory-stock-tasks.service.js';
import { ZodError } from "zod";
import { getPurchasing,savePurchase,getPurchaseCommand,getPurchaseApprovalSettings,savePurchaseApprovalSettings,receivePurchaseOrder } from "./inventory-purchasing.service.js";
import { getPurchaseRequests,postPurchaseRequest } from "./inventory-purchase-requests.service.js";
import { decideDirectReceiptApproval, receiveDirectInventory, readDirectReceiptApproval, readDirectReceiptOutcome, readPartStockMovements } from "./direct-inventory-receipt.service.js";
import { catalogUomConflictError, InventoryError } from "./inventory.errors.js";
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
import { getPurchaseInvoiceSuggestions } from "./inventory-purchase-invoice-allocation.service.js";
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
import { createInventoryPart, updateInventoryPart } from "./inventory-part-details.service.js";
import { updateInventoryStockRule } from "./inventory-stocking-policy.service.js";
import { createAggregateStockIntake } from "./inventory-stock-intake.service.js";
import {
  readInventoryAuthorityException,
  readInventoryAuthorityExceptions,
  resolveInventoryAuthorityException,
} from "./inventory-authority-reconciliation.service.js";

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
  error = catalogUomConflictError(error) || error;
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
    || /\/(receive|confirm-receipt|purchase-order-suggestions)$/.test(url.pathname) && url.pathname.startsWith("/api/office/invoice-extractions/");
  if (!relevant) return false;
  try {
    if (await handleInventoryPositionsApi(req, res, url, helpers, dependencies)) return true;
    if (await handleInventoryPricingApi(req, res, url, helpers, dependencies)) return true;
    const commercialPartId = pathId(url.pathname, /^\/api\/office\/inventory\/parts\/([^/]+)\/commercial$/);
    if (req.method === "GET" && commercialPartId) {
      helpers.sendJson(res, 200, await readInventoryPartCommercial(commercialPartId, url.searchParams, helpers.requestContext, dependencies));
      return true;
    }
    const priceMatch = /^\/api\/office\/inventory\/parts\/([^/]+)\/prices\/([^/]+)$/.exec(url.pathname);
    if (req.method === "PUT" && priceMatch) {
      helpers.sendJson(res, 200, await updateInventoryPartPrice(decodeURIComponent(priceMatch[1]), decodeURIComponent(priceMatch[2]), await helpers.readBody(req), helpers.requestContext, dependencies));
      return true;
    }
    if(url.pathname==='/api/office/inventory/purchase-requests'){
      if(req.method==='GET'){helpers.sendJson(res,200,await getPurchaseRequests(url.searchParams,helpers.requestContext));return true;}
      if(req.method==='POST'){helpers.sendJson(res,200,await postPurchaseRequest(await helpers.readBody(req),helpers.requestContext));return true;}
    }
    const purchaseBillPath=/^\/api\/office\/inventory\/purchasing\/([^/]+)\/bills(?:\/([^/]+))?$/.exec(url.pathname);
    if(purchaseBillPath){
      const orderId=purchaseBillPath[1],documentId=purchaseBillPath[2];
      if(req.method==='GET'&&documentId){
        const file=await downloadPurchaseBill(orderId,documentId,helpers.requestContext);
        res.writeHead(200,{'content-type':file.mimeType,'content-length':file.bytes.length,'content-disposition':inventoryDownloadDisposition(file.fileName),'cache-control':'private, no-store','x-content-type-options':'nosniff'});res.end(file.bytes);return true;
      }
      if(req.method==='GET'){helpers.sendJson(res,200,await listPurchaseBills(orderId,helpers.requestContext));return true;}
      if(req.method==='POST'&&!documentId){const body=await helpers.readBody(req);helpers.sendJson(res,200,await uploadPurchaseBill({...body,orderId},helpers.requestContext));return true;}
    }
    const purchaseReceiptPath=/^\/api\/office\/inventory\/purchasing\/([^/]+)\/receipts$/.exec(url.pathname);
    if(req.method==='POST'&&purchaseReceiptPath){
      helpers.sendJson(res,200,await receivePurchaseOrder(decodeURIComponent(purchaseReceiptPath[1]),await helpers.readBody(req),helpers.requestContext,dependencies));return true;
    }
    if(url.pathname==='/api/office/inventory/bills'){
      if(req.method==='GET'){helpers.sendJson(res,200,await getBills(url.searchParams,helpers.requestContext));return true;}
      if(req.method==='POST'){helpers.sendJson(res,200,await postBill(await helpers.readBody(req),helpers.requestContext));return true;}
    }
    if(req.method==='GET'&&url.pathname==='/api/office/inventory/reports'){helpers.sendJson(res,200,await getInventoryReports(url.searchParams,helpers.requestContext));return true;}
    if(req.method==='GET'&&url.pathname==='/api/office/inventory/inbound'){helpers.sendJson(res,200,await (dependencies.getInbound||getInbound)(url.searchParams,helpers.requestContext,dependencies));return true;}
    const inboundDetail=/^\/api\/office\/inventory\/inbound\/([^/]+)$/.exec(url.pathname);
    if(req.method==='GET'&&inboundDetail){helpers.sendJson(res,200,await (dependencies.getInboundDetail||getInboundDetail)(decodeURIComponent(inboundDetail[1]),url.searchParams,helpers.requestContext,dependencies));return true;}
    if(req.method==='GET'&&url.pathname==='/api/office/inventory/task-queue'){
      helpers.sendJson(res,200,await (dependencies.getInventoryTaskQueue||getInventoryTaskQueue)(url.searchParams,helpers.requestContext,dependencies));return true;
    }
    if(req.method==='POST'&&url.pathname==='/api/office/inventory/task-queue/assignments'){
      helpers.sendJson(res,200,await (dependencies.postInventoryTaskAssignment||postInventoryTaskAssignment)(await helpers.readBody(req),helpers.requestContext,dependencies));return true;
    }
    const taskQueueDetail=/^\/api\/office\/inventory\/task-queue\/([^/]+)\/([^/]+)$/.exec(url.pathname);
    if(req.method==='GET'&&taskQueueDetail){
      helpers.sendJson(res,200,await (dependencies.getInventoryTask||getInventoryTask)(decodeURIComponent(taskQueueDetail[1]),decodeURIComponent(taskQueueDetail[2]),url.searchParams,helpers.requestContext,dependencies));return true;
    }
    if(req.method==='GET'&&url.pathname==='/api/office/inventory/stock-tasks/snapshot'){
      helpers.sendJson(res,200,await getStockTaskSnapshot(url.searchParams,helpers.requestContext));return true;
    }
    const stockTaskDetail=/^\/api\/office\/inventory\/stock-tasks\/([^/]+)$/.exec(url.pathname);
    if(req.method==='GET'&&stockTaskDetail){
      helpers.sendJson(res,200,await (dependencies.getStockTask||getStockTask)(decodeURIComponent(stockTaskDetail[1]),url.searchParams,helpers.requestContext));return true;
    }
    if(url.pathname==='/api/office/inventory/stock-tasks'){
      if(req.method==='GET'){helpers.sendJson(res,200,await getStockTasks(url.searchParams,helpers.requestContext));return true;}
      if(req.method==='POST'){helpers.sendJson(res,200,await postStockTask(await helpers.readBody(req),helpers.requestContext));return true;}
    }
    if (url.pathname === '/api/office/inventory/purchasing/approval-settings') {
      if(req.method==='GET'){helpers.sendJson(res,200,await getPurchaseApprovalSettings(url.searchParams,helpers.requestContext));return true;}
      if(req.method==='PUT'){helpers.sendJson(res,200,await savePurchaseApprovalSettings(await helpers.readBody(req),helpers.requestContext));return true;}
    }
    if (req.method==='GET' && url.pathname==='/api/office/inventory/purchasing/command') {
      helpers.sendJson(res,200,await getPurchaseCommand(url.searchParams,helpers.requestContext));return true;
    }
    if (url.pathname === '/api/office/inventory/purchasing') {
      if(req.method==='GET'){helpers.sendJson(res,200,await getPurchasing(url.searchParams,helpers.requestContext));return true;}
      if(req.method==='POST'){helpers.sendJson(res,200,await savePurchase(await helpers.readBody(req),helpers.requestContext));return true;}
    }
    const movementPartId = pathId(url.pathname, /^\/api\/office\/inventory\/parts\/([^/]+)\/movements$/);
    if (req.method === "GET" && movementPartId) {
      helpers.sendJson(res, 200, await readPartStockMovements(movementPartId, url.searchParams, helpers.requestContext, dependencies));
      return true;
    }
    if (req.method === "POST" && url.pathname === "/api/office/inventory/direct-receipts") {
      helpers.sendJson(res, 200, await receiveDirectInventory(await helpers.readBody(req), helpers.requestContext, dependencies));
      return true;
    }
    const directReceiptKey = pathId(url.pathname, /^\/api\/office\/inventory\/direct-receipts\/([^/]+)$/);
    if (req.method === "GET" && directReceiptKey) {
      helpers.sendJson(res, 200, await readDirectReceiptOutcome(directReceiptKey, helpers.requestContext, dependencies));
      return true;
    }
    const directReceiptApprovalDecisionId = pathId(url.pathname, /^\/api\/office\/inventory\/direct-receipt-approvals\/([^/]+)\/decision$/);
    if (req.method === "POST" && directReceiptApprovalDecisionId) {
      helpers.sendJson(res, 200, await decideDirectReceiptApproval(directReceiptApprovalDecisionId, await helpers.readBody(req), helpers.requestContext, dependencies));
      return true;
    }
    const directReceiptApprovalId = pathId(url.pathname, /^\/api\/office\/inventory\/direct-receipt-approvals\/([^/]+)$/);
    if (req.method === "GET" && directReceiptApprovalId) {
      helpers.sendJson(res, 200, await readDirectReceiptApproval(directReceiptApprovalId, helpers.requestContext, dependencies));
      return true;
    }
    if (req.method === "GET" && url.pathname === "/api/office/inventory/catalog") {
      helpers.sendJson(res, 200, await searchInventoryMasterParts(url.searchParams, helpers.requestContext, dependencies));
      return true;
    }
    if (req.method === "POST" && url.pathname === "/api/office/inventory/parts") {
      const body = await helpers.readBody(req);
      const part = await createInventoryPart(body, helpers.requestContext, dependencies);
      await emitInventoryAudit(helpers, { type: "inventory_part_created", requestId: req.requestId || null, actorId: helpers.requestContext.actor.id, catalogPartId: part.id, locationId: body.locationId });
      helpers.sendJson(res, 201, { part });
      return true;
    }
    if (req.method === "GET" && url.pathname === "/api/office/inventory/authority-exceptions") {
      helpers.sendJson(res, 200, await readInventoryAuthorityExceptions(url.searchParams, helpers.requestContext, dependencies));
      return true;
    }
    const authorityExceptionId = pathId(url.pathname, /^\/api\/office\/inventory\/authority-exceptions\/([^/]+)$/);
    if (req.method === "GET" && authorityExceptionId) {
      helpers.sendJson(res, 200, await readInventoryAuthorityException(authorityExceptionId, helpers.requestContext, dependencies));
      return true;
    }
    const resolveAuthorityExceptionId = pathId(url.pathname, /^\/api\/office\/inventory\/authority-exceptions\/([^/]+)\/resolve$/);
    if (req.method === "POST" && resolveAuthorityExceptionId) {
      const result = await resolveInventoryAuthorityException(
        resolveAuthorityExceptionId,
        await helpers.readBody(req),
        helpers.requestContext,
        dependencies,
      );
      await emitInventoryAudit(helpers, {
        type: "inventory_authority_exception_acknowledged",
        requestId: req.requestId || null,
        actorId: helpers.requestContext.actor.id,
        exceptionId: resolveAuthorityExceptionId,
        outcome: result.outcome,
        replayed: result.replayed,
      });
      helpers.sendJson(res, 200, result);
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
    const purchaseSuggestionRunId = pathId(url.pathname, /^\/api\/office\/invoice-extractions\/([^/]+)\/purchase-order-suggestions$/);
    if (req.method === "GET" && purchaseSuggestionRunId) {
      helpers.sendJson(res, 200, await getPurchaseInvoiceSuggestions(new URLSearchParams({ runId: purchaseSuggestionRunId }), helpers.requestContext, dependencies));
      return true;
    }
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
    const editablePartId = pathId(url.pathname, /^\/api\/office\/inventory\/parts\/([^/]+)$/);
    if (req.method === "PATCH" && editablePartId) {
      const part = await updateInventoryPart(editablePartId, await helpers.readBody(req), helpers.requestContext, dependencies);
      await emitInventoryAudit(helpers, { type: "inventory_part_updated", requestId: req.requestId || null, actorId: helpers.requestContext.actor.id, catalogPartId: editablePartId, version: part.version });
      helpers.sendJson(res, 200, { part });
      return true;
    }
    const stockRulePartId = pathId(url.pathname, /^\/api\/office\/inventory\/parts\/([^/]+)\/stock-rule$/);
    if (req.method === "PATCH" && stockRulePartId) {
      const result = await updateInventoryStockRule(stockRulePartId, await helpers.readBody(req), helpers.requestContext, dependencies);
      await emitInventoryAudit(helpers, { type: "inventory_stock_rule_updated", requestId: req.requestId || null, actorId: helpers.requestContext.actor.id, catalogPartId: stockRulePartId });
      helpers.sendJson(res, 200, result);
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
    const stockIntakeMatch = /^\/api\/office\/inventory\/parts\/([^/]+)\/locations\/([^/]+)\/stock-intake$/.exec(url.pathname);
    if (stockIntakeMatch && req.method === "POST") {
      const result = await createAggregateStockIntake(
        decodeURIComponent(stockIntakeMatch[1]),
        decodeURIComponent(stockIntakeMatch[2]),
        await helpers.readBody(req),
        helpers.requestContext,
        dependencies,
      );
      await emitInventoryAudit(helpers, {
        type: "inventory_aggregate_stock_received",
        requestId: req.requestId || null,
        actorId: helpers.requestContext.actor.id,
        catalogPartId: decodeURIComponent(stockIntakeMatch[1]),
        locationId: decodeURIComponent(stockIntakeMatch[2]),
        quantity: result.quantity,
        trackingMode: result.trackingMode,
        replayed: result.replayed,
      });
      helpers.sendJson(res, 201, result);
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
