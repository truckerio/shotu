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
}).strict();

export const pinLaborProductSchema = z.object({
  locationId: z.string().uuid(),
  pinned: z.boolean(),
}).strict();
