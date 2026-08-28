import { createHash, randomUUID } from "node:crypto";
import QRCode from "qrcode";
import {
  claimInventoryReceiptCommand,
  confirmInventoryReceipt,
  getInventoryReceipt,
  getSerializedInventoryUnit,
  loadMappedOdooReceiptLocations,
  loadOdooProductMappings,
  loadReviewedInvoiceForReceipt,
  markInventoryReceiptReconciliation,
  stageInventoryReceipt,
} from "../../db/repositories/inventory-receipts.repo.js";
import { readOdooConfiguration } from "../../integrations/odoo/odoo.admin.repo.js";
import { createOdooClient } from "../../integrations/odoo/odoo.client.js";
import { ensureOdooSerializedReceipt, inspectOdooReceipt } from "../../integrations/odoo/odoo.receipts.js";
import { normalizePartNumber } from "../parts/part.constants.js";
import { invoiceDraftSchema } from "../invoice-extraction/invoice-extraction.schemas.js";
import { InventoryError, inventoryNotFound } from "./inventory.errors.js";
import {
  assertInventoryQrConfigured,
  createInventoryQrToken,
  inventoryScanUrl,
  inventoryTokenFromCode,
  readInventoryQrToken,
} from "./inventory-qr.js";
import { receiveInvoiceSchema, resolveInventoryCodeSchema } from "./inventory.schemas.js";

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

function requireLocationScope(row, requestContext) {
  if (!row) throw inventoryNotFound();
  if (requestContext.actor.role !== "admin" && !requestContext.locationIds?.has(row.location_id)) throw inventoryNotFound();
  return row;
}

function integerQuantity(line) {
  const quantity = Number(line.quantity.value);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1000) {
    throw publicError(
      "INVENTORY_SERIAL_QUANTITY_INVALID",
      `Part ${line.partNumber.value || line.description.value || "line"} needs a whole quantity from 1 to 1000 for serial labels.`,
    );
  }
  return quantity;
}

function preparedInvoiceLines(draft, mappings) {
  if (draft.documentType.value !== "invoice") {
    throw publicError("INVENTORY_DOCUMENT_TYPE_INVALID", "Only a reviewed invoice can create a receipt.");
  }
  if (!draft.lines.length) throw publicError("INVENTORY_LINES_REQUIRED", "Add at least one reviewed invoice line before receiving.");
  const byNormalized = new Map();
  for (const mapping of mappings) {
    const list = byNormalized.get(mapping.normalized_part_number) || [];
    list.push(mapping);
    byNormalized.set(mapping.normalized_part_number, list);
  }
  const seenParts = new Set();
  let totalUnits = 0;
  const prepared = draft.lines.map((line, lineIndex) => {
    const partNumber = String(line.partNumber.value || "").trim();
    const normalized = normalizePartNumber(partNumber);
    if (!normalized) throw publicError("INVENTORY_PART_NUMBER_REQUIRED", `Invoice line ${lineIndex + 1} needs a part number.`);
    if (seenParts.has(normalized)) {
      throw publicError("INVENTORY_DUPLICATE_PART_LINE", `Combine duplicate part ${partNumber} into one reviewed invoice line before receiving.`);
    }
    seenParts.add(normalized);
    const candidates = byNormalized.get(normalized) || [];
    if (candidates.length !== 1) {
      throw publicError(
        candidates.length ? "ODOO_PRODUCT_MAPPING_AMBIGUOUS" : "ODOO_PRODUCT_MAPPING_MISSING",
        candidates.length
          ? `Part ${partNumber} maps to more than one active Odoo product.`
          : `Part ${partNumber} must exist in the synced Odoo product catalog before receiving.`,
      );
    }
    const mapping = candidates[0];
    const quantity = integerQuantity(line);
    totalUnits += quantity;
    return {
      lineIndex,
      catalogPartId: mapping.catalog_part_id,
      productExternalId: String(mapping.product_external_id),
      partNumber,
      description: String(line.description.value || mapping.description || mapping.display_name || "").trim(),
      quantity,
      uomCode: String(mapping.uom_code || line.unitOfMeasure.value || "ea").trim().toLowerCase(),
    };
  });
  if (totalUnits > 500) {
    throw publicError(
      "INVENTORY_RECEIPT_UNIT_LIMIT",
      "Receive no more than 500 serialized units in one invoice. Split larger deliveries into separate reviewed receipts.",
    );
  }
  return prepared;
}

