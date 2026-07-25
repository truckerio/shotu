import { z } from "zod";

export const userRoleSchema = z.enum(["mechanic", "office", "surveillance", "admin"]);

export const createWorkorderSchema = z.object({
  companyId: z.string().trim().min(1).default("default"),
  assetId: z.string().uuid().optional().nullable(),
  locationId: z.string().uuid().optional().nullable(),
  concern: z.string().trim().min(1, "Concern is required.").max(2000),
  officeNotes: z.string().trim().max(4000).default(""),
  formData: z.record(z.string(), z.unknown()).default({}),
});

export const updateOfficeWorkorderSchema = z.object({
  companyId: z.string().trim().min(1).optional(),
  assetId: z.string().uuid().optional().nullable(),
  locationId: z.string().uuid().optional().nullable(),
  concern: z.string().trim().min(1, "Concern is required.").max(2000).optional(),
  officeNotes: z.string().trim().max(4000).optional(),
  formData: z.record(z.string(), z.unknown()).optional(),
});

export const acceptWorkorderSchema = z.object({});

export const releaseWorkorderSchema = z.object({
  reason: z.string().trim().min(2, "Release reason is required.").max(500),
});

export const updateMechanicNotesSchema = z.object({
  diagnosis: z.string().trim().max(5000).default(""),
  workPerformed: z.string().trim().max(5000).default(""),
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
