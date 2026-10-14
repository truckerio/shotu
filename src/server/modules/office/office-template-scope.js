import { getAuthorizedLocationTemplates } from "../../db/repositories/templates.repo.js";
import { companyRoleScope } from "../../auth/company-role.js";

export function officeTemplateScope(context) {
  const { companyIds, adminCompanyIds, locationIds } = companyRoleScope(context, ["office", "admin"]);
  if (!context?.actor || !companyIds.length) return null;
  if (adminCompanyIds.length === companyIds.length) return { companyIds, locationIds: null };
  if (adminCompanyIds.length) return null; // Mixed roles require two separate queries.
  if (!locationIds.length) return null;
  return { companyIds, locationIds };
}

export async function loadOfficeLocationTemplates(context, dependencies = {}) {
  const { companyIds, adminCompanyIds, locationIds } = companyRoleScope(context, ["office", "admin"]);
  if (adminCompanyIds.length && adminCompanyIds.length !== companyIds.length) {
    const listTemplates = dependencies.listTemplates || getAuthorizedLocationTemplates;
    const officeCompanyIds = companyIds.filter((id) => !adminCompanyIds.includes(id));
    const [adminRows, officeRows] = await Promise.all([
      listTemplates({ companyIds: adminCompanyIds, locationIds: null }),
      locationIds.length ? listTemplates({ companyIds: officeCompanyIds, locationIds }) : [],
    ]);
    return [...adminRows, ...officeRows];
  }
  const scope = officeTemplateScope(context);
  if (!scope) return [];
  const listTemplates = dependencies.listTemplates || getAuthorizedLocationTemplates;
  return listTemplates(scope);
}
