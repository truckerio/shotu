import { z } from "zod";

export const proofreadingRequestSchema = z.object({
  companyId: z.uuid().optional(),
  language: z.enum(["en-US", "en-CA", "en-GB"]).default("en-US"),
  mode: z.enum(["fast", "deep"]).default("fast"),
  text: z.string()
    .max(5_000)
    .refine((value) => value.trim().length >= 3, "Enter at least three characters."),
}).strict();

export const proofreadingDictionaryMutationSchema = z.object({
  companyId: z.uuid().optional(),
  scope: z.enum(["personal", "company"]).default("personal"),
  term: z.string().min(2).max(64),
}).strict();
