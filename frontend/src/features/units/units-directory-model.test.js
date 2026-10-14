import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { unitsDirectoryFiltersPath, unitsDirectorySection, unitsDirectorySectionFromSearch, unitsFilters, unitsDirectoryPath, unitsFilterUrl, unitTitle } from "./units-directory-model.js";

const emptyFilters = { q: "", type: "", companyTag: "", routeTag: "", repair: "all", sort: "unit_asc" };

test("directory starts browseable with no query and bounded pages", () => {
  assert.deepEqual(unitsFilters(), emptyFilters);
  assert.equal(unitsDirectoryPath({}), "/api/vehicles/directory?limit=25");
  assert.equal(unitsDirectoryPath({ page: 3 }), "/api/vehicles/directory?limit=25&page=3");
  assert.equal(unitsDirectoryFiltersPath("Truck"), "/api/vehicles/directory/filters?type=Truck");
});
test("filters restore safely and drop invalid types", () => {
  assert.deepEqual(unitsFilters("?unitSearch=402&unitType=Truck"), { ...emptyFilters, q: "402", type: "Truck" });
  assert.equal(unitsFilters("?unitType=Other").type, "Other");
  assert.equal(unitsFilters("?unitType=wrong").type, "");
  assert.equal(unitsFilters("?unitRepair=broken").repair, "all");
  assert.equal(unitsFilters("?unitSort=provider_payload").sort, "unit_asc");
  assert.equal(unitsFilters(`?unitSearch=${"x".repeat(200)}`).q.length, 120);
});
test("Samsara tag and repair filters round-trip through bounded API and URL owners", () => {
  const filters = { q: "", type: "Truck", companyTag: "SPG Transportation Inc", routeTag: "CA Local/Regional", repair: "under_repair", sort: "repair_first" };
  const path = new URL(unitsDirectoryPath({ ...filters, page: 2 }), "https://example.test");
  assert.equal(path.searchParams.get("companyTag"), filters.companyTag);
  assert.equal(path.searchParams.get("routeTag"), filters.routeTag);
  assert.equal(path.searchParams.get("repair"), "under_repair");
  assert.equal(path.searchParams.get("sort"), "repair_first");
  const url = unitsFilterUrl("https://example.test/?adminView=units", filters);
  assert.deepEqual(unitsFilters(url), filters);
});
test("directory sections provide specific truck, trailer, and other-equipment pages", () => {
  assert.deepEqual(["trucks", "trailers", "other"].map((key) => unitsDirectorySection(key).label), ["Trucks", "Trailers", "Other equipment"]);
  assert.equal(unitsDirectorySectionFromSearch("?adminView=units&unitType=Trailer").key, "trailers");
  assert.equal(unitsDirectorySectionFromSearch("?adminView=units&unitType=Other").key, "other");
  assert.equal(unitsDirectorySection("unsupported").key, "trucks");
  assert.equal(unitsDirectorySection("all").label, "Units");
});
test("queries and cursors cannot introduce arbitrary query parameters", () => {
  const url = new URL(unitsDirectoryPath({ q: "  402&companyId=other  ", type: "Truck" }, "a+b="), "https://example.test");
  assert.equal(url.searchParams.get("q"), "402&companyId=other");
  assert.equal(url.searchParams.has("companyId"), false);
  assert.equal(url.searchParams.get("cursor"), "a+b=");
  assert.equal(url.searchParams.has("page"), false);
});
test("workspace uses exact checkpoint pages without cursor-derived totals", () => {
  const source = readFileSync(new URL("./UnitsWorkspace.jsx", import.meta.url), "utf8");
  assert.match(source, /useCheckpointPages\(\{/);
  assert.match(source, /unitsDirectoryPath\(\{ \.\.\.filters, page: nextPage \}\)/);
  assert.match(source, /<CheckpointCollection/);
  assert.match(source, /<OperationalCollectionRow \{\.\.\.rowProps\}/);
  assert.doesNotMatch(source, /cursorStack|total=\{0\}|className="units-pagination"/);
});
test("workspace exposes Samsara tag facets and repair state without relying on color alone", () => {
  const source = readFileSync(new URL("./UnitsWorkspace.jsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("./units-workspace.css", import.meta.url), "utf8");
  assert.match(source, /unitsDirectoryFiltersPath\(filters\.type\)/);
  assert.match(source, /aria-label="Company"/);
  assert.match(source, /aria-label="Route tag"/);
  assert.match(source, /<OperationalCollectionCell label="Tags">/);
  assert.match(source, /className="units-repair-badge">\{repairLabel\}/);
  assert.match(source, /unit\.activeWorkorder \? "units-row is-under-repair"/);
  assert.match(source, /Under repair first/);
  assert.match(css, /\.units-row\.is-under-repair\s*\{[^}]*background:[^}]*box-shadow:/);
  assert.match(css, /\.units-repair-badge\s*\{/);
});
test("filter changes preserve host navigation and clear only owned filters", () => {
  assert.equal(unitsFilterUrl("https://example.test/?adminView=units&unitSearch=402#top", { ...emptyFilters, type: "Trailer" }), "/?adminView=units&unitType=Trailer#top");
});
test("same-number truck and trailer have distinct display identities", () => {
  assert.equal(unitTitle({ unitNo: "402", unitType: "Truck" }), "Truck 402");
  assert.equal(unitTitle({ unitNo: "402", unitType: "Trailer" }), "Trailer 402");
  assert.equal(unitTitle({}), "Unit Unnumbered");
});
