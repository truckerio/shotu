import { z } from "zod";
import {
  CUSTOMER_DOCUMENT_RESPONSES,
  CUSTOMER_DOCUMENT_TYPES,
  CUSTOMER_DOCUMENT_LINE_TYPES,
  CUSTOMER_DOCUMENT_PRICE_BASES,
} from "../../../../shared/customer-document-contract.js";
import { isSupportedFinancialCurrency } from "./financial-money.js";

const decimal = (maximumScale, maximumIntegerDigits = 12) => z.string().trim().regex(
  new RegExp(`^(?:0|[1-9]\\d{0,${maximumIntegerDigits - 1}})(?:\\.\\d{1,${maximumScale}})?$`),
  "Enter a valid non-negative decimal value.",
);

const percentage = decimal(4, 3).refine((value) => Number(value) <= 100, "Percentage cannot exceed 100.");

export const customerFinancialDiscountSchema = z.object({
  kind: z.enum(["fixed", "percentage"]),
  value: decimal(4),
  reason: z.string().trim().min(2).max(500),
}).strict().superRefine((discount, context) => {
  if (discount.kind === "percentage" && Number(discount.value) > 100) {
    context.addIssue({ code: "custom", path: ["value"], message: "Percentage cannot exceed 100." });
  }
});

export const customerTaxComponentSchema = z.object({
  name: z.string().trim().min(1).max(80),
  rate: percentage,
  compound: z.boolean(),
}).strict();

export const customerFinancialLineSchema = z.object({
  id: z.string().trim().min(1).max(200),
  type: z.enum(CUSTOMER_DOCUMENT_LINE_TYPES),
  description: z.string().trim().min(1).max(2000),
  quantity: decimal(3, 9).refine((value) => !/^0+(?:\.0+)?$/.test(value), "Quantity must be greater than zero."),
  unit: z.string().trim().min(1).max(32),
  unitPrice: decimal(4, 10),
  priceBasis: z.enum(CUSTOMER_DOCUMENT_PRICE_BASES),
  taxCategory: z.string().trim().min(1).max(80),
  taxTreatment: z.enum(["not_configured", "exclusive", "inclusive", "zero_rated", "exempt", "out_of_scope"]),
  taxComponents: z.array(customerTaxComponentSchema).max(5).default([]),
  discountEligible: z.boolean().default(true),
  lineDiscount: customerFinancialDiscountSchema.nullable().optional().default(null),
  source: z.object({
    kind: z.string().trim().min(1).max(80),
    id: z.string().trim().min(1).max(200),
    priceVersionId: z.string().trim().max(200).nullable().optional().default(null),
    pricingFingerprint: z.string().regex(/^[0-9a-f]{64}$/).nullable().optional().default(null),
    overrideReason: z.string().trim().min(2).max(500).nullable().optional().default(null),
    discountReason: z.string().trim().min(2).max(500).nullable().optional().default(null),
  }).strict(),
}).strict();

export const customerFinancialCalculationSchema = z.object({
  currency: z.string().trim().toUpperCase().length(3).refine(isSupportedFinancialCurrency, "Unsupported currency."),
  basis: z.enum(["estimated", "actual"]),
  lines: z.array(customerFinancialLineSchema).max(500),
  documentDiscount: customerFinancialDiscountSchema.nullable().optional().default(null),
}).strict().superRefine((input, context) => {
  const ids = input.lines.map((line) => line.id);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: "custom", path: ["lines"], message: "Financial line IDs must be unique." });
  }
});

export function parseCustomerFinancialCalculation(value) {
  return customerFinancialCalculationSchema.parse(value);
}

const optionalText = (maximum) => z.string().trim().max(maximum).nullable().optional().default(null);

export const customerDocumentProjectionInputSchema = z.object({
  document: z.object({
    id: z.string().uuid().nullable().optional().default(null),
    revisionId: z.string().uuid().nullable().optional().default(null),
    type: z.enum(CUSTOMER_DOCUMENT_TYPES),
    number: optionalText(120),
    revision: z.number().int().positive().nullable().optional().default(null),
    state: z.enum(["draft_projection", "issued", "voided"]),
    issuedAt: z.string().datetime().nullable().optional().default(null),
    expiresAt: z.string().datetime().nullable().optional().default(null),
  }).strict(),
  shop: z.object({
    legalName: z.string().trim().min(1).max(300),
    tradeName: optionalText(300),
    address: optionalText(1000),
    phone: optionalText(100),
    email: optionalText(320),
    registrationIdentifiers: z.record(z.string(), z.string().max(300)).optional().default({}),
    logoUrl: optionalText(2000),
    accentColor: optionalText(32),
  }).strict(),
  customer: z.object({
    name: optionalText(300),
    company: optionalText(300),
    address: optionalText(1000),
    email: optionalText(320),
    phone: optionalText(100),
  }).strict(),
  unit: z.object({
    id: optionalText(200),
    label: z.string().trim().min(1).max(300),
    vin: optionalText(100),
    make: optionalText(120),
    model: optionalText(120),
    year: z.number().int().min(1880).max(3000).nullable().optional().default(null),
  }).strict(),
  concern: z.string().trim().max(5000).default(""),
  repairDescription: z.string().trim().max(10000).default(""),
  terms: z.string().trim().max(20000).default(""),
  authorizationText: z.string().trim().max(20000).default(""),
  warrantyText: z.string().trim().max(20000).default(""),
  footer: z.string().trim().max(10000).default(""),
  profileVersionId: z.string().uuid(),
  templateVersion: z.string().trim().min(1).max(120),
  taxProfileVersionId: z.string().uuid().nullable().optional().default(null),
  relatedDocuments: z.array(z.object({
    id: z.string().uuid(),
    type: z.enum(CUSTOMER_DOCUMENT_TYPES),
    number: z.string().trim().min(1).max(120),
    revision: z.number().int().positive(),
  }).strict()).max(50).optional().default([]),
  response: z.object({
    status: z.enum(["pending", "not_applicable", ...CUSTOMER_DOCUMENT_RESPONSES]),
    respondedAt: z.string().datetime().nullable().optional().default(null),
    customerName: optionalText(300),
  }).strict().optional().default({ status: "pending", respondedAt: null, customerName: null }),
  sourceEvidence: z.object({
    kind: z.enum(["draft", "workorder"]),
    id: z.string().uuid(),
    version: z.number().int().nonnegative(),
    pricingFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  }).strict(),
  discountEvidence: z.object({
    documentDiscount: customerFinancialDiscountSchema.nullable(),
  }).strict(),
  financial: customerFinancialCalculationSchema,
}).strict();
