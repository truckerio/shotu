import { createHash, randomUUID } from "node:crypto";
import { getUnitDefinition, normalizeUomCode } from "../../../../shared/units-of-measure.js";
import {
  listLocalInventoryStock,
  listLocalInvoiceHistory,
  postLocalInventoryReceipt,
  getCatalogTrackingModes,
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
import { validateCompleteInvoiceAllocationPlan, validateInvoicePostingRoute } from "./inventory-purchase-invoice-allocation.service.js";
import { physicalInvoiceLineIndexes } from "../../../../shared/invoice-inventory-lines.js";

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
  const physicalLineIndexes = physicalInvoiceLineIndexes(draft.lines);
  const physicalLines = draft.lines
    .map((line, lineIndex) => ({ line, lineIndex }))
    .filter(({ lineIndex }) => physicalLineIndexes.has(lineIndex));
  if (!physicalLines.length) throw publicError("INVENTORY_LINES_REQUIRED", "This invoice has no physical stock lines to receive.");
  return physicalLines.map(({ line, lineIndex }) => {
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
      catalogPartId: line.catalogPartId || null,
      normalizedPartNumber,
      partNumber,
      description: String(line.description.value || "").trim(),
      quantity,
      uomCode,
      unitCost,
      lineTotal,
      currency: String(draft.currency?.value || "").trim().toUpperCase() || null,
    };
  });
}

function requireTrackingPolicies(lines, policies) {
  const trackingByPart = new Map(policies.map((policy) => [policy.catalogPartId, policy.trackingMode]));
  return lines.map((line) => {
    const trackingMode = line.catalogPartId ? trackingByPart.get(line.catalogPartId) || null : null;
    if (!trackingMode) {
      throw publicError(
        "INVENTORY_TRACKING_REQUIRED",
        `Review tracking for ${line.partNumber} before receiving it.`,
        409,
      );
    }
    return { ...line, trackingMode };
  });
}

function assertReceiptQuantity(quantity, line, field) {
  const unit = getUnitDefinition(line.uomCode);
  const factor = 10 ** unit.decimalScale;
  if (!Number.isFinite(quantity) || quantity < 0 || Math.round(quantity * factor) / factor !== quantity) {
    throw publicError("INVENTORY_QUANTITY_INVALID", `${field} for ${line.partNumber} does not match ${line.uomCode} precision.`);
  }
}

