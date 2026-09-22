import { z } from "zod";
import { DATABASE_UUID_PATTERN } from "../../db/company.js";
import { uomCodeSchema, validateQuantityUnit } from "../parts/quantity-uom.js";
import { isSupportedInventoryCurrency } from "./inventory-pricing.js";

export const inventoryTrackingModeSchema = z.enum(["quantity", "serialized", "measured_bulk"]);

export const inventoryPartCommercialQuerySchema = z.object({
  locationId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
}).strict();

const inventoryPriceAmountSchema = z.string().trim().regex(/^\d{1,10}(?:\.\d{1,4})?$/, "Enter a non-negative price with up to four decimal places.");
const inventoryCurrencySchema = z.string().trim().toUpperCase().length(3).refine(isSupportedInventoryCurrency, "Select a supported ISO currency.");
export const inventoryTaxTreatmentSchema = z.enum(["legacy_unknown", "not_configured", "exclusive", "inclusive", "zero_rated", "exempt", "out_of_scope"]);
const assignableTaxTreatmentSchema = inventoryTaxTreatmentSchema.exclude(["legacy_unknown"]);
const taxProfileVersionIdSchema = z.string().uuid().nullable();

function validatePriceTaxShape(value, context) {
  if ((value.amount === null) !== (value.currency === null)) context.addIssue({ code: "custom", path: ["currency"], message: "Currency is required for a known price and omitted for Unknown." });
  if (value.amount === null && value.taxTreatment !== undefined && value.taxTreatment !== "not_configured") context.addIssue({ code: "custom", path: ["taxTreatment"], message: "An Unknown price must use Not configured tax treatment." });
  if (["exclusive", "inclusive"].includes(value.taxTreatment) && !value.taxProfileVersionId) context.addIssue({ code: "custom", path: ["taxProfileVersionId"], message: "Select a tax profile for this treatment." });
  if (value.taxTreatment !== undefined && !["exclusive", "inclusive"].includes(value.taxTreatment) && value.taxProfileVersionId) context.addIssue({ code: "custom", path: ["taxProfileVersionId"], message: "This tax treatment does not use a tax profile." });
}

export const updateInventoryPartPriceSchema = z.object({
  expectedVersion: z.number().int().min(0),
  amount: inventoryPriceAmountSchema.nullable(),
  currency: inventoryCurrencySchema.nullable(),
  taxTreatment: assignableTaxTreatmentSchema.optional(),
  taxProfileVersionId: taxProfileVersionIdSchema.optional(),
  reason: z.string().trim().min(2).max(500),
  idempotencyKey: z.string().trim().min(8).max(120),
}).strict().superRefine(validatePriceTaxShape);

const inventoryTaxRateSchema = z.string().trim()
  .regex(/^(?:0|[1-9]\d?|100)(?:\.\d{1,4})?$/, "Enter a rate from 0 to 100 with up to four decimal places.")
  .refine((value) => !value.startsWith("100.") || /^100\.0{1,4}$/.test(value), "Rate cannot exceed 100.");
const inventoryTaxComponentSchema = z.object({
  name: z.string().trim().min(2).max(80),
  rate: inventoryTaxRateSchema,
  compound: z.boolean(),
}).strict();

const inventoryTaxProfileShape = {
  name: z.string().trim().min(2).max(120),
  currency: inventoryCurrencySchema,
  jurisdiction: z.string().trim().min(2).max(160),
  components: z.array(inventoryTaxComponentSchema).min(1).max(5),
  reason: z.string().trim().min(2).max(500),
  idempotencyKey: z.string().trim().min(8).max(120),
};

const inventoryCompanyIdSchema = z.string().regex(DATABASE_UUID_PATTERN, "Invalid company ID");

export const inventoryTaxProfileQuerySchema = z.object({
  companyId: inventoryCompanyIdSchema,
  includeArchived: z.enum(["true", "false"]).optional().default("false").transform((value) => value === "true"),
}).strict();

export const createInventoryTaxProfileSchema = z.object({
  companyId: inventoryCompanyIdSchema,
  ...inventoryTaxProfileShape,
}).strict();

export const reviseInventoryTaxProfileSchema = z.object({
  expectedVersion: z.number().int().min(1),
  ...inventoryTaxProfileShape,
}).strict();

export const archiveInventoryTaxProfileSchema = z.object({
  expectedVersion: z.number().int().min(1),
  archived: z.boolean(),
  reason: z.string().trim().min(2).max(500),
  idempotencyKey: z.string().trim().min(8).max(120),
}).strict();

const pricingDraftSchema = z.object({
  amount: inventoryPriceAmountSchema.nullable(),
  currency: inventoryCurrencySchema.nullable(),
  taxTreatment: assignableTaxTreatmentSchema,
  taxProfileVersionId: taxProfileVersionIdSchema,
}).strict().superRefine(validatePriceTaxShape);

