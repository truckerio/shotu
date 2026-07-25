import { z } from "zod";
import { PART_ALLOCATION_STATUSES, PART_SOURCE_TYPES, PART_USAGE_STATUSES } from "./part.constants.js";

const optionalText = (max = 2000) => z.string().trim().max(max).optional().default("");

export const createPartRequestSchema = z.object({
  query: z.string().trim().min(2).max(500),
  partNumber: optionalText(200),
  manufacturer: optionalText(200),
  description: optionalText(1000),
  category: optionalText(200),
  quantity: z.coerce.number().int().min(1).max(999).default(1),
  repairOrder: optionalText(2000),
  fitmentStatus: z.enum(["confirmed", "possible", "unknown", "conflict"]).default("unknown"),
  fitmentNotes: optionalText(2000),
});

export const partAllocationInputSchema = z.object({
  sourceType: z.enum(PART_SOURCE_TYPES),
  status: z.enum(PART_ALLOCATION_STATUSES).default("proposed"),
  quantity: z.coerce.number().int().min(1).max(999),
  locationId: z.string().uuid().optional().nullable(),
  inventoryItemId: z.string().uuid().optional().nullable(),
  vendor: optionalText(300),
  sourceReference: optionalText(500),
  unitPrice: z.coerce.number().nonnegative().max(99_999_999).optional().nullable(),
  quoteUrl: z.string().trim().url().optional().or(z.literal("")),
});

export const createOfficePartSchema = createPartRequestSchema.extend({
  allocations: z.array(partAllocationInputSchema).max(20).default([]),
});

export const decidePartRequestSchema = z.object({
  decision: z.enum(["approved", "rejected", "needs_info"]),
  partNumber: optionalText(200),
  manufacturer: optionalText(200),
  description: optionalText(1000),
  category: optionalText(200),
  quantity: z.coerce.number().int().min(1).max(999),
  repairOrder: optionalText(2000),
  fitmentStatus: z.enum(["confirmed", "possible", "unknown", "conflict"]).default("unknown"),
  fitmentNotes: optionalText(2000),
  reason: optionalText(2000),
  allocations: z.array(partAllocationInputSchema).max(20).default([]),
}).superRefine((value, context) => {
  if (value.decision === "approved") {
    const allocated = value.allocations.reduce((sum, allocation) => sum + allocation.quantity, 0);
    if (allocated > value.quantity) context.addIssue({ code: "custom", path: ["allocations"], message: "Allocated quantity cannot exceed approved quantity." });
  }
  if (value.decision !== "approved" && !value.reason) {
    context.addIssue({ code: "custom", path: ["reason"], message: "A reason is required." });
  }
});

export const updatePartAllocationSchema = z.object({
  status: z.enum(PART_ALLOCATION_STATUSES),
  note: optionalText(1000),
});

export const updatePartUsageSchema = z.object({
  usageStatus: z.enum(PART_USAGE_STATUSES),
  note: optionalText(1000),
});
