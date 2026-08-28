import { z } from "zod";

export const partRequestQueueQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  location: z.string().uuid().optional(),
  search: z.string().trim().max(200).default(""),
  status: z.enum(["requested", "approved", "ordered", "received", "declined", "cancelled"]).default(""),
  supply: z.enum(["available", "partial", "unavailable", "ordered"]).default(""),
  sort: z.enum(["waiting:desc", "activity:desc", "activity:asc", "created:desc"]).default("waiting:desc"),
}).strict();
