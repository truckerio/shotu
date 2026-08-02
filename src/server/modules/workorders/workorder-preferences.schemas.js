import { z } from "zod";

export const workorderPreferencesSchema = z.object({
  defaultLocationId: z.string().uuid().nullable().optional(),
  defaultView: z.string().trim().min(1).max(80).optional(),
  pageSize: z.coerce.number().int().min(10).max(200).optional(),
  savedFilters: z.record(z.string(), z.unknown()).optional(),
  locale: z.enum(["en", "pa", "es"]).optional(),
});
