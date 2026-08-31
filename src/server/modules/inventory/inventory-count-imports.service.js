import { randomUUID } from "node:crypto";
import { searchCompanyCatalogParts } from "../../db/repositories/parts-catalog.repo.js";
import {
  applyInventoryCountImport,
  auditInventoryCountFileDownload,
  createInventoryCountImport,
  findAuthorizedInventoryLocation,
  getInventoryCountImport,
  getInventoryCountImportFile,
  listInventoryCountImports,
  resolveInventoryCountImportLine,
} from "../../db/repositories/inventory-count-imports.repo.js";
import { normalizePartNumber } from "../parts/part.constants.js";
import { InventoryError, inventoryNotFound } from "./inventory.errors.js";
import {
  assertClientRowsMatchWorkbook,
  decodeInventoryCountBase64,
  decryptInventoryCountFile,
  encryptInventoryCountFile,
  inventoryCountSourceHash,
  parseInventoryCountWorkbook,
} from "./inventory-count-file.js";
import { assertInventoryQrConfigured } from "./inventory-qr.js";
import {
  applyInventoryCountImportSchema,
  createInventoryCountImportSchema,
  inventoryCatalogSearchSchema,
  inventoryCountImportListSchema,
  resolveInventoryCountLineSchema,
} from "./inventory.schemas.js";

function scopeFor(requestContext) {
  return {
    companyIds: [...(requestContext.companyIds || [])],
    locationIds: [...(requestContext.locationIds || [])],
    isAdmin: requestContext.actor.role === "admin",
  };
}

function inputError(code, message, statusCode = 422) {
  return new InventoryError(message, { code, statusCode });
}

function countQuantity(value) {
  if (typeof value === "number") return Number.isInteger(value) && value >= 1 && value <= 500 ? value : null;
  const text = String(value ?? "").trim();
  if (!/^\d+$/.test(text)) return null;
  const parsed = Number(text);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 500 ? parsed : null;
}

function optionalCost(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 99_999_999 ? parsed : null;
}

function prepareRows(rows) {
  const seenSourceRows = new Set();
  return rows.map((row) => {
    if (seenSourceRows.has(row.sourceRow)) {
      throw inputError("INVENTORY_COUNT_SOURCE_ROW_DUPLICATE", `Spreadsheet row ${row.sourceRow} was uploaded more than once.`);
    }
    seenSourceRows.add(row.sourceRow);
    const normalizedPartNumber = normalizePartNumber(row.partNumber);
    if (!normalizedPartNumber) {
      throw inputError("INVENTORY_COUNT_PART_NUMBER_REQUIRED", `Spreadsheet row ${row.sourceRow} needs a part number.`);
    }
    return {
      sourceRow: row.sourceRow,
      partNumber: row.partNumber,
      normalizedPartNumber,
      partName: row.partName,
      description: row.description,
      binLocation: row.binLocation,
      quantityText: String(row.quantity ?? "").trim(),
      quantity: countQuantity(row.quantity),
      averageCost: optionalCost(row.averageCost),
    };
  });
}

function sourceRetentionUntil(now = Date.now()) {
  const configured = Number.parseInt(process.env.INVENTORY_COUNT_FILE_RETENTION_DAYS || process.env.INVOICE_DOCUMENT_RETENTION_DAYS || "365", 10);
  const days = Number.isSafeInteger(configured) ? Math.min(3650, Math.max(1, configured)) : 365;
  return new Date(now + days * 86_400_000).toISOString();
}

export async function uploadInventoryCount(input, requestContext, dependencies = {}) {
  const parsed = createInventoryCountImportSchema.parse(input);
  const scope = scopeFor(requestContext);
  const sourceFileBytes = decodeInventoryCountBase64(parsed.sourceFileBase64);
  if (sourceFileBytes.length !== parsed.sourceSizeBytes) {
    throw inputError("INVENTORY_COUNT_FILE_SIZE_MISMATCH", "Uploaded inventory file is incomplete.", 400);
  }
  const sourceSha256 = inventoryCountSourceHash(sourceFileBytes);
  if (sourceSha256 !== parsed.sourceSha256) {
    throw inputError("INVENTORY_COUNT_FILE_HASH_MISMATCH", "Uploaded inventory file hash does not match its contents.", 400);
  }
  const workbookRows = await (dependencies.parseWorkbook || parseInventoryCountWorkbook)(sourceFileBytes);
  assertClientRowsMatchWorkbook(parsed.rows, workbookRows);
  const rows = prepareRows(workbookRows);
  const location = await (dependencies.findLocation || findAuthorizedInventoryLocation)({
    locationId: parsed.locationId,
    ...scope,
  });
  if (!location) throw inventoryNotFound();
  const importId = randomUUID();
  const encryptedSource = (dependencies.encryptFile || encryptInventoryCountFile)(sourceFileBytes, {
    companyId: location.company_id,
    importId,
    sourceSha256,
    contentType: parsed.sourceContentType,
    sizeBytes: sourceFileBytes.length,
  }, dependencies.encryptionOptions);
  const result = await (dependencies.createImport || createInventoryCountImport)({
    importId,
    ...scope,
    actorId: requestContext.actor.id,
    locationId: parsed.locationId,
    sourceFileName: parsed.sourceFileName,
    sourceContentType: parsed.sourceContentType,
    sourceSizeBytes: sourceFileBytes.length,
    sourceSha256,
    sourceRetentionUntil: sourceRetentionUntil(),
    encryptedSource,
    rows,
  });
  if (result.kind === "not_found") throw inventoryNotFound();
  if (result.kind === "quota_exceeded") {
    throw inputError("INVENTORY_COUNT_STORAGE_QUOTA_EXCEEDED", "Inventory workbook storage quota reached. Wait for retention cleanup or contact an administrator.", 413);
  }
  return { import: result.import, replayed: result.kind === "replay" };
}