export const inventoryPricingPreviewSchema = z.object({
  priceKind: z.enum(["internal", "selling"]),
  quantity: z.string().trim().regex(/^\d{1,6}(?:\.\d{1,3})?$/, "Enter a positive quantity up to 999999.999 with at most three decimal places.").refine((value) => !/^0+(?:\.0+)?$/.test(value), "Quantity must be greater than zero."),
  discountPercent: inventoryTaxRateSchema.optional().default("0"),
  draft: pricingDraftSchema.optional(),
}).strict();

export const updateInventoryStockRuleSchema = z.object({
  locationId: z.string().uuid(),
  expectedVersion: z.number().int().min(1).nullable().optional().default(null),
  minimumAvailable: z.number().min(0).max(999999999),
  targetQuantity: z.number().min(0).max(999999999).nullable().optional().default(null),
  alertEnabled: z.boolean().optional().default(true),
}).strict().superRefine((value, context) => {
  if (value.targetQuantity !== null && value.targetQuantity < value.minimumAvailable) context.addIssue({ code: "custom", path: ["targetQuantity"], message: "Target quantity must be at least the minimum." });
});

export const receiveInvoiceSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(120),
}).strict();

export const postLocalInvoiceSchema = receiveInvoiceSchema;

const partialReceiptLineSchema = z.object({
  invoiceLineIndex: z.number().int().min(0),
  purchaseLineId: z.string().uuid().optional(),
  targetPositionId: z.string().uuid().optional(),
  acceptedQuantity: z.number().min(0).max(999999.999).default(0),
  heldQuantity: z.number().min(0).max(999999.999).default(0),
  rejectedQuantity: z.number().min(0).max(999999.999).default(0),
  notReceivedQuantity: z.number().min(0).max(999999.999).default(0),
  outcome: z.enum(["accepted", "damaged", "wrong", "short", "over"]),
  notes: z.string().trim().max(500).default(""),
  holdLocation: z.string().trim().max(240).default(""),
  serialNumbers: z.array(z.string().trim().min(1).max(100)).max(500).default([]),
}).strict().superRefine((value, context) => {
  if (value.targetPositionId && value.acceptedQuantity <= 0) {
    context.addIssue({ code: "custom", path: ["targetPositionId"], message: "Choose a destination only for accepted stock." });
  }
  const physical = value.acceptedQuantity + value.heldQuantity + value.rejectedQuantity;
  if (physical <= 0 && value.notReceivedQuantity <= 0) {
    context.addIssue({ code: "custom", path: ["acceptedQuantity"], message: "Record a received or not received quantity." });
  }
  if (value.outcome === "accepted" && (value.heldQuantity > 0 || value.rejectedQuantity > 0 || value.notReceivedQuantity > 0)) {
    context.addIssue({ code: "custom", path: ["outcome"], message: "Choose the exception that explains the non-accepted quantity." });
  }
  if (["damaged", "wrong"].includes(value.outcome) && value.heldQuantity + value.rejectedQuantity <= 0) {
    context.addIssue({ code: "custom", path: ["heldQuantity"], message: "Record the held or rejected quantity for this exception." });
  }
  if (value.outcome === "wrong" && value.acceptedQuantity > 0) {
    context.addIssue({ code: "custom", path: ["acceptedQuantity"], message: "A wrong item cannot be accepted as the ordered part." });
  }
  if (value.outcome === "short" && value.notReceivedQuantity <= 0) {
    context.addIssue({ code: "custom", path: ["notReceivedQuantity"], message: "Record the quantity that did not arrive." });
  }
  if (value.outcome === "short" && (value.heldQuantity > 0 || value.rejectedQuantity > 0)) {
    context.addIssue({ code: "custom", path: ["outcome"], message: "Record damaged, wrong or rejected items separately from a shortage." });
  }
}).superRefine((value, context) => {
  if (value.outcome !== "accepted" && !value.notes) {
    context.addIssue({ code: "custom", path: ["notes"], message: "Record a short exception note." });
  }
});