function receiptSerial(receiptId, lineIndex, ordinal) {
  const identity = receiptId.replaceAll("-", "").slice(0, 16).toUpperCase();
  return `WG-${identity}-${lineIndex + 1}-${ordinal}`;
}

function hashRequest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function withInventoryLabels(receipt, qrOptions = {}) {
  return {
    ...receipt,
    units: (receipt.units || []).map((unit) => {
      const token = createInventoryQrToken(unit.id, qrOptions);
      return {
        ...unit,
        scanToken: token,
        scanUrl: inventoryScanUrl(token, qrOptions.origin),
        qrSvgUrl: `/api/office/inventory/units/${encodeURIComponent(unit.id)}/qr.svg`,
      };
    }),
  };
}

function providerContextFromReceipt(receipt, inspection) {
  const lineById = new Map(receipt.lines.map((line) => [line.id, line]));
  return {
    ...inspection,
    products: inspection.products.map((product) => {
      const line = receipt.lines.find((candidate) => candidate.lineIndex === product.lineIndex);
      const serials = receipt.units
        .filter((unit) => lineById.get(unit.receiptLineId)?.lineIndex === product.lineIndex)
        .map((unit) => unit.serialNumber);
      return { ...product, serials };
    }),
  };
}

export async function receiveReviewedInvoice(runId, input, requestContext, dependencies = {}) {
  const parsed = receiveInvoiceSchema.parse(input);
  assertInventoryQrConfigured(dependencies.qrOptions);
  const scope = actorScope(requestContext);
  const source = requireLocationScope(await (dependencies.loadInvoice || loadReviewedInvoiceForReceipt)({
    runId,
    companyIds: scope.companyIds,
  }), requestContext);
  if (source.status !== "reviewed" || !source.reviewed_draft) {
    throw publicError("INVOICE_REVIEW_REQUIRED", "Review and approve the invoice draft before receiving parts.", 409);
  }
  const draft = invoiceDraftSchema.parse(source.reviewed_draft);
  const normalizedPartNumbers = [...new Set(draft.lines.map((line) => normalizePartNumber(line.partNumber.value)).filter(Boolean))];
  const mappings = await (dependencies.loadMappings || loadOdooProductMappings)({
    companyId: source.company_id,
    normalizedPartNumbers,
  });
  const lines = preparedInvoiceLines(draft, mappings);
  const locationExternalIds = await (dependencies.loadLocations || loadMappedOdooReceiptLocations)({
    companyId: source.company_id,
    locationId: source.location_id,
  });
  if (!locationExternalIds.length) throw publicError("ODOO_RECEIPT_ROUTE_UNMAPPED", "Map this shop to an Odoo receipt location before receiving.");
  const configuration = await (dependencies.readConfiguration || readOdooConfiguration)(source.company_id);
  if (!configuration) throw publicError("ODOO_CONNECTION_MISSING", "Configure Odoo before receiving invoice parts.", 409);
  const client = (dependencies.createClient || createOdooClient)(configuration);
  const inspection = await (dependencies.inspectProvider || inspectOdooReceipt)(client, { locationExternalIds, lines });
  const providerRoute = {
    pickingTypeId: inspection.pickingTypeId,
    sourceLocationId: inspection.sourceLocationId,
    destinationLocationId: inspection.destinationLocationId,
  };
  const receiptId = randomUUID();
  const marker = `WG-REC-${receiptId}`;
  const stagedLines = lines.map((line) => ({ ...line, id: randomUUID() }));
  const units = stagedLines.flatMap((line) => Array.from({ length: line.quantity }, (_, index) => ({
    id: randomUUID(),
    receiptLineId: line.id,
    ordinal: index + 1,
    serialNumber: receiptSerial(receiptId, line.lineIndex, index + 1),
  })));
  const requestShape = {
    invoiceRunId: runId,
    locationId: source.location_id,
    providerRoute,
    lines: inspection.products.map(({ lineIndex, productExternalId, quantity, uomExternalId }) => ({
      lineIndex,
      productExternalId,
      quantity,
      uomExternalId,
    })),
  };
  const staged = await (dependencies.stageReceipt || stageInventoryReceipt)({
    receiptId,
    companyId: source.company_id,
    locationId: source.location_id,
    invoiceRunId: runId,
    actorId: requestContext.actor.id,
    idempotencyKey: parsed.idempotencyKey,
    marker,
    lines: stagedLines,
    units,
    requestHash: hashRequest(requestShape),
    providerRoute,
  });
  if (staged.conflict) {
    throw publicError(
      "INVENTORY_RECEIPT_REPLAY_CONFLICT",
      "This invoice receipt was already staged with a different product, quantity, or location. Reconcile it before retrying.",
      409,
    );
  }
  if (staged.receipt.status === "confirmed") return { receipt: withInventoryLabels(staged.receipt, dependencies.qrOptions), replayed: true };
  const persistedLines = staged.receipt.lines.map((line) => ({
    lineIndex: line.lineIndex,
    catalogPartId: line.catalogPartId,
    productExternalId: line.productExternalId,
    partNumber: line.partNumber,
    description: line.description,
    quantity: Number(line.quantity),
    uomCode: line.uomCode,
  }));
  const persistedProductByLine = new Map(inspection.products.map((product) => [product.lineIndex, product]));
  const persistedInspection = {
    ...staged.providerRoute,
    products: persistedLines.map((line) => ({ ...line, ...persistedProductByLine.get(line.lineIndex) })),
  };
  const claimed = await (dependencies.claimCommand || claimInventoryReceiptCommand)({
    receiptId: staged.receipt.id,
    companyId: source.company_id,
  });
  if (!claimed) throw publicError("INVENTORY_RECEIPT_BUSY", "This receipt is already processing. Open it again in a moment.", 409, true);
  let confirmed;
  try {
    const result = await (dependencies.ensureProviderReceipt || ensureOdooSerializedReceipt)(client, {
      marker: staged.receipt.id === receiptId ? marker : `WG-REC-${staged.receipt.id}`,
      context: providerContextFromReceipt(staged.receipt, persistedInspection),
    });
    confirmed = await (dependencies.confirmReceipt || confirmInventoryReceipt)({
      receiptId: staged.receipt.id,
      companyId: source.company_id,
      actorId: requestContext.actor.id,
      providerResult: result,
    });
  } catch (error) {
    await (dependencies.markReconciliation || markInventoryReceiptReconciliation)({
      receiptId: staged.receipt.id,
      companyId: source.company_id,
      actorId: requestContext.actor.id,
      errorCode: error?.code || "ODOO_RECEIPT_UNKNOWN",
    });
    if (error instanceof InventoryError) throw error;
    throw publicError("ODOO_RECEIPT_RECONCILIATION_REQUIRED", "Odoo receipt status is uncertain. Reconcile it before retrying.", 502, true);
  }
  return { receipt: withInventoryLabels(confirmed, dependencies.qrOptions), replayed: !staged.inserted };
}

