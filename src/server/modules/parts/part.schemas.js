import { z } from "zod";
import { PART_ALLOCATION_STATUSES, PART_SOURCE_TYPES, PART_USAGE_STATUSES } from "./part.constants.js";
import {
  quantitySchema,
  uomCodeSchema,
  validateQuantityUnit,
} from "./quantity-uom.js";

const optionalText = (max = 2000) => z.string().trim().max(max).optional().default("");

const partRequestShape = {
  catalogPartId: z.string().uuid().optional().nullable(),
  query: z.string().trim().min(2).max(500),
  partNumber: optionalText(200),
  manufacturer: optionalText(200),
  description: optionalText(1000),
  category: optionalText(200),
  quantity: quantitySchema.default(1),
  uomCode: uomCodeSchema,
  repairOrder: optionalText(2000),
  fitmentStatus: z.enum(["confirmed", "possible", "unknown", "conflict"]).default("unknown"),
  fitmentNotes: optionalText(2000),
};

export const createPartRequestSchema = z.object(partRequestShape)
  .superRefine(validateQuantityUnit);

export const partAllocationInputSchema = z.object({
  sourceType: z.enum(PART_SOURCE_TYPES),
  status: z.enum(PART_ALLOCATION_STATUSES).default("proposed"),
  quantity: quantitySchema,
  uomCode: uomCodeSchema,
  locationId: z.string().uuid().optional().nullable(),
  inventoryItemId: z.string().uuid().optional().nullable(),
  vendor: optionalText(300),
  sourceReference: optionalText(500),
  unitPrice: z.coerce.number().nonnegative().max(99_999_999).optional().nullable(),
  quoteUrl: z.string().trim().url().optional().or(z.literal("")),
}).superRefine(validateQuantityUnit);

export const createOfficePartSchema = z.object({
  ...partRequestShape,
  allocations: z.array(partAllocationInputSchema).max(20).default([]),
}).superRefine((value, context) => {
  validateQuantityUnit(value, context);
  value.allocations.forEach((allocation, index) => {
    if (allocation.uomCode !== value.uomCode) {
      context.addIssue({
        code: "custom",
        path: ["allocations", index, "uomCode"],
        message: "Supply unit must match the approved quantity unit.",
      });
    }
  });
});

export const decidePartRequestSchema = z.object({
  decision: z.enum(["approved", "rejected", "needs_info"]),
  partNumber: optionalText(200),
  manufacturer: optionalText(200),
  description: optionalText(1000),
  category: optionalText(200),
  quantity: quantitySchema,
  uomCode: uomCodeSchema,
  repairOrder: optionalText(2000),
  fitmentStatus: z.enum(["confirmed", "possible", "unknown", "conflict"]).default("unknown"),
  fitmentNotes: optionalText(2000),
  reason: optionalText(2000),
  allocations: z.array(partAllocationInputSchema).max(20).default([]),
}).superRefine((value, context) => {
  validateQuantityUnit(value, context);
  if (value.decision === "approved") {
    const allocated = value.allocations.reduce((sum, allocation) => sum + allocation.quantity, 0);
    if (!value.partNumber && !value.description) {
      context.addIssue({ code: "custom", path: ["partNumber"], message: "Add a part number or description before approval." });
    }
    if (value.fitmentStatus === "conflict") {
      context.addIssue({ code: "custom", path: ["fitmentStatus"], message: "A part with conflicting fitment cannot be approved." });
    }
    if (Math.abs(allocated - value.quantity) > 0.0005) {
      context.addIssue({ code: "custom", path: ["allocations"], message: "Supply quantities must equal the approved quantity." });
    }
    value.allocations.forEach((allocation, index) => {
      if (allocation.uomCode !== value.uomCode) {
        context.addIssue({
          code: "custom",
          path: ["allocations", index, "uomCode"],
          message: "Supply unit must match the approved quantity unit.",
        });
      }
    });
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
