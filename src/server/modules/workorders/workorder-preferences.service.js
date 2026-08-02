import { requireActor, requireCompanyAccess, requireLocationAccess } from "../../auth/authorize.js";
import { resourceNotFound } from "../../auth/errors.js";
import { getLocationById } from "../../db/repositories/locations.repo.js";
import {
  getWorkorderPreferences,
  saveWorkorderPreferences,
} from "../../db/repositories/workorder-attention.repo.js";

export function presentWorkorderPreferences(row) {
  return {
    defaultLocationId: row?.default_location_id || null,
    defaultView: row?.default_view || "all",
    pageSize: row?.page_size || 50,
    savedFilters: row?.saved_filters || {},
    locale: row?.locale || "en",
    updatedAt: row?.updated_at || null,
  };
}

export async function loadWorkorderPreferences(context) {
  const actor = requireActor(context);
  return presentWorkorderPreferences(await getWorkorderPreferences(actor.id));
}

export async function updateWorkorderPreferences(context, input) {
  const actor = requireActor(context);
  if (input.defaultLocationId) {
    const location = await getLocationById(input.defaultLocationId);
    if (!location) throw resourceNotFound("Location");
    if (actor.role === "admin" && !context.companyIds?.has(location.company_id)) throw resourceNotFound("Location");
    requireCompanyAccess(context, location.company_id);
    requireLocationAccess(context, location.id);
  }
  return presentWorkorderPreferences(await saveWorkorderPreferences(actor.id, input));
}