export const confirmLocalReceiptSchema = z.object({
  expectedVersion: z.number().int().min(1),
  idempotencyKey: z.string().trim().min(8).max(120),
  confirmation: z.literal("all_received_undamaged").optional(),
  postingRoute: z.enum(["purchase_order", "no_purchase_order"]).optional(),
  noPurchaseOrderReason: z.string().trim().max(500).optional().default(""),
  allocationPlan: z.array(z.object({
    invoiceLineIndex: z.number().int().min(0),
    purchaseLineId: z.string().uuid(),
    quantity: z.number().positive().max(999999.999),
  }).strict()).max(500).optional().default([]),
  receiptLines: z.array(partialReceiptLineSchema).min(1).max(500).optional(),
}).strict().superRefine((value, context) => {
  if (!value.confirmation && !value.receiptLines) {
    context.addIssue({ code: "custom", path: ["receiptLines"], message: "Record the quantities that physically arrived." });
  }
  if (value.confirmation && value.receiptLines) {
    context.addIssue({ code: "custom", path: ["receiptLines"], message: "Use either complete-delivery confirmation or line receipt details." });
  }
  if (value.receiptLines) {
    const indexes = value.receiptLines.map((line) => line.invoiceLineIndex);
    if (new Set(indexes).size !== indexes.length) {
      context.addIssue({ code: "custom", path: ["receiptLines"], message: "Each invoice line can appear only once in a receipt." });
    }
  }
});

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
  sort: z.enum(["available_desc", "low_stock_first", "part_asc", "reserved_desc", "locations_desc"]).optional().default("available_desc"),
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
  uomCode: uomCodeSchema.removeDefault(),
  trackingMode: inventoryTrackingModeSchema.optional(),
  referenceNumbers: z.array(z.string().trim().min(1).max(200).regex(/[A-Za-z0-9]/, "Reference number must contain a letter or number.")).max(20),
}).strict().superRefine((value, context) => {
  const normalized = value.referenceNumbers.map((item) => item.toUpperCase().replace(/[^A-Z0-9]/g, ""));
  if (new Set(normalized).size !== normalized.length) context.addIssue({ code: "custom", path: ["referenceNumbers"], message: "Reference numbers must be unique." });
});

export const createInventoryPartSchema = z.object({
  locationId: z.string().uuid(),
  description: z.string().trim().min(1).max(1000),
  partNumber: z.string().trim().min(1).max(200).regex(/[A-Za-z0-9]/, "Part number must contain a letter or number."),
  manufacturer: z.string().trim().max(240).optional().default(""),
  category: z.string().trim().max(240).optional().default(""),
  barcode: z.string().trim().max(200).optional().default(""),
  uomCode: uomCodeSchema.removeDefault(),
  trackingMode: inventoryTrackingModeSchema.optional().default("quantity"),
  referenceNumbers: z.array(z.string().trim().min(1).max(200).regex(/[A-Za-z0-9]/, "Reference number must contain a letter or number.")).max(20).optional().default([]),
}).strict().superRefine((value, context) => {
  const identities = [value.partNumber, ...value.referenceNumbers].map((item) => item.toUpperCase().replace(/[^A-Z0-9]/g, ""));
  if (new Set(identities).size !== identities.length) context.addIssue({ code: "custom", path: ["referenceNumbers"], message: "Part and reference numbers must be unique." });
});

export const inventoryLabelItemsQuerySchema = z.object({
  after: z.coerce.number().int().min(0).max(500).optional().default(0),
  limit: z.coerce.number().int().min(1).max(100).optional().default(100),
}).strict();

export const createPartSerializedUnitsSchema = z.object({
  quantity: z.number().int().min(1).max(500),
  idempotencyKey: z.string().trim().min(8).max(120),
  confirmation: z.literal("physically_present_at_location"),
  conditionCode: z.enum(["new", "serviceable_used", "refurbished", "unknown"]).optional().default("unknown"),
  conditionEvidence: z.string().trim().max(2000).optional().default(""),
  binLocation: z.string().trim().max(200).optional().default(""),
}).strict().superRefine((value, context) => {
  if (value.conditionCode !== "unknown" && !value.conditionEvidence) context.addIssue({ code: "custom", path: ["conditionEvidence"], message: "Condition evidence is required when asserting a condition." });
});

export const createAggregateStockIntakeSchema = z.object({
  quantity: z.number().positive().max(999999.999),
  uomCode: uomCodeSchema.removeDefault(),
  trackingMode: z.enum(["quantity", "measured_bulk"]),
  confirmation: z.literal("physically_present_at_location"),
  idempotencyKey: z.string().trim().min(8).max(120),
}).strict().superRefine((value, context) => validateQuantityUnit(value, context));

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
    quantity: z.number().positive().max(500).refine((value) => Number(value.toFixed(3)) === value, "Use no more than three decimal places."),
    binLocation: z.string().trim().max(120).optional().default(""),
    targetPositionId: z.string().uuid(),
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
  purpose: z.literal("master_match").optional(),
}).strict();

export const inventoryAuthorityExceptionListSchema = z.object({
  page: z.coerce.number().int().min(1).max(100_000).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
}).strict();

export const acknowledgeInventoryAuthorityExceptionSchema = z.object({
  action: z.literal("acknowledge"),
  reason: z.string().trim().min(2).max(1000),
  idempotencyKey: z.string().trim().min(8).max(160),
}).strict();
