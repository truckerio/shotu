import { z } from "zod";

export const mechanicProgressSchema = z.object({
  diagnosis: z.string().trim().max(5000).default(""),
  workPerformed: z.string().trim().max(5000).default(""),
  laborHours: z.union([
    z.literal(""),
    z.number().positive().max(9999),
    z.string().trim()
      .regex(/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/, "Labor hours must be positive with at most two decimals.")
      .refine((value) => Number(value) > 0 && Number(value) <= 9999, "Labor hours must be greater than zero and within the supported range."),
  ]).optional().transform((value) => value === undefined || value === "" ? value : String(Number(value))),
  expectedVersion: z.number().int().positive(),
  recordActivity: z.boolean().default(false),
});
