export function unitsFilters(search = "") {
  const params = new URLSearchParams(search);
  const type = params.get("unitType") || "";
  return {
    q: (params.get("unitSearch") || "").slice(0, 120),
    type: ["Truck", "Trailer"].includes(type) ? type : "",
  };
}

export function unitsDirectoryPath({ q = "", type = "" }, cursor = "") {
  const params = new URLSearchParams({ limit: "25" });
  if (q.trim()) params.set("q", q.trim());
  if (type) params.set("type", type);
  if (cursor) params.set("cursor", cursor);
  return `/api/vehicles/directory?${params}`;
}

export function unitsFilterUrl(href, filters) {
  const url = new URL(href);
  for (const [key, value] of [["unitSearch", filters.q], ["unitType", filters.type]]) {
    if (value) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

export function unitTitle(unit) {
  return [unit.unitType || "Unit", unit.unitNo || unit.name || "Unnumbered"].join(" ");
}
