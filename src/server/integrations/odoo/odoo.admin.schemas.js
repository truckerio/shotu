import { z } from "zod";

export const odooConfigurationSchema = z.object({
  baseUrl: z.string().trim().url().max(500),
  database: z.string().trim().min(1).max(200),
  username: z.string().trim().min(1).max(320),
  apiKey: z.string().trim().min(8).max(1000),
}).strict();

export const odooLocationMappingSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("mapped"), locationId: z.string().uuid() }).strict(),
  z.object({ status: z.literal("unmatched") }).strict(),
  z.object({ status: z.literal("ignored") }).strict(),
]);
