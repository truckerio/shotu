export const UNIT_DIRECTORY_SECTIONS = Object.freeze([
  { key: "trucks", type: "Truck", label: "Trucks", singular: "Truck" },
  { key: "trailers", type: "Trailer", label: "Trailers", singular: "Trailer" },
  { key: "other", type: "Other", label: "Other equipment", singular: "Equipment" },
]);
const ALL_UNITS_SECTION = Object.freeze({ key: "all", type: "", label: "Units", singular: "Unit" });
export const UNIT_REPAIR_FILTERS = Object.freeze(["all", "under_repair", "available"]);
export const UNIT_SORTS = Object.freeze(["unit_asc", "unit_desc", "tags_asc", "repair_first"]);

export function unitsDirectorySection(value = "") {
  if (value === "all") return ALL_UNITS_SECTION;
  return UNIT_DIRECTORY_SECTIONS.find((section) => section.key === value || section.type === value) || UNIT_DIRECTORY_SECTIONS[0];
}

export function unitsDirectorySectionFromSearch(search = "") {
  return unitsDirectorySection(new URLSearchParams(search).get("unitType") || "");
}

export function unitsFilters(search = "") {
  const params = new URLSearchParams(search);
  const type = params.get("unitType") || "";
  const repair = params.get("unitRepair") || "all";
  const sort = params.get("unitSort") || "unit_asc";
  return {
    q: (params.get("unitSearch") || "").slice(0, 120),
    type: ["Truck", "Trailer", "Other"].includes(type) ? type : "",
    companyTag: (params.get("unitCompanyTag") || "").slice(0, 120),
    routeTag: (params.get("unitRouteTag") || "").slice(0, 120),
    repair: UNIT_REPAIR_FILTERS.includes(repair) ? repair : "all",
    sort: UNIT_SORTS.includes(sort) ? sort : "unit_asc",
  };
}

export function unitsDirectoryPath({ q = "", type = "", companyTag = "", routeTag = "", repair = "all", sort = "unit_asc", page }, cursor = "") {
  const params = new URLSearchParams({ limit: "25" });
  if (q.trim()) params.set("q", q.trim());
  if (type) params.set("type", type);
  if (companyTag) params.set("companyTag", companyTag);
  if (routeTag) params.set("routeTag", routeTag);
  if (repair !== "all") params.set("repair", repair);
  if (sort !== "unit_asc") params.set("sort", sort);
  if (cursor) params.set("cursor", cursor);
  else if (page) params.set("page", String(page));
  return `/api/vehicles/directory?${params}`;
}

export function unitsDirectoryFiltersPath(type = "") {
  const params = new URLSearchParams();
  if (type) params.set("type", type);
  return `/api/vehicles/directory/filters${params.size ? `?${params}` : ""}`;
}

export function unitsFilterUrl(href, filters) {
  const url = new URL(href);
  for (const [key, value, defaultValue = ""] of [
    ["unitSearch", filters.q],
    ["unitType", filters.type],
    ["unitCompanyTag", filters.companyTag],
    ["unitRouteTag", filters.routeTag],
    ["unitRepair", filters.repair, "all"],
    ["unitSort", filters.sort, "unit_asc"],
  ]) {
    if (value && value !== defaultValue) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

export function unitTitle(unit) {
  return [unit.unitType || "Unit", unit.unitNo || unit.name || "Unnumbered"].join(" ");
}
