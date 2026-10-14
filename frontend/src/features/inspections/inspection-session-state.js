const PREFIX = "workorder-generator.inspections.";
const SESSION_VERSION = 2;

export function normalizeInspectionFilters(value = {}) {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return {
    locationId: uuid.test(value?.locationId || "") ? value.locationId : "",
    mechanicId: uuid.test(value?.mechanicId || "") ? value.mechanicId : "",
    unitType: ["Truck", "Trailer"].includes(value?.unitType) ? value.unitType : "",
    result: ["passed", "issues_found", "out_of_service"].includes(value?.result) ? value.result : "",
    sort: value?.sort === "updated_asc" ? "updated_asc" : "updated_desc",
  };
}

export function inspectionSessionKey(projection = "office") { return `${PREFIX}${projection}`; }

export function readInspectionSession(projection) {
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(inspectionSessionKey(projection)) || "{}");
    const current = parsed.version === SESSION_VERSION;
    return { search: current && typeof parsed.search === "string" ? parsed.search : "", status: current && typeof parsed.status === "string" ? parsed.status : "", filters: normalizeInspectionFilters(current ? parsed.filters : {}), activeId: current && typeof parsed.activeId === "string" ? parsed.activeId : "", scrollY: current && Number.isFinite(parsed.scrollY) ? parsed.scrollY : 0 };
  } catch { return { search: "", status: "", filters: normalizeInspectionFilters(), activeId: "", scrollY: 0 }; }
}

export function writeInspectionSession(projection, value = {}) {
  try { window.sessionStorage.setItem(inspectionSessionKey(projection), JSON.stringify({ version:SESSION_VERSION, search: value.search || "", status: value.status || "", filters: normalizeInspectionFilters(value.filters), activeId: value.activeId || "", scrollY: Number(value.scrollY) || 0 })); } catch { /* Private browsing storage may be unavailable. */ }
}