export async function readInventoryReceiptLabels(receiptId, requestContext, dependencies = {}) {
  const receipt = await (dependencies.getReceipt || getInventoryReceipt)({ receiptId, ...actorScope(requestContext) });
  if (!receipt) throw inventoryNotFound();
  if (receipt.status !== "confirmed") throw publicError("INVENTORY_RECEIPT_NOT_CONFIRMED", "Labels are available only after the receipt is confirmed.", 409);
  return { receipt: withInventoryLabels(receipt, dependencies.qrOptions) };
}

export async function renderInventoryUnitQr(unitId, requestContext, dependencies = {}) {
  const unit = await (dependencies.getUnit || getSerializedInventoryUnit)({ unitId, ...actorScope(requestContext) });
  if (!unit) throw inventoryNotFound();
  const token = createInventoryQrToken(unit.id, dependencies.qrOptions);
  const scanUrl = inventoryScanUrl(token, dependencies.qrOptions?.origin);
  return QRCode.toString(scanUrl, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 2,
    width: 256,
  });
}

export async function resolveInventoryCode(input, requestContext, dependencies = {}) {
  const parsed = resolveInventoryCodeSchema.parse(input);
  const token = inventoryTokenFromCode(parsed.code);
  const unitId = readInventoryQrToken(token, dependencies.qrOptions);
  if (!unitId) throw inventoryNotFound();
  const unit = await (dependencies.getUnit || getSerializedInventoryUnit)({ unitId, ...actorScope(requestContext) });
  if (!unit) throw inventoryNotFound();
  return { unit };
}