export async function downloadInventoryCountFile(importId, requestContext, dependencies = {}) {
  const source = await (dependencies.getImportFile || getInventoryCountImportFile)({
    importId,
    actorId: requestContext.actor.id,
    ...scopeFor(requestContext),
  });
  if (!source) throw inventoryNotFound();
  const bytes = (dependencies.decryptFile || decryptInventoryCountFile)(source, dependencies.encryptionOptions);
  await (dependencies.auditDownload || auditInventoryCountFileDownload)({
    companyId: source.company_id,
    importId: source.id,
    actorId: requestContext.actor.id,
  });
  return {
    fileName: source.source_file_name,
    contentType: source.source_content_type,
    sizeBytes: Number(source.source_size_bytes),
    bytes,
  };
}

export async function readInventoryCount(importId, requestContext, dependencies = {}) {
  const value = await (dependencies.getImport || getInventoryCountImport)({
    importId,
    ...scopeFor(requestContext),
  });
  if (!value) throw inventoryNotFound();
  return { import: value };
}

export async function readInventoryCounts(searchParams, requestContext, dependencies = {}) {
  const parsed = inventoryCountImportListSchema.parse(Object.fromEntries(searchParams));
  const result = await (dependencies.listImports || listInventoryCountImports)({
    ...scopeFor(requestContext),
    limit: parsed.pageSize,
    offset: (parsed.page - 1) * parsed.pageSize,
  });
  const total = Number(result.total || 0);
  return {
    imports: result.imports,
    page: parsed.page,
    pageSize: parsed.pageSize,
    pageCount: Math.max(1, Math.ceil(total / parsed.pageSize)),
    total,
  };
}

export async function resolveInventoryCountLine(importId, lineId, input, requestContext, dependencies = {}) {
  const parsed = resolveInventoryCountLineSchema.parse(input);
  const result = await (dependencies.resolveLine || resolveInventoryCountImportLine)({
    importId,
    lineId,
    actorId: requestContext.actor.id,
    ...scopeFor(requestContext),
    ...parsed,
  });
  if (result.kind === "not_found" || result.kind === "catalog_not_found") throw inventoryNotFound();
  if (result.kind === "stale") throw inputError("INVENTORY_COUNT_STALE", "This inventory draft changed. Refresh it before continuing.", 409);
  if (result.kind === "duplicate") {
    throw inputError("INVENTORY_COUNT_PART_DUPLICATE", "That master part is already used by another row in this count.", 409);
  }
  return { import: result.import };
}

export async function confirmInventoryCount(importId, input, requestContext, dependencies = {}) {
  const parsed = applyInventoryCountImportSchema.parse(input);
  if (requestContext.actor.role !== "admin") {
    throw inputError("INVENTORY_COUNT_APPLY_FORBIDDEN", "Only administrators can apply opening inventory counts.", 403);
  }
  assertInventoryQrConfigured(dependencies.qrOptions);
  const result = await (dependencies.applyImport || applyInventoryCountImport)({
    importId,
    ...scopeFor(requestContext),
    actorId: requestContext.actor.id,
    expectedVersion: parsed.expectedVersion,
  });
  if (result.kind === "not_found") throw inventoryNotFound();
  if (result.kind === "stale") throw inputError("INVENTORY_COUNT_STALE", "This inventory draft changed. Refresh it before applying.", 409);
  if (result.kind === "stock_conflict") {
    throw inputError(
      "INVENTORY_COUNT_STOCK_CONFLICT",
      `Spreadsheet row ${result.sourceRow} already has local or reserved stock. Use a cycle-count adjustment instead.`,
      409,
    );
  }
  if (result.kind === "authority_conflict") {
    throw inputError(
      "INVENTORY_COUNT_AUTHORITY_CONFLICT",
      `Spreadsheet row ${result.sourceRow} has an active legacy reservation. Release it before applying the opening count.`,
      409,
    );
  }
  if (result.kind === "authority_unmatched") {
    throw inputError(
      "INVENTORY_COUNT_AUTHORITY_IDENTITY_UNMATCHED",
      `Spreadsheet row ${result.sourceRow} conflicts with a legacy inventory identity or unit. Reconcile it before applying the opening count.`,
      409,
    );
  }
  return { import: result.import, replayed: result.kind === "replay" };
}

export async function searchInventoryMasterParts(searchParams, requestContext, dependencies = {}) {
  const parsed = inventoryCatalogSearchSchema.parse(Object.fromEntries(searchParams));
  const scope = scopeFor(requestContext);
  const location = await (dependencies.findLocation || findAuthorizedInventoryLocation)({
    locationId: parsed.locationId,
    ...scope,
  });
  if (!location) throw inventoryNotFound();
  return (dependencies.searchCatalog || searchCompanyCatalogParts)(location.company_id, {
    text: parsed.q,
    locationId: parsed.locationId,
    limit: parsed.limit,
    purpose: "master_match",
  });
}

export const inventoryCountInternals = { countQuantity, optionalCost, prepareRows, sourceRetentionUntil };
