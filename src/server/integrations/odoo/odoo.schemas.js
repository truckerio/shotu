import { z } from "zod";

export const odooListSchema = z.object({
  status: z.enum(["pending", "missing_info", "entered"]).default("pending"),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  cursor: z.string().trim().max(2000).optional(),
});

export const odooWorkorderIdSchema = z.string().uuid("Workorder ID must be a valid UUID.");

const enteredResultSchema = z.object({
  status: z.literal("entered"),
  serviceOrderNo: z.string().trim().min(1).max(120),
  externalId: z.string().trim().min(1).max(300),
  note: z.string().trim().max(1000).default(""),
}).strict();

const missingInfoResultSchema = z.object({
  status: z.literal("missing_info"),
  note: z.string().trim().min(1).max(1000),
}).strict();

export const odooResultSchema = z.discriminatedUnion("status", [
  enteredResultSchema,
  missingInfoResultSchema,
]);
