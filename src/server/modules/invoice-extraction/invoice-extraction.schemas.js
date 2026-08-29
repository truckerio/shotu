import { z } from "zod";
import { invoiceExtractionConfig } from "./invoice-extraction.config.js";

const boundedText = (max = 500) => z.string().trim().max(max);
const confidence = z.number().int().min(0).max(100);

function evidenceField(valueSchema) {
  return z.object({
    value: valueSchema,
    confidence,
    evidence: boundedText(500),
  }).strict();
}

export const invoiceLineSchema = z.object({
  id: z.string().trim().min(1).max(80),
  partNumber: evidenceField(boundedText(200)),
  description: evidenceField(boundedText(1000)),
  quantity: evidenceField(z.number().finite().nullable()),
  unitOfMeasure: evidenceField(boundedText(40)),
  unitPrice: evidenceField(z.number().finite().nullable()),
  lineTotal: evidenceField(z.number().finite().nullable()),
}).strict();

export const invoiceDraftSchema = z.object({
  documentType: evidenceField(z.enum(["invoice", "credit_memo", "unknown"])),
  vendorName: evidenceField(boundedText(300)),
  vendorAccount: evidenceField(boundedText(200)),
  invoiceNumber: evidenceField(boundedText(200)),
  invoiceDate: evidenceField(boundedText(40)),
  purchaseOrderNumber: evidenceField(boundedText(200)),
  currency: evidenceField(boundedText(8)),
  subtotal: evidenceField(z.number().finite().nullable()),
  tax: evidenceField(z.number().finite().nullable()),
  shipping: evidenceField(z.number().finite().nullable()),
  total: evidenceField(z.number().finite().nullable()),
  lines: z.array(invoiceLineSchema).max(invoiceExtractionConfig.maxLines),
  warnings: z.array(boundedText(500)).max(50),
}).strict().superRefine((value, context) => {
  const seen = new Set();
  value.lines.forEach((line, index) => {
    if (seen.has(line.id)) context.addIssue({ code: "custom", path: ["lines", index, "id"], message: "Invoice line IDs must be unique." });
    seen.add(line.id);
  });
});

export const extractInvoiceInputSchema = z.object({
  locationId: z.string().uuid(),
  fileName: boundedText(180).min(1),
  mimeType: z.enum(["image/png", "image/jpeg", "image/webp", "application/pdf"]),
  dataUrl: z.string().min(1).max(14_100_000),
  idempotencyKey: z.string().trim().min(8).max(120),
  vendorHint: boundedText(180).optional().default(""),
}).strict();

export const reextractInvoiceInputSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(120),
}).strict();

export const reviewInvoiceInputSchema = z.object({
  expectedVersion: z.number().int().min(1),
  idempotencyKey: z.string().trim().min(8).max(120),
  reviewedDraft: invoiceDraftSchema,
  confirmNoLineItems: z.boolean().optional().default(false),
  approveLearning: z.boolean().optional().default(false),
  approveGlobalStructureContribution: z.boolean().optional().default(false),
}).strict().superRefine((value, context) => {
  if (!value.reviewedDraft.lines.length && !value.confirmNoLineItems) {
    context.addIssue({
      code: "custom",
      path: ["confirmNoLineItems"],
      message: "Confirm that this invoice has no line items.",
    });
  }
  value.reviewedDraft.lines.forEach((line, index) => {
    if (!line.partNumber.value && !line.description.value) {
      context.addIssue({
        code: "custom",
        path: ["reviewedDraft", "lines", index, "description", "value"],
        message: "Enter a part number or description for every invoice line.",
      });
    }
    if (line.quantity.value === null || line.quantity.value === 0) {
      context.addIssue({
        code: "custom",
        path: ["reviewedDraft", "lines", index, "quantity", "value"],
        message: "Enter a non-zero quantity for every invoice line.",
      });
    }
  });
});

export function normalizeVendorKey(value) {
  return String(value || "")
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .slice(0, 180);
}
