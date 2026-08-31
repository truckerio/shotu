import { z } from "zod";

const idempotencyKey = z.string().trim().min(8).max(120);
export const inventoryWorkorderEntityIdSchema = z.string().uuid();

export const resolveWorkorderInventoryUnitSchema = z.object({
  code: z.string().trim().min(8).max(2000),
}).strict();

export const issueWorkorderInventoryUnitSchema = z.union([
  z.object({ code: z.string().trim().min(8).max(2000), idempotencyKey }).strict(),
  z.object({ unitId: inventoryWorkorderEntityIdSchema, idempotencyKey }).strict(),
]);

export const listWorkorderInventoryUnitsSchema = z.object({
  catalogPartId: inventoryWorkorderEntityIdSchema,
  q: z.string().trim().max(120).optional().default(""),
  after: z.string().trim().max(200).optional().default(""),
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
}).strict();

export const createWorkorderInventoryUnitsSchema = z.object({
  catalogPartId: inventoryWorkorderEntityIdSchema,
  quantity: z.coerce.number().int().min(1).max(25),
  confirmation: z.literal("physically_present_at_location"),
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
