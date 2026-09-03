const RANK = Object.freeze({ off: 0, read: 1, full: 2 });

export function productModuleMode(actor, moduleKey, locationId = "") {
  const companies = actor?.productModuleAccess?.companies || [];
  const modes = [];
  for (const company of companies) {
    if (locationId) {
      const location = (company.locations || []).find((entry) => entry.locationId === locationId);
      if (location?.modules?.[moduleKey]) modes.push(location.modules[moduleKey]);
      continue;
    }
    if (company.modules?.[moduleKey]) modes.push(company.modules[moduleKey]);
    for (const location of company.locations || []) {
      if (location.modules?.[moduleKey]) modes.push(location.modules[moduleKey]);
    }
  }
  return modes.reduce((best, mode) => (RANK[mode] || 0) > (RANK[best] || 0) ? mode : best, "off");
}

export function productModuleCapabilities(actor, moduleKey, locationId = "") {
  const mode = productModuleMode(actor, moduleKey, locationId);
  return { mode, canRead: mode === "read" || mode === "full", canWrite: mode === "full" };
}
