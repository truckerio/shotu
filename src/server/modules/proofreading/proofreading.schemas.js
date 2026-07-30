import { z } from "zod";

export const proofreadingRequestSchema = z.object({
  language: z.enum(["en-US", "en-CA", "en-GB"]).default("en-US"),
  text: z.string()
    .max(5_000)
    .refine((value) => value.trim().length >= 3, "Enter at least three characters."),
}).strict();
