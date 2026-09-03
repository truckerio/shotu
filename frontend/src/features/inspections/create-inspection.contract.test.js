import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { canCreateInspectionLocalUnit, hasExactInspectionUnit, localInspectionUnitPayload, resolvedLocationId } from "./useCreateInspectionController.js";

const page = readFileSync(new URL("./CreateInspectionPage.jsx", import.meta.url), "utf8");
const controller = readFileSync(new URL("./useCreateInspectionController.js", import.meta.url), "utf8");

test("create inspection derives template from canonical selected unit without an inspection-type selector", () => {
  assert.match(controller, /weeklyInspectionTemplate\(selectedUnit\.unitType\)/);
  assert.match(controller, /assetId: selectedUnit\.id/);
  assert.match(page, /Search truck or trailer/);
  assert.match(page, /form\.template\.label/);
  assert.doesNotMatch(page, /Annual|FMCSA|Inspection type/);
  assert.match(page, /inspectionUnitTypeLabel\(unit\.unitType\)/);
  assert.match(page, /inspectionUnitTypeLabel\(form\.selectedUnit\.unitType\)/);
  assert.doesNotMatch(page, /unitType === "trailer"/);
});

test("create form derives location where possible and limits mechanics assignment to Office/Admin", () => {
  assert.equal(resolvedLocationId({ locations: [{ id: "yard" }], selectedUnit: null, locationId: "" }), "yard");
  assert.equal(resolvedLocationId({ locations: [{ id: "yard" }], selectedUnit: { locationId: "unit-yard" }, locationId: "" }), "unit-yard");
  assert.match(page, /locations\.length > 1 && !form\.selectedUnit\?\.locationId/);
  assert.match(page, /form\.canAssign \? <FormField label="Mechanic" required>/);
  assert.match(page, /<OperationalForm/);
  assert.match(page, /<FormCard title="New inspection">/);
  assert.match(page, /className="inspection-create-layout"/);
  assert.match(page, /className="inspection-create-primary"/);
  assert.match(page, /className="inspection-create-support" aria-label="Inspection setup"/);
  assert.match(page, /<UnitSummary/);
  assert.match(page, /<section className="inspection-unit-results" aria-label="Matching units">/);
  assert.match(page, /<ul>\{form\.choices\.map/);
  assert.doesNotMatch(page, /role="listbox"|role="option"|aria-selected/);
  assert.match(controller, /actor\.role === "office" \|\| actor\.role === "admin"/);
  assert.match(controller, /isMechanic \? \[actor\.id\]/);
});

test("create form keeps optional details progressive and preserves inputs when injected API fails", () => {
  assert.match(page, /<OptionalSection className="inspection-more-details" title="More details">/);
  assert.match(page, /<ActionFooter stickyOnMobile/);
  assert.match(page, /Request inspection/);
  assert.match(page, /Start inspection/);
  assert.match(controller, /catch \(error\)[\s\S]*setState\(\{ busy: false, error:/);
  assert.doesNotMatch(controller, /catch \(error\) \{[\s\S]*setSelectedUnit\(null\)/);
  assert.doesNotMatch(controller, /catch \(error\) \{[\s\S]*setDueDate\(""\)/);
  assert.doesNotMatch(controller, /catch \(error\) \{[\s\S]*setInstructions\(""\)/);
});

test("local inspection unit fallback is Office/Admin-only and only appears when no canonical identity matches", () => {
  const units = [{ id: "asset-1", unitNo: "TRL-44", vin: "VIN-44", plate: "CA 44" }];
  assert.equal(canCreateInspectionLocalUnit({ role: "office" }), true);
  assert.equal(canCreateInspectionLocalUnit({ role: "admin" }), true);
  assert.equal(canCreateInspectionLocalUnit({ role: "mechanic" }), false);
  assert.equal(hasExactInspectionUnit(units, "trl 44"), true);
  assert.equal(hasExactInspectionUnit(units, "vin44"), true);
  assert.equal(hasExactInspectionUnit(units, "new-44"), false);
});

test("local inspection unit payload preserves selected company/location and requires duplicate confirmation", () => {
  assert.deepEqual(localInspectionUnitPayload({
    location: { id: "location-1", companyId: "company-1" },
    localUnit: { unitNo: " LOCAL-1 ", unitType: "Truck", vin: " VIN ", plate: " PLATE ", confirmDuplicate: true },
  }), { companyId: "company-1", locationId: "location-1", unitNo: "LOCAL-1", unitType: "Truck", vin: "VIN", licensePlate: "PLATE", confirmDuplicate: true });
  assert.match(page, /Add local unit/);
  assert.match(page, /Confirm and add local unit/);
  assert.match(controller, /\/api\/vehicles\/manual/);
});
