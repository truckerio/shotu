export const DEFAULT_COMPANY_ID = "00000000-0000-0000-0000-000000000001";

export function requireCompanyId(value) {
  const companyId = String(value || "").trim();
  if (!companyId) throw new Error("Company is required.");
  return companyId;
}
