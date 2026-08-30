import { z } from "zod";

const idempotencyKey = z.string().trim().min(8).max(120);
export const inventoryWorkorderEntityIdSchema = z.string().uuid();

export const resolveWorkorderInventoryUnitSchema = z.object({
  code: z.string().trim().min(8).max(2000),
}).strict();

export const issueWorkorderInventoryUnitSchema = z.object({
  code: z.string().trim().min(8).max(2000),
  idempotencyKey,
}).strict();

export const finalizeWorkorderInventoryUnitSchema = z.object({
  disposition: z.enum(["installed", "returned", "removed"]),
  idempotencyKey,
}).strict();

export const updateSerializedUsageRepairOrderSchema = z.object({
  operation: z.literal("serializedUsageRepairOrder"),
  usageId: inventoryWorkorderEntityIdSchema,
  repairOrder: z.string().trim().max(2000),
}).strict();
