import { invalidRequest } from "../auth/errors.js";
import { requireCompanyRole } from "../auth/company-role.js";

// This legacy endpoint changes print settings for an existing tenant; it is not
// a company-provisioning API. Resolve authority before entering the ledger lock.
export function authorizeCompanySettings(context, input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw invalidRequest("Company settings must be an object.");
  const companyId = String(input.companyId || "").trim();
  if (!companyId) throw invalidRequest("Select an existing company before changing print settings.");
  requireCompanyRole(context, companyId, ["admin"]);
  return { ...input, companyId };
}
