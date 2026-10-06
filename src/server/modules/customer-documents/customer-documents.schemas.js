import { z } from "zod";
import { DATABASE_UUID_PATTERN } from "../../db/company.js";
import {
  CUSTOMER_DOCUMENT_GRANT_CAPABILITIES,
  CUSTOMER_DOCUMENT_RESPONSES,
  CUSTOMER_DOCUMENT_TYPES,
} from "../../../../shared/customer-document-contract.js";
import { customerFinancialDiscountSchema } from "./customer-financial.schemas.js";

const uuid = z.string().uuid();
const companyId = z.string().regex(DATABASE_UUID_PATTERN, "Invalid company ID");
const optionalUuid = uuid.nullable().optional().default(null);
const idempotencyKey = z.string().trim().min(8).max(120);
const boundedText = (minimum, maximum) => z.string().trim().min(minimum).max(maximum);

const estimateAdjustmentsSchema = z.object({
  lineDiscounts: z.array(z.object({
    lineId: boundedText(1, 200),
    discount: customerFinancialDiscountSchema,
  }).strict()).max(100).default([]).refine(
    (entries) => new Set(entries.map((entry) => entry.lineId)).size === entries.length,
    "Each line can have only one discount.",
  ),
  documentDiscount: customerFinancialDiscountSchema.nullable().optional().default(null),
  overrideReasons: z.array(z.object({
    lineId: boundedText(1, 200),
    reason: boundedText(2, 500),
  }).strict()).max(100).default([]).refine(
    (entries) => new Set(entries.map((entry) => entry.lineId)).size === entries.length,
    "Each override can have only one reason.",
  ),
}).strict().default({});

function hasFinancialAdjustments(adjustments) {
  return adjustments.lineDiscounts.length > 0
    || adjustments.documentDiscount !== null
    || adjustments.overrideReasons.length > 0;
}

const customerDocumentSourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("draft"), id: uuid, expectedVersion: z.number().int().positive() }).strict(),
  z.object({ kind: z.literal("workorder"), id: uuid, expectedVersion: z.number().int().positive() }).strict(),
]);

export const customerDocumentPreviewSchema = z.object({
  companyId,
  locationId: uuid,
  documentType: z.enum(CUSTOMER_DOCUMENT_TYPES).default("estimate"),
  source: customerDocumentSourceSchema,
  adjustments: estimateAdjustmentsSchema,
}).strict().superRefine((input, context) => {
  if (input.documentType === "invoice" && input.source.kind !== "workorder") {
    context.addIssue({ code: "custom", path: ["source"], message: "Invoices require a Workorder source." });
  }
  if (input.documentType === "invoice" && hasFinancialAdjustments(input.adjustments)) {
    context.addIssue({ code: "custom", path: ["adjustments"], message: "Invoices reuse the accepted Estimate financial terms." });
  }
});

export const issueCustomerDocumentSchema = z.object({
  companyId,
  locationId: uuid,
  documentId: optionalUuid,
  predecessorRevisionId: optionalUuid,
  draftId: optionalUuid,
  workorderId: optionalUuid,
  documentType: z.enum(CUSTOMER_DOCUMENT_TYPES),
  source: customerDocumentSourceSchema,
  expectedFinancialFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  expectedReconciliationHash: z.string().regex(/^[0-9a-f]{64}$/).nullable().optional().default(null),
  adjustments: estimateAdjustmentsSchema,
  recipient: z.object({
    name: boundedText(1, 300).nullable().optional().default(null),
    company: boundedText(1, 300).nullable().optional().default(null),
    address: boundedText(1, 1000).nullable().optional().default(null),
    email: z.string().trim().email().max(320).nullable().optional().default(null),
    phone: boundedText(1, 100).nullable().optional().default(null),
    customerId: uuid.nullable().optional().default(null),
    contactId: uuid.nullable().optional().default(null),
    channel: z.literal("link"),
  }).strict(),
  idempotencyKey,
}).strict().superRefine((input, context) => {
  if (input.documentType === "estimate" && input.source.kind === "draft" && input.draftId !== input.source.id) {
    context.addIssue({ code: "custom", path: ["draftId"], message: "Estimate draft identity must match its source." });
  }
  if (input.documentType === "estimate" && input.source.kind === "workorder" && input.workorderId !== input.source.id) {
    context.addIssue({ code: "custom", path: ["workorderId"], message: "Estimate Workorder identity must match its source." });
  }
  if (input.documentType === "estimate" && input.source.kind === "workorder"
    && (!input.documentId || !input.predecessorRevisionId || !input.draftId)) {
    context.addIssue({ code: "custom", path: ["documentId"], message: "Revised Estimates require exact original document, draft, and predecessor lineage." });
  }
  if (input.documentType === "invoice" && (input.source.kind !== "workorder" || input.workorderId !== input.source.id || input.draftId)) {
    context.addIssue({ code: "custom", path: ["workorderId"], message: "Invoice Workorder identity must match its source." });
  }
  if (input.documentType === "invoice" && !input.expectedReconciliationHash) {
    context.addIssue({ code: "custom", path: ["expectedReconciliationHash"], message: "Invoice reconciliation evidence is required." });
  }
  if (input.documentType === "invoice" && hasFinancialAdjustments(input.adjustments)) {
    context.addIssue({ code: "custom", path: ["adjustments"], message: "Invoices reuse the accepted Estimate financial terms." });
  }
  if (input.documentType === "estimate" && input.expectedReconciliationHash) {
    context.addIssue({ code: "custom", path: ["expectedReconciliationHash"], message: "Estimate revisions cannot carry Invoice reconciliation evidence." });
  }
});

