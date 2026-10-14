import { requireActor } from "../../auth/authorize.js";
import { companyRoleScope, effectiveCompanyRole } from "../../auth/company-role.js";
import { resourceNotFound } from "../../auth/errors.js";
import { getLocationById } from "../../db/repositories/locations.repo.js";
import {
  queryOperationalWorkorders,
  summarizeOperationalWorkorders,
} from "../../db/repositories/operational-workorders.repo.js";
import {
  authorizeProductModule,
  resolveProductModuleQueryScope,
} from "../access/product-module-access.service.js";

const DENIED_SCOPE_ID = "00000000-0000-0000-0000-000000000000";

function actorScope(context, input, location, productScope = null) {
  const actor = requireActor(context);
  const companyIds = productScope?.companyIds?.length
    ? productScope.companyIds
    : (productScope ? [DENIED_SCOPE_ID] : companyRoleScope(context).companyIds);
  const assignedLocationIds = [...(context.locationIds || [])];
  if (!companyIds.length) companyIds.push(DENIED_SCOPE_ID);

  let locationIds;
  if (input.locationId) {
    const companyAllowed = companyIds.includes(location.company_id);
    const locationAllowed = effectiveCompanyRole(context, location.company_id) === "admin"
      ? companyAllowed
      : assignedLocationIds.includes(location.id) && companyAllowed;
    if (!locationAllowed) throw resourceNotFound("Location");
    locationIds = [location.id];
  } else {
    locationIds = productScope?.locationIds || assignedLocationIds;
    if (!locationIds.length) locationIds = [DENIED_SCOPE_ID];
  }

  const scopedCompanyIds = new Set(companyIds);
  const mechanicCompanyIds = companyRoleScope(context, ["mechanic"]).companyIds.filter((id) => scopedCompanyIds.has(id));
  const surveillanceCompanyIds = companyRoleScope(context, ["surveillance"]).companyIds.filter((id) => scopedCompanyIds.has(id));

  return {
    ...input,
    actorUserId: actor.id,
    viewerUserId: actor.id,
    companyIds,
    locationIds,
    mechanicCompanyIds,
    surveillanceCompanyIds,
    visibility: mechanicCompanyIds.length === companyIds.length
      ? "mechanic"
      : surveillanceCompanyIds.length === companyIds.length ? "surveillance" : "operations",
  };
}

async function authorizedOptions(context, input, dependencies) {
  const location = input.locationId ? await dependencies.getLocation(input.locationId) : null;
  if (input.locationId && !location) throw resourceNotFound("Location");
  if (input.locationId) {
    await dependencies.authorizeProduct(context, {
      companyId: location.company_id,
      locationId: location.id,
      moduleKey: "workorders",
    }, "read");
    return actorScope(context, input, location);
  }
  const productScope = await dependencies.resolveProductScope(context, {
    moduleKey: "workorders",
    capability: "read",
  });
  if (!productScope.locationIds.length) productScope.locationIds = [DENIED_SCOPE_ID];
  return actorScope(context, input, location, productScope);
}

export async function queryAuthorizedWorkorders(context, input, dependencies = {}) {
  const deps = {
    getLocation: dependencies.getLocation || getLocationById,
    queryWorkorders: dependencies.queryWorkorders || queryOperationalWorkorders,
    authorizeProduct: dependencies.authorizeProduct || authorizeProductModule,
    resolveProductScope: dependencies.resolveProductScope || resolveProductModuleQueryScope,
  };
  return deps.queryWorkorders(await authorizedOptions(context, input, deps));
}

export async function summarizeAuthorizedWorkorders(context, input, dependencies = {}) {
  const deps = {
    getLocation: dependencies.getLocation || getLocationById,
    summarizeWorkorders: dependencies.summarizeWorkorders || summarizeOperationalWorkorders,
    authorizeProduct: dependencies.authorizeProduct || authorizeProductModule,
    resolveProductScope: dependencies.resolveProductScope || resolveProductModuleQueryScope,
  };
  return deps.summarizeWorkorders(await authorizedOptions(context, input, deps));
}
