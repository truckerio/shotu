import assert from "node:assert/strict";
import test from "node:test";
import {
  createDraftBaselineFromForm,
  createInitialDraftBaseline,
  createInitialWorkorderForm,
  resetWorkorderFormForCreate,
  vehicleMileage,
  vehicleModelText,
  workorderDraftOwnerId,
} from "./role-router-model.js";

test("create state has one shared template baseline and mechanic ownership", () => {
  const actor = { id: "mechanic-1", name: "Mechanic One", role: "mechanic", locationIds: ["yard-1"] };
  const form = createInitialWorkorderForm(actor);
  const baseline = createInitialDraftBaseline(actor);

  assert.equal(form.locationId, "yard-1");
  assert.equal(form.mechanicName, "Mechanic One");
  assert.equal(form.headerTitle, baseline.formData.headerTitle);
  assert.equal(form.parts.length, 1);
  assert.deepEqual(createDraftBaselineFromForm(form), baseline);
});

test("create reset preserves location and template while clearing workorder content", () => {
  const current = {
    ...createInitialWorkorderForm({ role: "office", locationIds: ["yard-1"] }),
    locationId: "yard-2",
    locationName: "Texas Yard",
    headerTitle: "TEXAS YARD WORKORDER",
    unitNo: "TRUCK-9",
    mechanicConcern: "Inspect brakes",
    mechanicName: "Old Mechanic",
    parts: [{ partNo: "FILTER", qty: "1", uomCode: "pc", repairOrder: "Replace" }],
  };

  const reset = resetWorkorderFormForCreate(current, { role: "office", name: "QA Office" }, "2026-08-02");

  assert.equal(reset.locationId, "yard-2");
  assert.equal(reset.locationName, "Texas Yard");
  assert.equal(reset.headerTitle, "TEXAS YARD WORKORDER");
  assert.equal(reset.unitNo, "");
  assert.equal(reset.mechanicConcern, "");
  assert.equal(reset.mechanicName, "");
  assert.deepEqual(reset.parts, [{ partNo: "", qty: "", uomCode: "pc", repairOrder: "" }]);
  assert.equal(reset.workDate, "2026-08-02");
});

test("mechanic create reset assigns the current mechanic", () => {
  const reset = resetWorkorderFormForCreate(
    createInitialWorkorderForm({ role: "mechanic", name: "QA Mechanic", locationIds: ["yard-1"] }),
    { role: "mechanic", name: "QA Mechanic" },
    "2026-08-02",
  );

  assert.equal(reset.mechanicName, "QA Mechanic");
});

test("draft owner projection supports current and legacy API shapes", () => {
  assert.equal(workorderDraftOwnerId({ owner: { id: "a" } }), "a");
  assert.equal(workorderDraftOwnerId({ ownerId: "b" }), "b");
  assert.equal(workorderDraftOwnerId({ createdBy: { id: "c" } }), "c");
  assert.equal(workorderDraftOwnerId({ creator: { id: "d" } }), "d");
});

test("vehicle display values normalize odometer units and duplicate model words", () => {
  assert.equal(vehicleMileage({ last_odometer_miles: 1234.6 }), "1235");
  assert.equal(vehicleMileage({ last_odometer_meters: 16093.44 }), "10");
  assert.equal(vehicleModelText({ year: 2024, make: "Volvo", model: "volvo" }), "2024 Volvo");
});
