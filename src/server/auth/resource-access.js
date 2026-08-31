import { getOperationalWorkorderById } from "../db/repositories/operational-workorders.repo.js";
import { requireActor } from "./authorize.js";
import { resourceNotFound } from "./errors.js";
import { SURVEILLANCE_VISIBLE_LIFECYCLES } from "../modules/workorders/workorder-lifecycle-policy.js";

const SURVEILLANCE_VISIBLE_STATUSES = new Set(SURVEILLANCE_VISIBLE_LIFECYCLES);

export async function requireWorkorderAccess(context, workorderId, options = {}) {
  const actor = requireActor(context);
  const getWorkorder = options.getWorkorder || getOperationalWorkorderById;
  const workorder = await getWorkorder(workorderId);
  if (!workorder) throw resourceNotFound("Workorder");

  if (!context.companyIds?.has(workorder.companyId)) throw resourceNotFound("Workorder");

  if (actor.role !== "admin") {
    const requireLocationMembership = options.requireLocationMembership === true;
    const lacksRequiredLocation = requireLocationMembership
      && (!workorder.locationId || !context.locationIds?.has(workorder.locationId));
    if (lacksRequiredLocation
      || (context.locationIds?.size && workorder.locationId && !context.locationIds.has(workorder.locationId))) {
      throw resourceNotFound("Workorder");
    }
  }

  if (actor.role === "mechanic") {
    const assigned = workorder.mechanicIds?.includes(actor.id);
    const available = options.allowAvailable
      && workorder.status === "open"
      && !workorder.mechanicIds?.length;
    const activeAtLocation = options.allowActiveAtLocation
      && ["accepted", "in_progress"].includes(workorder.status);
    if (!assigned && !available && !activeAtLocation) throw resourceNotFound("Workorder");
  }

  if (actor.role === "surveillance" && !SURVEILLANCE_VISIBLE_STATUSES.has(workorder.status)) {
    throw resourceNotFound("Workorder");
  }

  return workorder;
}
