import test from "node:test";
import assert from "node:assert/strict";
import { unitsFilters, unitsDirectoryPath, unitsFilterUrl, unitTitle } from "./units-directory-model.js";

test("directory starts browseable with no query and bounded pages", () => {
  assert.deepEqual(unitsFilters(), { q: "", type: "" });
  assert.equal(unitsDirectoryPath({}), "/api/vehicles/directory?limit=25");
});
test("filters restore safely and drop invalid types", () => {
  assert.deepEqual(unitsFilters("?unitSearch=402&unitType=Truck"), { q: "402", type: "Truck" });
  assert.equal(unitsFilters("?unitType=wrong").type, "");
  assert.equal(unitsFilters(`?unitSearch=${"x".repeat(200)}`).q.length, 120);
});
test("queries and cursors cannot introduce arbitrary query parameters", () => {
  const url = new URL(unitsDirectoryPath({ q: "  402&companyId=other  ", type: "Truck" }, "a+b="), "https://example.test");
  assert.equal(url.searchParams.get("q"), "402&companyId=other");
  assert.equal(url.searchParams.has("companyId"), false);
  assert.equal(url.searchParams.get("cursor"), "a+b=");
});
test("filter changes preserve host navigation and clear only owned filters", () => {
  assert.equal(unitsFilterUrl("https://example.test/?adminView=units&unitSearch=402#top", { q: "", type: "Trailer" }), "/?adminView=units&unitType=Trailer#top");
});
test("same-number truck and trailer have distinct display identities", () => {
  assert.equal(unitTitle({ unitNo: "402", unitType: "Truck" }), "Truck 402");
  assert.equal(unitTitle({ unitNo: "402", unitType: "Trailer" }), "Trailer 402");
  assert.equal(unitTitle({}), "Unit Unnumbered");
});