function prepareReceiptEpisode(lines, parsed, receiptId) {
  const requested = parsed.receiptLines || lines.map((line) => ({
    invoiceLineIndex: line.lineIndex,
    purchaseLineId: parsed.allocationPlan?.find((allocation) => allocation.invoiceLineIndex === line.lineIndex)?.purchaseLineId || null,
    acceptedQuantity: line.quantity,
    heldQuantity: 0,
    rejectedQuantity: 0,
    notReceivedQuantity: 0,
    outcome: "accepted",
    notes: "",
    serialNumbers: [],
  }));
  const byIndex = new Map(lines.map((line) => [line.lineIndex, line]));
  const outcomes = [];
  const postingLines = [];
  for (const receiptLine of requested) {
    const source = byIndex.get(receiptLine.invoiceLineIndex);
    if (!source) throw publicError("INVENTORY_RECEIPT_LINE_INVALID", `Invoice line ${receiptLine.invoiceLineIndex + 1} is unavailable.`, 409);
    const acceptedQuantity = Number(receiptLine.acceptedQuantity || 0);
    const heldQuantity = Number(receiptLine.heldQuantity || 0);
    const rejectedQuantity = Number(receiptLine.rejectedQuantity || 0);
    const notReceivedQuantity = Number(receiptLine.notReceivedQuantity || 0);
    for (const [field, quantity] of Object.entries({ acceptedQuantity, heldQuantity, rejectedQuantity, notReceivedQuantity })) {
      assertReceiptQuantity(quantity, source, field);
    }
    const actualQuantity = acceptedQuantity + heldQuantity + rejectedQuantity;
    if (receiptLine.outcome !== "over" && actualQuantity + notReceivedQuantity > source.quantity) {
      throw publicError("INVENTORY_INVOICE_QUANTITY_EXCEEDED", `Receipt quantities exceed invoice line ${receiptLine.invoiceLineIndex + 1}.`, 409);
    }
    if (acceptedQuantity > source.quantity) {
      throw publicError("INVENTORY_INVOICE_QUANTITY_EXCEEDED", `Accepted quantity exceeds invoice line ${receiptLine.invoiceLineIndex + 1}.`, 409);
    }
    if (source.trackingMode === "serialized") {
      if (![acceptedQuantity, heldQuantity, rejectedQuantity, notReceivedQuantity].every(Number.isInteger)) {
        throw publicError("INVENTORY_SERIAL_QUANTITY_INVALID", `${source.partNumber} requires whole-unit quantities.`);
      }
      if (receiptLine.serialNumbers.length && receiptLine.serialNumbers.length !== acceptedQuantity + heldQuantity) {
        throw publicError("INVENTORY_SERIAL_QUANTITY_INVALID", `Capture one identity for every accepted or held ${source.partNumber} unit.`);
      }
      if (new Set(receiptLine.serialNumbers.map((value) => value.toLocaleUpperCase("en-US"))).size !== receiptLine.serialNumbers.length) {
        throw publicError("INVENTORY_SERIAL_IDENTITY_DUPLICATE", `Each ${source.partNumber} identity must be different.`);
      }
    } else if (receiptLine.serialNumbers.length) {
      throw publicError("INVENTORY_SERIAL_IDENTITY_NOT_ALLOWED", `${source.partNumber} does not use individual identities.`);
    }
    const physicalLineId = actualQuantity > 0 ? randomUUID() : null;
    const unitCost = source.unitCost;
    const proportionalTotal = source.lineTotal === null ? null : Number((source.lineTotal * (actualQuantity / source.quantity)).toFixed(2));
    if (physicalLineId) {
      postingLines.push({
        ...source,
        id: physicalLineId,
        quantity: actualQuantity,
        acceptedQuantity,
        heldQuantity,
        rejectedQuantity,
        targetPositionId: receiptLine.targetPositionId || null,
        lineTotal: proportionalTotal,
        costSource: unitCost === null && proportionalTotal === null ? "unknown" : "invoice_line",
        serializedUnits: source.trackingMode === "serialized"
          ? Array.from({ length: acceptedQuantity + heldQuantity }, (_, index) => ({
            id: randomUUID(),
            ordinal: index + 1,
            serialNumber: receiptLine.serialNumbers[index]
              || `WG-L-${receiptId.replaceAll("-", "").slice(0, 16).toUpperCase()}-${source.lineIndex + 1}-${index + 1}`,
            conditionCode: "unknown",
            status: index < acceptedQuantity ? "in_stock" : "held",
          }))
          : [],
      });
    }
    outcomes.push({
      invoiceLineIndex: source.lineIndex,
      purchaseLineId: receiptLine.purchaseLineId || null,
      receiptLineId: physicalLineId,
      catalogPartId: source.catalogPartId,
      partNumber: source.partNumber,
      uomCode: source.uomCode,
      expectedQuantity: actualQuantity + notReceivedQuantity,
      actualQuantity,
      usableQuantity: acceptedQuantity,
      heldQuantity,
      rejectedQuantity,
      notReceivedQuantity,
      outcome: receiptLine.outcome,
      notes: receiptLine.notes,
      holdLocation: receiptLine.holdLocation,
    });
  }
  return { postingLines, outcomes };
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
  const postingRoute = validateInvoicePostingRoute({
    draft,
    postingRoute: parsed.postingRoute,
    allocationPlan: parsed.allocationPlan,
    receiptLines: parsed.receiptLines,
    noPurchaseOrderReason: parsed.noPurchaseOrderReason,
  });
  const preparedLines = prepareLocalLines(draft);
  const loadTrackingModes = dependencies.loadTrackingModes
    || (dependencies.postReceipt ? async () => [] : getCatalogTrackingModes);
  const policies = await loadTrackingModes({
    companyIds: scope.companyIds,
    catalogPartIds: [...new Set(preparedLines.map((line) => line.catalogPartId).filter(Boolean))],
  });
  const lines = requireTrackingPolicies(preparedLines, policies);
  const receiptId = randomUUID();
  const episode = prepareReceiptEpisode(lines, parsed, receiptId);
  if (postingRoute === "purchase_order") validateCompleteInvoiceAllocationPlan({
    lines,
    receiptLines: episode.outcomes,
    allocationPlan: parsed.allocationPlan,
  });
  const serializedQuantity = episode.postingLines.reduce((total, line) => total + line.serializedUnits.length, 0);
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
    confirmation: parsed.confirmation || "physically_received",
    postingRoute,
    noPurchaseOrderReason: parsed.noPurchaseOrderReason,
    allocationPlan: parsed.allocationPlan,
    receiptLines: parsed.receiptLines || null,
    lines: episode.postingLines.map(({ id: _id, serializedUnits: _units, ...line }) => line),
    outcomes: episode.outcomes.map(({ receiptLineId: _receiptLineId, ...outcome }) => outcome),
  };
  const labelBatchId = serializedQuantity ? randomUUID() : null;
  const result = await (dependencies.postReceipt || postLocalInventoryReceipt)({
    receiptId,
    runId,
    actorId: requestContext.actor.id,
    ...scope,
    idempotencyKey: parsed.idempotencyKey,
    requestHash: requestHash(hashShape),
    reviewedRunVersion: parsed.expectedVersion,
    physicalConfirmation: parsed.confirmation || "physically_received",
    confirmationHash: requestHash({
      runId,
      reviewedRunVersion: parsed.expectedVersion,
      confirmation: parsed.confirmation || "physically_received",
      actorId: requestContext.actor.id,
    }),
    postingRoute,
    noPurchaseOrderReason: parsed.noPurchaseOrderReason,
    allocationPlan: parsed.allocationPlan,
    labelBatchId,
    lines: episode.postingLines,
    receiptOutcomes: episode.outcomes,
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
  if (result.kind === "purchase_conflict") {
    throw publicError("INVENTORY_PURCHASE_RECEIPT_CONFLICT", "The purchase order changed or no longer has enough outstanding quantity for this invoice allocation.", 409, true);
  }
  if (result.kind === "target_position_invalid") {
    throw publicError("INVENTORY_RECEIPT_POSITION_INVALID", "Receipt target position is not eligible.");
  }
  if (result.kind === "invoice_quantity_conflict") {
    throw publicError("INVENTORY_INVOICE_QUANTITY_CONFLICT", "This invoice line no longer has enough unreceived quantity. Refresh it before receiving.", 409, true);
  }
  if (result.kind === "serial_conflict") {
    throw publicError("INVENTORY_SERIAL_IDENTITY_DUPLICATE", "One of these serialized identities is already recorded in inventory.", 409);
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
  if (result.kind === "catalog_changed") {
    throw publicError("INVENTORY_CATALOG_PART_CHANGED", `A matched inventory part changed or no longer uses the invoice unit. Reopen the review and match it again.`, 409, true);
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
