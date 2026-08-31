import { createHash, randomUUID } from "node:crypto";
import { getUnitDefinition, normalizeUomCode } from "../../../../shared/units-of-measure.js";
import {
  listLocalInventoryStock,
  listLocalInvoiceHistory,
  postLocalInventoryReceipt,
} from "../../db/repositories/local-inventory.repo.js";
import { loadReviewedInvoiceForReceipt } from "../../db/repositories/inventory-receipts.repo.js";
import { invoiceDraftSchema } from "../invoice-extraction/invoice-extraction.schemas.js";
import { normalizePartNumber } from "../parts/part.constants.js";
import { InventoryError, inventoryNotFound } from "./inventory.errors.js";
import { withInventoryLabels } from "./inventory-receiving.service.js";
import { assertInventoryQrConfigured } from "./inventory-qr.js";
import {
  confirmLocalReceiptSchema,
  inventoryStockQuerySchema,
  invoiceHistoryQuerySchema,
} from "./inventory.schemas.js";

function publicError(code, message, statusCode = 422, retryable = false) {
  return new InventoryError(message, { code, statusCode, retryable });
}

function actorScope(requestContext) {
  return {
    companyIds: [...(requestContext.companyIds || [])],
    locationIds: [...(requestContext.locationIds || [])],
    isAdmin: requestContext.actor.role === "admin",
  };
}

function companyInventoryReadScope(requestContext) {
  return {
    companyIds: [...(requestContext.companyIds || [])],
    locationIds: [...(requestContext.locationIds || [])],
    isAdmin: ["admin", "office"].includes(requestContext.actor.role),
  };
}

function assertLocationAccess(locationId, requestContext) {
  if (requestContext.actor.role !== "admin" && !requestContext.locationIds?.has(locationId)) {
    throw inventoryNotFound();
  }
}

function prepareLocalLines(draft) {
  if (draft.documentType.value !== "invoice") {
    throw publicError("INVENTORY_DOCUMENT_TYPE_INVALID", "Only a reviewed invoice can add inventory.");
  }
  if (!draft.lines.length) throw publicError("INVENTORY_LINES_REQUIRED", "Add at least one invoice line before posting inventory.");
  if (draft.lines.length > 500) throw publicError("INVENTORY_LINE_LIMIT", "Post no more than 500 invoice lines at once.");
  return draft.lines.map((line, lineIndex) => {
    const partNumber = String(line.partNumber.value || "").trim();
    const normalizedPartNumber = normalizePartNumber(partNumber);
    if (!normalizedPartNumber) {
      throw publicError("INVENTORY_PART_NUMBER_REQUIRED", `Invoice line ${lineIndex + 1} needs a part number.`);
    }
    const rawUom = String(line.unitOfMeasure.value || "").trim().toLowerCase();
    if (rawUom && !getUnitDefinition(rawUom)) {
      throw publicError("INVENTORY_UOM_INVALID", `Invoice line ${lineIndex + 1} has an unsupported unit: ${rawUom}.`);
    }
    const uomCode = normalizeUomCode(rawUom);
    const unit = getUnitDefinition(uomCode);
    const quantity = Number(line.quantity.value);
    const factor = 10 ** unit.decimalScale;
    const scaled = Math.round(quantity * factor) / factor;
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 999999.999 || scaled !== quantity) {
      throw publicError("INVENTORY_QUANTITY_INVALID", `Invoice line ${lineIndex + 1} has an invalid quantity for ${uomCode}.`);
    }
    const unitCost = line.unitPrice.value === null ? null : Number(line.unitPrice.value);
    const lineTotal = line.lineTotal.value === null ? null : Number(line.lineTotal.value);
    if (unitCost !== null && (!Number.isFinite(unitCost) || unitCost < 0)) {
      throw publicError("INVENTORY_UNIT_COST_INVALID", `Invoice line ${lineIndex + 1} has an invalid unit cost.`);
    }
    if (lineTotal !== null && (!Number.isFinite(lineTotal) || lineTotal < 0)) {
      throw publicError("INVENTORY_LINE_TOTAL_INVALID", `Invoice line ${lineIndex + 1} has an invalid line total.`);
    }
    return {
      id: randomUUID(),
      lineIndex,
      normalizedPartNumber,
      partNumber,
      description: String(line.description.value || "").trim(),
      quantity,
      uomCode,
      unitCost,
      lineTotal,
    };
  });
}

