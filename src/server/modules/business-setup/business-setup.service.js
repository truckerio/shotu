import { requireCompanyAccess, requireLocationAccess } from "../../auth/authorize.js";
import { requireCompanyRole } from "../../auth/company-role.js";
import { resourceNotFound } from "../../auth/errors.js";
import { getLocationById } from "../../db/repositories/locations.repo.js";
import { getCustomerDocumentProfileForScope } from "../../db/repositories/customer-documents.repo.js";
import * as repository from "../../db/repositories/business-setup.repo.js";

const categories = ["labor", "part", "shop_supply", "fee", "core_charge", "credit"];
const treatments = new Set(["exclusive", "inclusive", "zero_rated", "exempt", "out_of_scope"]);
export function billingForProfile(profile) {
  const policy = profile?.lineTaxPolicy || {};
  const ready = !!profile && !profile.informationalOnly && !!profile.taxProfileVersionId &&
    profile.taxState === "active" && !!profile.defaultCurrency && profile.taxCurrency === profile.defaultCurrency &&
    categories.every((key) => treatments.has(policy[key]) && (key !== "credit" || !["exclusive", "inclusive"].includes(policy[key])));
  return { ready, profileVersionId: profile?.id || null, scope: profile ? (profile.locationId ? "location" : "company") : null };
}
async function authorize(context, input, dependencies) {
  requireCompanyAccess(context, input.companyId);
  requireCompanyRole(context, input.companyId, ["admin"]);
  if (input.locationId) {
    const location = await (dependencies.getLocation || getLocationById)(input.locationId, [input.companyId]);
    if (!location || (location.company_id || location.companyId) !== input.companyId) throw resourceNotFound("Location");
    requireLocationAccess(context, input.locationId, input.companyId);
  }
}
async function response(input, setup, dependencies) {
  const [base, profile] = await Promise.all([
    (dependencies.getDefaults || repository.getBusinessSetupDefaults)(input.companyId, input.locationId),
    (dependencies.getProfile || getCustomerDocumentProfileForScope)({ companyId: input.companyId, locationId: input.locationId || null }),
  ]);
  if (!base) throw resourceNotFound("Company");
  const identity = profile?.shopIdentity || {};
  return { setup, defaults: { legalName: identity.legalName || base.name || "", address: identity.address || base.address || "", phone: identity.phone || "", email: identity.email || "" }, billing: billingForProfile(profile) };
}
export async function readBusinessSetup(context, input, dependencies = {}) {
  await authorize(context, input, dependencies);
  return response(input, await (dependencies.getSetup || repository.getBusinessSetup)(input.companyId), dependencies);
}
export async function writeBusinessSetup(context, input, dependencies = {}) {
  await authorize(context, input, dependencies);
  // Confirm the company exists before persisting and before evaluating the response.
  const base = await (dependencies.getDefaults || repository.getBusinessSetupDefaults)(input.companyId, input.locationId);
  if (!base) throw resourceNotFound("Company");
  const setup = await (dependencies.saveSetup || repository.saveBusinessSetup)(input, context.actor.id);
  return response(input, setup, { ...dependencies, getDefaults: async () => base });
}
