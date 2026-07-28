import { z } from "zod";
import { DATABASE_UUID_PATTERN, DEFAULT_COMPANY_ID } from "../../db/company.js";
import { normalizeWorkorderFormData } from "../../../../shared/workorder-template.js";

export const userRoleSchema = z.enum(["mechanic", "office", "surveillance", "admin"]);

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
}).catchall(z.unknown()).transform((formData) => normalizeWorkorderFormData(formData));

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
});

export const acceptWorkorderSchema = z.object({});

export const releaseWorkorderSchema = z.object({
  reason: z.string().trim().min(2, "Release reason is required.").max(500),
});

const usedPartQuantitySchema = z.union([
  z.literal(""),
  z.number().int().positive().max(9999),
  z.string().trim()
    .regex(/^[1-9]\d*$/, "Quantity must be blank or a positive integer.")
    .refine((value) => Number(value) <= 9999, "Quantity must be 9999 or less."),
]).transform((value) => value === "" ? "" : String(value));

export const updateMechanicUsedPartsSchema = z.object({
  parts: z.array(z.object({
    partNo: z.string().trim().max(200).default(""),
    qty: usedPartQuantitySchema.default(""),
    repairOrder: z.string().trim().max(2000).default(""),
  })).max(18, "A workorder can contain at most 18 used-part rows."),
});

export const markDoneSchema = z.object({
  diagnosis: z.string().trim().max(5000).default(""),
  workPerformed: z.string().trim().max(5000).default(""),
  confirmationName: z.string().trim().min(1, "Write your name to finish the workorder.").max(200),
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

export const reassignWorkorderSchema = z.object({
  mechanicUserId: z.string().uuid().nullable(),
  reason: z.string().trim().min(2, "Reassignment reason is required.").max(500),
});

export const assignMechanicsSchema = z.object({
  mechanicUserIds: z.array(z.string().uuid()).max(10, "A workorder can have up to 10 mechanics.")
    .transform((ids) => [...new Set(ids)]),
  reason: z.string().trim().min(2, "Assignment reason is required.").max(500),
});
