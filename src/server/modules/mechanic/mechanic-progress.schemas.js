import { z } from "zod";

export const mechanicProgressSchema = z.object({
  diagnosis: z.string().trim().max(5000).default(""),
  workPerformed: z.string().trim().max(5000).default(""),
  expectedVersion: z.number().int().positive(),
  recordActivity: z.boolean().default(false),
});
