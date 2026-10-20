import { z } from "zod";

export const laborProductListSchema = z.object({
  locationId: z.string().uuid(),
  q: z.string().trim().max(200).optional().default(""),
}).strict();

export const createLaborProductSchema = z.object({
  locationId: z.string().uuid(),
  name: z.string().trim().min(1).max(300),
  code: z.string().trim().max(100).optional().default(""),
  description: z.string().trim().max(2000).optional().default(""),
  uomCode: z.enum(["hr", "ea"]).optional().default("hr"),
}).strict();

export const pinLaborProductSchema = z.object({
  locationId: z.string().uuid(),
  pinned: z.boolean(),
}).strict();

export const laborProductRatesSchema = z.object({
  locationId: z.string().uuid(),
}).strict();

export const laborProductRateRevisionSchema = z.object({
  locationId: z.string().uuid(),
  priceKind: z.enum(["internal_cost", "selling_price"]),
  expectedVersion: z.number().int().min(0),
  amount: z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d{1,4})?$/).nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/).nullable(),
  reason: z.string().trim().min(2).max(500),
  idempotencyKey: z.string().trim().min(8).max(160),
}).strict();
