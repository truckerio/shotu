import { z } from "zod";

export const receiveInvoiceSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(120),
}).strict();

export const postLocalInvoiceSchema = receiveInvoiceSchema;

export const confirmLocalReceiptSchema = z.object({
  expectedVersion: z.number().int().min(1),
  idempotencyKey: z.string().trim().min(8).max(120),
  confirmation: z.literal("all_received_undamaged"),
}).strict();

export const invoiceHistoryQuerySchema = z.object({
  q: z.string().trim().max(200).optional().default(""),
  status: z.enum(["", "processing", "needs_review", "reviewed", "added", "reversed", "failed"]).optional().default(""),
  page: z.coerce.number().int().min(1).max(100_000).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
}).strict();

export const inventoryStockQuerySchema = z.object({
  q: z.string().trim().max(200).optional().default(""),
  locationId: z.string().uuid().optional(),
  scope: z.enum(["all", "master"]).optional().default("all"),
  availability: z.enum(["all", "available", "reserved", "out"]).optional().default("all"),
  sort: z.enum(["available_desc", "part_asc", "reserved_desc", "locations_desc"]).optional().default("available_desc"),
  page: z.coerce.number().int().min(1).max(100_000).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
}).strict();

export const updateInventoryPartSchema = z.object({
  expectedVersion: z.number().int().min(1),
  description: z.string().trim().min(1).max(1000),
  partNumber: z.string().trim().min(1).max(200).regex(/[A-Za-z0-9]/, "Part number must contain a letter or number."),
  manufacturer: z.string().trim().max(240),
  category: z.string().trim().max(240),
  barcode: z.string().trim().max(200),
  referenceNumbers: z.array(z.string().trim().min(1).max(200).regex(/[A-Za-z0-9]/, "Reference number must contain a letter or number.")).max(20),
}).strict().superRefine((value, context) => {
  const normalized = value.referenceNumbers.map((item) => item.toUpperCase().replace(/[^A-Z0-9]/g, ""));
  if (new Set(normalized).size !== normalized.length) context.addIssue({ code: "custom", path: ["referenceNumbers"], message: "Reference numbers must be unique." });
});

export const inventoryLabelItemsQuerySchema = z.object({
  after: z.coerce.number().int().min(0).max(500).optional().default(0),
  limit: z.coerce.number().int().min(1).max(100).optional().default(100),
}).strict();

export const createPartSerializedUnitsSchema = z.object({
  quantity: z.number().int().min(1).max(500),
  idempotencyKey: z.string().trim().min(8).max(120),
  confirmation: z.literal("physically_present_at_location"),
}).strict();

export const resolveInventoryCodeSchema = z.object({
  code: z.string().trim().min(8).max(2000),
}).strict();

const inventoryCountSourceRowSchema = z.object({
  sourceRow: z.number().int().min(1).max(10000),
  partNumber: z.string().trim().min(1).max(240),
  partName: z.string().trim().max(500).optional().default(""),
  description: z.string().trim().max(1000).optional().default(""),
  binLocation: z.string().trim().max(120).optional().default(""),
  quantity: z.union([z.number(), z.string().trim().max(120), z.null()]).optional().default(null),
  averageCost: z.union([z.number(), z.string().trim().max(80), z.null()]).optional().default(null),
}).strict();

export const createInventoryCountImportSchema = z.object({
  locationId: z.string().uuid(),
  sourceFileName: z.string().trim().min(1).max(240),
  sourceContentType: z.literal("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
  sourceSizeBytes: z.number().int().min(1).max(2_000_000),
  sourceFileBase64: z.string().min(4).max(2_666_668).regex(/^[A-Za-z0-9+/]+={0,2}$/),
  sourceSha256: z.string().regex(/^[0-9a-f]{64}$/),
  rows: z.array(inventoryCountSourceRowSchema).min(1).max(500),
}).strict();

export const inventoryCountImportListSchema = z.object({
  page: z.coerce.number().int().min(1).max(100_000).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(50).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
}).strict().transform((value) => ({ page: value.page, pageSize: value.pageSize || value.limit || 20 }));

export const resolveInventoryCountLineSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("ignore"),
    expectedVersion: z.number().int().min(1),
  }).strict(),
  z.object({
    action: z.literal("match"),
    expectedVersion: z.number().int().min(1),
    catalogPartId: z.string().uuid(),
    quantity: z.number().int().min(1).max(500),
    binLocation: z.string().trim().max(120).optional().default(""),
  }).strict(),
]);

export const applyInventoryCountImportSchema = z.object({
  expectedVersion: z.number().int().min(1),
  confirmation: z.literal("physically_counted"),
}).strict();

export const inventoryCatalogSearchSchema = z.object({
  q: z.string().trim().min(2).max(200),
  locationId: z.string().uuid(),
  limit: z.coerce.number().int().min(1).max(12).optional().default(8),
}).strict();