export const publishCustomerDocumentProfileSchema = z.object({
  companyId,
  locationId: optionalUuid,
  profileId: optionalUuid,
  expectedVersion: z.number().int().nonnegative(),
  shopIdentity: z.object({
    legalName: boundedText(1, 300),
    tradeName: boundedText(1, 300).nullable().optional().default(null),
    address: boundedText(1, 1000).nullable().optional().default(null),
    phone: boundedText(1, 100).nullable().optional().default(null),
    email: z.string().trim().email().max(320).nullable().optional().default(null),
    registrationIdentifiers: z.record(z.string(), z.string().max(300)).optional().default({}),
    logoUrl: z.string().trim().url().max(2000).nullable().optional().default(null),
    accentColor: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional().default(null),
  }).strict(),
  documentTerms: z.object({
    estimate: z.string().trim().max(20000).default(""),
    invoice: z.string().trim().max(20000).default(""),
    warranty: z.string().trim().max(20000).default(""),
    footer: z.string().trim().max(10000).default(""),
  }).strict(),
  authorizationText: boundedText(2, 20000),
  discountPolicy: z.object({
    maxOfficePercentage: z.string().regex(/^(?:0|[1-9]\d?|100)(?:\.\d{1,4})?$/).default("0"),
    reasonRequired: z.literal(true).default(true),
  }).strict(),
  lineTaxPolicy: z.object({
    labor: z.enum(["exclusive", "inclusive", "zero_rated", "exempt", "out_of_scope"]),
    part: z.enum(["exclusive", "inclusive", "zero_rated", "exempt", "out_of_scope"]),
    shop_supply: z.enum(["exclusive", "inclusive", "zero_rated", "exempt", "out_of_scope"]),
    fee: z.enum(["exclusive", "inclusive", "zero_rated", "exempt", "out_of_scope"]),
    core_charge: z.enum(["exclusive", "inclusive", "zero_rated", "exempt", "out_of_scope"]),
    credit: z.enum(["zero_rated", "exempt", "out_of_scope"]),
  }).strict(),
  documentNumbering: z.object({
    estimate: z.object({
      prefix: boundedText(1, 20),
      digits: z.number().int().min(4).max(12),
    }).strict(),
    invoice: z.object({
      prefix: boundedText(1, 20),
      digits: z.number().int().min(4).max(12),
    }).strict(),
  }).strict().optional().default({
    estimate: { prefix: "EST-", digits: 6 },
    invoice: { prefix: "INV-", digits: 6 },
  }),
  estimateValidityDays: z.number().int().min(1).max(365).nullable().optional().default(null),
  defaultCurrency: z.string().trim().toUpperCase().length(3),
  taxProfileVersionId: uuid,
  idempotencyKey,
}).strict();

export const customerDocumentGrantSchema = z.object({
  companyId,
  locationId: uuid,
  revisionId: uuid,
  allowedActions: z.array(z.enum(CUSTOMER_DOCUMENT_GRANT_CAPABILITIES)).max(3)
    .transform((actions) => [...new Set(actions)]).optional().default([]),
  expiresAt: z.string().datetime(),
  idempotencyKey,
}).strict();

export const customerDocumentVoidSchema = z.object({
  companyId,
  locationId: uuid,
  reason: boundedText(2, 1000),
  idempotencyKey,
}).strict();

export const customerDocumentGrantRevokeSchema = z.object({
  companyId,
  locationId: uuid,
  reason: boundedText(2, 1000),
  idempotencyKey,
}).strict();

export const customerDocumentResponseSchema = z.object({
  response: z.enum(CUSTOMER_DOCUMENT_RESPONSES),
  customerName: boundedText(1, 300),
  note: z.string().trim().max(5000).default(""),
  idempotencyKey,
}).strict().superRefine((input, context) => {
  if (input.response === "changes_requested" && input.note.length < 2) {
    context.addIssue({ code: "custom", path: ["note"], message: "Describe the requested change." });
  }
});

export const customerDocumentActivationSchema = z.object({
  companyId,
  locationId: uuid,
  expectedDraftVersion: z.number().int().positive(),
  idempotencyKey,
}).strict();

export const customerDocumentIdSchema = uuid;

export const customerDocumentProfileQuerySchema = z.object({
  companyId,
  locationId: uuid.nullable().optional().default(null),
}).strict();

export const customerDocumentDraftQuerySchema = z.object({
  companyId,
  locationId: uuid,
}).strict();

export const customerDocumentWorkorderQuerySchema = z.object({
  companyId,
  locationId: uuid,
}).strict();