function requestHash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export async function confirmReviewedInvoiceFullDelivery(runId, input, requestContext, dependencies = {}) {
  const parsed = confirmLocalReceiptSchema.parse(input);
  const scope = actorScope(requestContext);
  const source = await (dependencies.loadInvoice || loadReviewedInvoiceForReceipt)({
    runId,
    companyIds: scope.companyIds,
  });
  if (!source) throw inventoryNotFound();
  assertLocationAccess(source.location_id, requestContext);
  if (source.status !== "reviewed" || !source.reviewed_draft) {
    throw publicError("INVOICE_REVIEW_REQUIRED", "Review and approve the invoice before adding inventory.", 409);
  }
  if (Number(source.version) !== parsed.expectedVersion) {
    throw publicError("INVOICE_REVIEW_STALE", "This reviewed invoice changed. Refresh it before confirming delivery.", 409, true);
  }
  const draft = invoiceDraftSchema.parse(source.reviewed_draft);
  const lines = prepareLocalLines(draft);
  const serializedQuantity = lines.reduce((total, line) => {
    const category = getUnitDefinition(line.uomCode)?.category;
    return category === "count" || category === "packaging" ? total + line.quantity : total;
  }, 0);
  if (serializedQuantity > 500) {
    throw publicError(
      "INVENTORY_RECEIPT_UNIT_LIMIT",
      "Create no more than 500 serialized labels in one invoice. Split larger deliveries before adding inventory.",
    );
  }
  if (serializedQuantity) assertInventoryQrConfigured(dependencies.qrOptions);
  const hashShape = {
    runId,
    reviewedRunVersion: parsed.expectedVersion,
    locationId: source.location_id,
    confirmation: parsed.confirmation,
    lines: lines.map(({ id: _id, ...line }) => line),
  };
  const receiptId = randomUUID();
  const labelBatchId = serializedQuantity ? randomUUID() : null;
  const postingLines = lines.map((line) => {
    const category = getUnitDefinition(line.uomCode)?.category;
    const serializable = category === "count" || category === "packaging";
    return {
      ...line,
      serializedUnits: serializable
        ? Array.from({ length: line.quantity }, (_, index) => ({
          id: randomUUID(),
          ordinal: index + 1,
          serialNumber: `WG-L-${receiptId.replaceAll("-", "").slice(0, 16).toUpperCase()}-${line.lineIndex + 1}-${index + 1}`,
        }))
        : [],
    };
  });
  const result = await (dependencies.postReceipt || postLocalInventoryReceipt)({
    receiptId,
    runId,
    actorId: requestContext.actor.id,
    ...scope,
    idempotencyKey: parsed.idempotencyKey,
    requestHash: requestHash(hashShape),
    reviewedRunVersion: parsed.expectedVersion,
    physicalConfirmation: parsed.confirmation,
    confirmationHash: requestHash({
      runId,
      reviewedRunVersion: parsed.expectedVersion,
      confirmation: parsed.confirmation,
      actorId: requestContext.actor.id,
    }),
    labelBatchId,
    lines: postingLines,
  });
  if (result.kind === "not_found") throw inventoryNotFound();
  if (result.kind === "review_required") {
    throw publicError("INVOICE_REVIEW_REQUIRED", "Review and approve the invoice before adding inventory.", 409);
  }
  if (result.kind === "stale") {
    throw publicError("INVOICE_REVIEW_STALE", "This reviewed invoice changed. Refresh it before confirming delivery.", 409, true);
  }
  if (result.kind === "conflict") {
    throw publicError("INVENTORY_RECEIPT_REPLAY_CONFLICT", "This invoice was already posted with different inventory details.", 409);
  }
  if (result.kind === "authority_conflict") {
    throw publicError(
      "INVENTORY_AUTHORITY_CONFLICT",
      "This legacy inventory balance still has reserved stock. Release its reservations before confirming delivery.",
      409,
    );
  }
  if (result.kind === "authority_unmatched") {
    throw publicError(
      "INVENTORY_AUTHORITY_IDENTITY_UNMATCHED",
      "A legacy inventory identity conflicts with this catalog part. Reconcile it before receiving stock.",
      409,
    );
  }
  return {
    receipt: withInventoryLabels(result.receipt, dependencies.qrOptions),
    labelBatch: result.receipt.labelBatch || null,
    replayed: result.kind === "replay",
  };
}

export const postReviewedInvoiceToLocalInventory = confirmReviewedInvoiceFullDelivery;

export async function readLocalInvoiceHistory(searchParams, requestContext, dependencies = {}) {
  const parsed = invoiceHistoryQuerySchema.parse(Object.fromEntries(searchParams));
  const history = await (dependencies.listHistory || listLocalInvoiceHistory)({
    ...actorScope(requestContext),
    queryText: parsed.q,
    status: parsed.status,
    limit: parsed.limit,
    offset: (parsed.page - 1) * parsed.limit,
  });
  const invoices = Array.isArray(history) ? history : history.items;
  const total = Number(Array.isArray(history) ? history.length : history.total) || 0;
  return {
    invoices,
    page: parsed.page,
    limit: parsed.limit,
    total,
    pageCount: Math.max(1, Math.ceil(total / parsed.limit)),
  };
}

export async function readLocalInventoryStock(searchParams, requestContext, dependencies = {}) {
  const parsed = inventoryStockQuerySchema.parse(Object.fromEntries(searchParams));
  const listStock = dependencies.listStock || listLocalInventoryStock;
  const stockQuery = {
    ...companyInventoryReadScope(requestContext),
    locationId: parsed.locationId || null,
    scope: parsed.locationId ? "location" : parsed.scope,
    availability: parsed.availability,
    sort: parsed.sort,
    queryText: parsed.q,
    limit: parsed.limit,
    offset: (parsed.page - 1) * parsed.limit,
  };
  const items = await listStock(stockQuery);
  let total = Number(items.total ?? items.length);
  let counts = items.counts;
  if (!items.length) {
    const firstPage = await listStock({ ...stockQuery, limit: 1, offset: 0 });
    total = Number(firstPage.total ?? firstPage.length);
    counts = firstPage.counts;
    if (!firstPage.length && parsed.availability !== "all") {
      const countSource = await listStock({ ...stockQuery, availability: "all", limit: 1, offset: 0 });
      counts = countSource.counts;
    }
  }
  return {
    items,
    limit: parsed.limit,
    page: parsed.page,
    pageCount: Math.max(1, Math.ceil(total / parsed.limit)),
    total,
    scope: parsed.locationId ? "location" : parsed.scope,
    counts: counts || { all: total, available: 0, reserved: 0, out: 0 },
    locationId: parsed.locationId || null,
    asOf: new Date().toISOString(),
  };
}
