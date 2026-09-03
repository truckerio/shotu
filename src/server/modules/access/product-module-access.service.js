import { permissionDenied, resourceNotFound } from "../../auth/errors.js";
import { requireActor, requireCompanyAccess } from "../../auth/authorize.js";
import { getLocationById } from "../../db/repositories/locations.repo.js";
import {
  listProductAccessLocations,
  listProductModuleAccessRules,
  saveProductModuleAccessRule,
} from "../../db/repositories/product-module-access.repo.js";
import {
  PRODUCT_MODULES,
  modeAllows,
  resolveProductModuleMode,
} from "../../../../shared/product-modules.js";

function rulesFor(rules, companyId, locationId) {
  return rules.filter((rule) => rule.companyId === companyId && rule.locationId === locationId);
}

export async function resolveProductModuleAccess(context, { companyId, locationId = null, moduleKey }, dependencies = {}) {
  const actor = requireActor(context);
  if (!context.companyIds?.has(companyId)) throw resourceNotFound("Module");
  const role = context.companyRoles?.get(companyId);
  if (!role) throw resourceNotFound("Module");
  if (locationId && role !== "admin" && !context.locationIds?.has(locationId)) throw resourceNotFound("Module");
  const listRules = dependencies.listRules || listProductModuleAccessRules;
  const rules = await listRules({ companyIds: [companyId], locationIds: locationId ? [locationId] : [] });
  return {
    companyId,
    locationId,
    moduleKey,
    role,
    ...resolveProductModuleMode({
      moduleKey, role, userId: actor.id,
      companyRules: rulesFor(rules, companyId, null),
      locationRules: locationId ? rulesFor(rules, companyId, locationId) : [],
    }),
  };
}

export async function authorizeProductModule(context, scope, capability = "read", dependencies = {}) {
  const decision = await resolveProductModuleAccess(context, scope, dependencies);
  if (!modeAllows(decision.mode, capability)) throw permissionDenied();
  return decision;
}

export async function resolveProductModuleQueryScope(
  context,
  { moduleKey, capability = "read" },
  dependencies = {},
) {
  const bootstrap = await productModuleBootstrap(context, dependencies);
  const companyIds = [];
  const locationIds = [];
  for (const company of bootstrap.companies) {
    const allowedLocations = company.locations
      .filter((location) => modeAllows(location.modules[moduleKey], capability));
    if (modeAllows(company.modules[moduleKey], capability) || allowedLocations.length) {
      companyIds.push(company.companyId);
    }
    locationIds.push(...allowedLocations.map((location) => location.locationId));
  }
  return { companyIds, locationIds };
}

export async function requireAdminProductModuleScope(
  context,
  companyId,
  locationId = null,
  dependencies = {},
) {
  requireCompanyAccess(context, companyId);
  if (context.companyRoles?.get(companyId) !== "admin") throw permissionDenied();
  if (!locationId) return { companyId, locationId: null };
  const getLocation = dependencies.getLocation || getLocationById;
  const location = await getLocation(locationId, [companyId]);
  if (!location || location.company_id !== companyId) throw resourceNotFound("Location");
  return { companyId, locationId };
}

export async function productModuleBootstrap(context, dependencies = {}) {
  const actor = requireActor(context);
  const companyIds = [...(context.companyIds || [])];
  const listRules = dependencies.listRules || listProductModuleAccessRules;
  const listLocations = dependencies.listLocations || listProductAccessLocations;
  const locationFilter = companyIds.some((companyId) => context.companyRoles?.get(companyId) === "admin")
    ? null : [...(context.locationIds || [])];
  const [rules, locationGroups] = await Promise.all([
    listRules({ companyIds, locationIds: locationFilter }),
    Promise.all(companyIds.map((companyId) => listLocations({
      companyIds: [companyId],
      locationIds: context.companyRoles?.get(companyId) === "admin" ? null : [...(context.locationIds || [])],
    }))),
  ]);
  const locations = locationGroups.flat();
  const modulesAt = (companyId, locationId) => Object.fromEntries(PRODUCT_MODULES.map((module) => [
    module.key,
    resolveProductModuleMode({
      moduleKey: module.key,
      role: context.companyRoles?.get(companyId),
      userId: actor.id,
      companyRules: rulesFor(rules, companyId, null),
      locationRules: locationId ? rulesFor(rules, companyId, locationId) : [],
    }).mode,
  ]));
  return {
    version: 1,
    companies: companyIds.filter((companyId) => context.companyRoles?.has(companyId)).map((companyId) => ({
      companyId,
      role: context.companyRoles.get(companyId),
      modules: modulesAt(companyId, null),
      locations: locations.filter((location) => location.companyId === companyId).map((location) => ({
        locationId: location.locationId,
        modules: modulesAt(companyId, location.locationId),
      })),
    })),
  };
}

export async function patchProductModuleAccess(context, input, dependencies = {}) {
  const actor = requireActor(context);
  await requireAdminProductModuleScope(context, input.companyId, input.locationId || null, dependencies);
  const save = dependencies.save || saveProductModuleAccessRule;
  return save({ ...input, actorId: actor.id });
}
