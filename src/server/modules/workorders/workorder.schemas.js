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

const inventoryUnitSelectionSchema = z.object({
  partIndex: z.number().int().min(0).max(17),
  catalogPartId: z.string().uuid(),
  unitIds: z.array(z.string().uuid()).min(1).max(18)
    .refine((ids) => new Set(ids).size === ids.length, "Choose each serialized unit once."),
}).strict();

const customerCompanyNameSchema = z.string().trim().max(300, "Customer company must be 300 characters or less.");
const laborProductSchema = z.object({
  externalId: z.string().trim().max(200).default(""),
  code: z.string().trim().max(100).default(""),
  name: z.string().trim().min(1).max(300),
  uomCode: z.literal("hr").default("hr"),
}).strict();

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
  laborProduct: laborProductSchema.nullable().optional(),
  workPerformed: z.string().trim().max(5000, "Repair order must be 5000 characters or less.").optional(),
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
  inventoryUnitSelections: z.array(inventoryUnitSelectionSchema).max(18).default([]),
}).superRefine((input, context) => {
  const parts = Array.isArray(input.formData?.parts) ? input.formData.parts : [];
  const selectionsByPartIndex = new Map(input.inventoryUnitSelections.map((selection) => [selection.partIndex, selection]));
  const allUnitIds = input.inventoryUnitSelections.flatMap((selection) => selection.unitIds);
  if (new Set(allUnitIds).size !== allUnitIds.length) {
    context.addIssue({ code: "custom", path: ["inventoryUnitSelections"], message: "Choose each serialized unit once." });
  }
  if (selectionsByPartIndex.size !== input.inventoryUnitSelections.length) {
    context.addIssue({ code: "custom", path: ["inventoryUnitSelections"], message: "Each part row can have one serialized-unit selection." });
  }
  parts.forEach((part, partIndex) => {
    const definition = getUnitDefinition(String(part?.uomCode || DEFAULT_UOM_CODE).trim().toLowerCase());
    const selection = selectionsByPartIndex.get(partIndex);
    const allowsSerializedUnits = Boolean(part?.catalogPartId)
      && ["count", "packaging"].includes(definition?.category)
      && Number(definition?.decimalScale) === 0;
    if (!allowsSerializedUnits && selection) {
      context.addIssue({ code: "custom", path: ["inventoryUnitSelections", partIndex], message: "Serialized units are only valid for countable inventory parts." });
      return;
    }
    if (!selection) return;
    if (selection.catalogPartId !== part.catalogPartId) {
      context.addIssue({ code: "custom", path: ["formData", "parts", partIndex], message: "Selected serialized units must match this inventory part." });
    }
    const quantity = Number(normalizeQuantity(part.qty, definition.code));
    if (!Number.isInteger(quantity) || selection.unitIds.length !== quantity) {
      context.addIssue({ code: "custom", path: ["formData", "parts", partIndex], message: "Selected serial numbers must match the part quantity." });
    }
  });
  for (const selection of input.inventoryUnitSelections) {
    if (!parts[selection.partIndex]) {
      context.addIssue({ code: "custom", path: ["inventoryUnitSelections", selection.partIndex], message: "Serialized-unit selection does not match a part row." });
    }
  }
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

const manualUsedPartValueSchema = z.object({
  partNo: z.string().trim().max(200).default(""),
  qty: usedPartQuantitySchema.refine((value) => value !== "", "Corrected quantity is required."),
  uomCode: uomCodeSchema,
  repairOrder: z.string().trim().max(2000).default(""),
}).strict().superRefine((part, context) => {
  if (part.qty === "") return;
  validateQuantityUnit({
    qty: Number(part.qty),
    uomCode: part.uomCode,
  }, context, ["qty"]);
}).transform((part) => ({
  ...part,
  qty: part.qty === "" ? "" : String(Number(part.qty)),
}));

export const updateMechanicUsedPartsSchema = z.object({
  laborHours: z.union([
    z.literal(""),
    z.number().positive().max(9999),
    z.string().trim()
      .regex(/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/, "Labor hours must be positive with at most two decimals.")
      .refine((value) => Number(value) > 0 && Number(value) <= 9999, "Labor hours must be greater than zero and within the supported range."),
  ]).optional().transform((value) => value === undefined || value === "" ? value : String(Number(value))),
  parts: z.array(z.object({
    evidenceId: z.string().uuid().optional(),
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

export const amendLegacyManualPartEvidenceSchema = z.object({
  operation: z.literal("legacyManualPartAmendment"),
  evidenceId: z.string().uuid(),
  action: z.enum(["corrected", "voided"]),
  replacementPart: manualUsedPartValueSchema.optional(),
  reason: z.string().trim().min(2, "Amendment reason is required.").max(1000),
  idempotencyKey: z.string().trim().min(8).max(160),
}).strict().superRefine((value, context) => {
  if (value.action === "corrected" && !value.replacementPart) {
    context.addIssue({ code: "custom", path: ["replacementPart"], message: "A corrected part value is required." });
  }
  if (value.action === "voided" && value.replacementPart) {
    context.addIssue({ code: "custom", path: ["replacementPart"], message: "A void amendment cannot include replacement values." });
  }
});

export const markDoneSchema = z.object({
  diagnosis: z.string().trim().max(5000).default(""),
  workPerformed: z.string().trim().max(5000).default(""),
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
