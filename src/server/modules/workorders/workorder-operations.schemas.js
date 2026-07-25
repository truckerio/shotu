import { z } from "zod";

export const LIFECYCLE_STATUSES = ["open", "accepted", "in_progress", "mechanic_done", "closed", "odoo_entered"];
export const ATTENTION_REASONS = ["parts", "office_help", "missing_info", "overdue"];
export const OPERATIONS_CATEGORIES = ["needs_attention", "unassigned", "active", "parts", "ready_review", "odoo_backlog", "all"];

export const workorderOperationsQuerySchema = z.object({
  category: z.enum(OPERATIONS_CATEGORIES).default("all"),
  locationId: z.string().uuid().optional(),
  mechanicId: z.string().uuid().optional(),
  lifecycle: z.array(z.enum(LIFECYCLE_STATUSES)).default([]),
  attentionReason: z.enum(ATTENTION_REASONS).optional(),
  search: z.string().trim().max(160).default(""),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  sortBy: z.enum(["lastActivityAt", "createdAt", "age", "timeInStatus"]).default("lastActivityAt"),
  sortDirection: z.enum(["asc", "desc"]).default("desc"),
});

function commaValues(values) {
  return values.flatMap((value) => value.split(",")).map((value) => value.trim()).filter(Boolean);
}

export function parseWorkorderOperationsQuery(searchParams) {
  return workorderOperationsQuerySchema.parse({
    category: searchParams.get("category") || undefined,
    locationId: searchParams.get("locationId") || undefined,
    mechanicId: searchParams.get("mechanicId") || undefined,
    lifecycle: commaValues(searchParams.getAll("lifecycle")),
    attentionReason: searchParams.get("attentionReason") || undefined,
    search: searchParams.get("search") || undefined,
    page: searchParams.get("page") || undefined,
    pageSize: searchParams.get("pageSize") || undefined,
    sortBy: searchParams.get("sortBy") || undefined,
    sortDirection: searchParams.get("sortDirection") || undefined,
  });
}
