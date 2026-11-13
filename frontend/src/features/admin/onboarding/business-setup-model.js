export const BUSINESS_MODES = [
  { id: "fleet_only", label: "Our own fleet" },
  { id: "customer_repairs", label: "Outside customers" },
  { id: "both", label: "Both" },
];

export function setupDraft(data) {
  return {
    operatingMode: data.setup?.operatingMode || "",
    shopIdentity: { legalName: "", address: "", phone: "", email: "", ...(data.setup?.shopIdentity || data.defaults) },
  };
}

export function usesCustomerBilling(mode) {
  return mode === "customer_repairs" || mode === "both";
}

export function businessSetupUrl(companyId = "", locationId = "") {
  const params = new URLSearchParams({ adminView: "settings", settingsTab: "business" });
  if (companyId) params.set("commercialCompany", companyId);
  if (locationId) params.set("commercialLocation", locationId);
  return `/?${params}`;
}
