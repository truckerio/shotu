import { z } from "zod";
import { quantitySchema, uomCodeSchema, validateQuantityUnit } from "./quantity-uom.js";

const optionalDate = z.string().date().optional().nullable().default(null);
const idempotencyKey = z.string().trim().min(8).max(120);

export const createPartFulfillmentSchema = z.object({
  workorderId: z.string().uuid(),
  catalogPartId: z.string().uuid(),
  destinationLocationId: z.string().uuid(),
  quantity: quantitySchema,
  uomCode: uomCodeSchema,
  neededBy: optionalDate,
  idempotencyKey,
}).strict().superRefine(validateQuantityUnit);

export const approvePartFulfillmentSchema = z.object({
  recommendationVersion: z.coerce.number().int().positive(),
  idempotencyKey,
}).strict();
