import { z } from "zod";

export const receiveInvoiceSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(120),
}).strict();

export const resolveInventoryCodeSchema = z.object({
  code: z.string().trim().min(8).max(2000),
}).strict();
