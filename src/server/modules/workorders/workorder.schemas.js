import { z } from "zod";
import { userRoleSchema } from "../../auth/roles.js";
import { DATABASE_UUID_PATTERN, DEFAULT_COMPANY_ID } from "../../db/company.js";
import { normalizeWorkorderFormData } from "../../../../shared/workorder-template.js";
import {
  DEFAULT_UOM_CODE,
  MAX_QUANTITY,
  getUnitDefinition,
  normalizeQuantity,
} from "../../../../shared/units-of-measure.js";
import { uomCodeSchema, validateQuantityUnit } from "../parts/quantity-uom.js";

export { userRoleSchema };

const customerCompanyNameSchema = z.string().trim().max(300, "Customer company must be 300 characters or less.");

/**
 * Typed boundary for printable form snapshots.
 *
 * The remaining legacy/template keys stay open during the compatibility window,
 * while customerCompanyName has one explicit meaning: the customer or unit owner
 * captured for this workorder. It is never the tenant or repair location.
 */
export const workorderFormDataSchema = z.object({
  customerCompanyName: customerCompanyNameSchema.optional(),
  companyName: customerCompanyNameSchema.optional(),
}).catchall(z.unknown()).superRefine((formData, context) => {
  if (formData.parts === undefined) return;
  if (!Array.isArray(formData.parts)) {
    context.addIssue({ code: "custom", path: ["parts"], message: "Parts must be a list." });
    return;
  }
  if (formData.parts.length > 18) {
    context.addIssue({ code: "custom", path: ["parts"], message: "A workorder can contain at most 18 part rows." });
  }
  formData.parts.forEach((part, index) => {
    if (!part || typeof part !== "object" || Array.isArray(part)) {
      context.addIssue({ code: "custom", path: ["parts", index], message: "Part row is invalid." });
      return;
    }
    const hasContent = Boolean(part.partNo || part.qty || part.repairOrder || part.requestId);
    if (!hasContent) return;
    const code = String(part.uomCode || DEFAULT_UOM_CODE).trim().toLowerCase();
    if (!getUnitDefinition(code)) {
      context.addIssue({ code: "custom", path: ["parts", index, "uomCode"], message: "Select a valid unit." });
      return;
    }
    if (!normalizeQuantity(part.qty, code)) {
      context.addIssue({
        code: "custom",
        path: ["parts", index, "qty"],
        message: "Enter a valid quantity for the selected unit.",
      });
    }
  });
}).transform((formData) => normalizeWorkorderFormData(formData));

export const createWorkorderSchema = z.object({
  companyId: z.string()
    .regex(DATABASE_UUID_PATTERN, "Select a valid company.")
    .default(DEFAULT_COMPANY_ID),
  assetId: z.string().uuid("Select a valid unit.").optional().nullable(),
  locationId: z.string().uuid("Select a valid location.").optional().nullable(),
  concern: z.string().trim().min(1, "Concern is required.").max(2000),
  officeNotes: z.string().trim().max(4000).default(""),
  mechanicUserIds: z.array(z.string().uuid()).max(10, "A workorder can have up to 10 mechanics.")
    .transform((ids) => [...new Set(ids)])
    .default([]),
  formData: workorderFormDataSchema.default({}),
});

export const updateOfficeWorkorderSchema = z.object({
  assetId: z.string().uuid().optional().nullable(),
  locationId: z.string().uuid().optional().nullable(),
  concern: z.string().trim().min(1, "Concern is required.").max(2000).optional(),
  officeNotes: z.string().trim().max(4000).optional(),
  formData: workorderFormDataSchema.optional(),
  expectedUpdatedAt: z.string().datetime().optional(),
});

export const acceptWorkorderSchema = z.object({});

export const releaseWorkorderSchema = z.object({
  reason: z.string().trim().min(2, "Release reason is required.").max(500),
});

const usedPartQuantitySchema = z.union([
  z.literal(""),
  z.number().positive().max(MAX_QUANTITY),
  z.string().trim()
    .regex(/^(?:0|[1-9]\d*)(?:\.\d{1,3})?$/, "Quantity must be positive with at most three decimals.")
    .refine((value) => Number(value) > 0 && Number(value) <= MAX_QUANTITY, "Quantity is outside the supported range."),
]);

export const updateMechanicUsedPartsSchema = z.object({
  parts: z.array(z.object({
    partNo: z.string().trim().max(200).default(""),
    qty: usedPartQuantitySchema.default(""),
    uomCode: uomCodeSchema,
    repairOrder: z.string().trim().max(2000).default(""),
  }).superRefine((part, context) => {
    if (part.qty === "") return;
    validateQuantityUnit({
      qty: Number(part.qty),
      uomCode: part.uomCode,
    }, context, ["qty"]);
  }).transform((part) => ({
    ...part,
    qty: part.qty === "" ? "" : String(Number(part.qty)),
  }))).max(18, "A workorder can contain at most 18 used-part rows."),
});

export const markDoneSchema = z.object({
  diagnosis: z.string().trim().max(5000).default(""),
  workPerformed: z.string().trim().min(1, "Add the repair completed before marking Work done.").max(5000),
  confirmationName: z.string().trim().max(200).optional(),
});

const chatAttachmentSchema = z.object({
  dataUrl: z.string().min(1).max(14_100_000),
  fileName: z.string().trim().min(1).max(255),
});

export const sendMessageSchema = z.object({
  clientMessageId: z.uuid().optional(),
  messageType: z.enum(["normal", "part_request", "help_request"]).default("normal"),
  body: z.string().trim().max(5000).optional().default(""),
  attachment: chatAttachmentSchema.optional(),
}).superRefine((value, context) => {
  if (!value.body && !value.attachment) {
    context.addIssue({ code: "custom", path: ["body"], message: "Message or photo is required." });
  }
});

export const closeWorkorderSchema = z.object({
  note: z.string().trim().max(1000).default(""),
});

export const returnWorkorderSchema = z.object({
  reason: z.string().trim().min(2, "Return reason is required.").max(1000),
  categories: z.array(z.enum(["diagnosis", "work_performed", "parts", "photos", "other"]))
    .transform((categories) => [...new Set(categories)])
    .default([]),
});

export const cancelWorkorderSchema = z.object({
  reason: z.string().trim().min(2, "Cancellation reason is required.").max(1000),
});

export const reassignWorkorderSchema = z.object({
  mechanicUserId: z.string().uuid().nullable(),
  reason: z.string().trim().min(2, "Reassignment reason is required.").max(500),
});

export const assignMechanicsSchema = z.object({
  mechanicUserIds: z.array(z.string().uuid()).max(10, "A workorder can have up to 10 mechanics.")
    .transform((ids) => [...new Set(ids)]),
  reason: z.string().trim().min(2, "Assignment reason is required.").max(500),
});
