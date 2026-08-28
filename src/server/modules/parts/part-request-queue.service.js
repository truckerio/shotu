import { requireActor } from "../../auth/authorize.js";
import { permissionDenied } from "../../auth/errors.js";
import { listUnresolvedPartRequestQueue } from "../../db/repositories/part-request-queue.repo.js";
import { partRequestQueueQuerySchema } from "./part-request-queue.schemas.js";

function requestState(row) {
  if (row.approvalStatus === "submitted") return { state: "submitted", nextAction: "Review request" };
  if (row.approvalStatus === "needs_info") return { state: "needs_info", nextAction: "Await mechanic details" };
  return { state: "approved_pending_supply", nextAction: "Supply or issue remaining quantity" };
}

export async function loadUnresolvedPartRequestQueue(rawInput, context, dependencies = {}) {
  const input = partRequestQueueQuerySchema.parse(rawInput);
  const actor = requireActor(context);
  if (!["office", "admin"].includes(actor.role)) throw permissionDenied();
  const companyIds = [...(context.companyIds || [])];
  const locationIds = [...(context.locationIds || [])];
  const isAdmin = actor.role === "admin";

  if (!companyIds.length || (!isAdmin && (!locationIds.length || (input.location && !locationIds.includes(input.location))))) {
    return { items: [], total: 0, page: input.page, pageSize: input.pageSize, pageCount: 1 };
  }

  const queue = await (dependencies.listQueue || listUnresolvedPartRequestQueue)({
    companyIds,
    locationIds,
    isAdmin,
    page: input.page,
    pageSize: input.pageSize,
    locationId: input.location || null,
    search: input.search,
    status: input.status,
    supply: input.supply,
    sort: input.sort,
  });
  return {
    items: queue.items.map((row) => ({ ...row, ...requestState(row) })),
    total: queue.total,
    page: input.page,
    pageSize: input.pageSize,
    pageCount: Math.max(1, Math.ceil(queue.total / input.pageSize)),
  };
}
