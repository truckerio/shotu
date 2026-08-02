import { getAuthorizedLocationTemplates } from "../../db/repositories/templates.repo.js";

export function officeTemplateScope(context) {
  const companyIds = [...(context?.companyIds || [])];
  if (!context?.actor || !companyIds.length) return null;

  if (context.actor.role === "admin") {
    return { companyIds, locationIds: null };
  }

  const locationIds = [...(context.locationIds || [])];
  if (!locationIds.length) return null;
  return { companyIds, locationIds };
}

export async function loadOfficeLocationTemplates(context, dependencies = {}) {
  const scope = officeTemplateScope(context);
  if (!scope) return [];
  const listTemplates = dependencies.listTemplates || getAuthorizedLocationTemplates;
  return listTemplates(scope);
}
