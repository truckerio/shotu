export function commercialProfileSetupUrl(companyId, locationId = "") {
  const params = new URLSearchParams({ adminView: "settings", settingsTab: "commercial", commercialCompany: companyId });
  if (locationId) params.set("commercialLocation", locationId);
  return `/?${params}`;
}

export function commercialProfileInitialScope(locations = [], search = "") {
  const params = new URLSearchParams(search);
  const companyOf = (location) => location.company_id || location.companyId;
  const locationOf = (location) => location.id || location.location?.id;
  const requestedCompany = params.get("commercialCompany");
  const companyAllowed = locations.some((location) => companyOf(location) === requestedCompany);
  const companyId = companyAllowed ? requestedCompany : locations.map(companyOf).find(Boolean) || "";
  const requestedLocation = params.get("commercialLocation");
  const locationId = companyAllowed && locations.some((location) => companyOf(location) === companyId && locationOf(location) === requestedLocation)
    ? requestedLocation : "";
  return { companyId, locationId };
}
