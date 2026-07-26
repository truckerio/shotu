export const DEFAULT_COMPANY_ID = "00000000-0000-0000-0000-000000000001";
export const DATABASE_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requireCompanyId(value) {
  const companyId = String(value || "").trim();
  if (!companyId) throw new Error("Company is required.");
  return companyId;
}
