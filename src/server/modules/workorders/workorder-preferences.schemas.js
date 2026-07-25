import { z } from "zod";

export const workorderPreferencesSchema = z.object({
  defaultLocationId: z.string().uuid().nullable().optional(),
  defaultView: z.string().trim().min(1).max(80).default("all"),
  pageSize: z.coerce.number().int().min(10).max(200).default(50),
  savedFilters: z.record(z.string(), z.unknown()).default({}),
});
