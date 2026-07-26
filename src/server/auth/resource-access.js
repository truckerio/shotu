import { getOperationalWorkorderById } from "../db/repositories/operational-workorders.repo.js";
import { requireActor } from "./authorize.js";
import { resourceNotFound } from "./errors.js";

const SURVEILLANCE_VISIBLE_STATUSES = new Set(["accepted", "in_progress", "mechanic_done", "closed", "odoo_entered"]);

export async function requireWorkorderAccess(context, workorderId, options = {}) {
  const actor = requireActor(context);
  const getWorkorder = options.getWorkorder || getOperationalWorkorderById;
  const workorder = await getWorkorder(workorderId);
  if (!workorder) throw resourceNotFound("Workorder");

  if (!context.companyIds?.has(workorder.companyId)) throw resourceNotFound("Workorder");

  if (actor.role !== "admin") {
    if (context.locationIds?.size && workorder.locationId && !context.locationIds.has(workorder.locationId)) {
      throw resourceNotFound("Workorder");
    }
  }

  if (actor.role === "mechanic") {
    const assigned = workorder.mechanicIds?.includes(actor.id);
    const available = options.allowAvailable
      && workorder.status === "open"
      && !workorder.mechanicIds?.length;
    if (!assigned && !available) throw resourceNotFound("Workorder");
  }

  if (actor.role === "surveillance" && !SURVEILLANCE_VISIBLE_STATUSES.has(workorder.status)) {
    throw resourceNotFound("Workorder");
  }

  return workorder;
}
