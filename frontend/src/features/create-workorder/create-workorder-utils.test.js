import assert from "node:assert/strict";
import test from "node:test";
import {
  createLocationDefaultPatch,
  createLocationTemplatePatch,
  createWorkorderPreviewForm,
  normalizeVehicleLookupValue,
  resolveCreateLocation,
  selectedCreateMechanicNames,
  splitSerial,
  templateFieldsForCreateLocation,
  uniqueExactVehicleMatch,
  vehicleLookupValues,
} from "./create-workorder-utils.js";

test("create preview projects the selected mechanic names from assignment truth", () => {
  const assignment = {
    mechanicUserIds: ["mechanic-2", "mechanic-1"],
    mechanics: [
      { id: "mechanic-1", displayName: "abhay" },
      { id: "mechanic-2", name: "Anmol" },
      { id: "mechanic-3", name: "Armando" },
    ],
  };

  assert.equal(selectedCreateMechanicNames(assignment), "abhay, Anmol");
  assert.deepEqual(
    createWorkorderPreviewForm({ unitNo: "G2202", mechanicName: "Stale name" }, assignment),
    { unitNo: "G2202", mechanicName: "abhay, Anmol" },
  );
  assert.equal(
    createWorkorderPreviewForm({ mechanicName: "Stale name" }, { ...assignment, mechanicUserIds: [] }).mechanicName,
    "",
  );
});

test("create preview separates serialized units into independent repair lines", () => {
  const preview = createWorkorderPreviewForm({
    parts: [{
      partNo: "TIRE-1",
      qty: "2",
      uomCode: "ea",
      repairOrder: "Replace tires",
      serializationRequired: true,
      serializedUnitIds: ["unit-1", "unit-2"],
      serializedSerialNumbers: ["SER-1", "SER-2"],
    }],
  });

  assert.deepEqual(preview.parts.map((part) => [part.qty, part.serializedSerialNumbers]), [
    ["1", ["SER-1"]],
    ["1", ["SER-2"]],
  ]);
});

test("serial parser keeps prefix, number, and padding width", () => {
  assert.deepEqual(splitSerial("WO-000009"), { prefix: "WO-", nextNumber: 9, digits: 6 });
  assert.deepEqual(splitSerial("bad"), { prefix: "WO-", nextNumber: 1, digits: 6 });
});

test("vehicle lookup normalization supports exact unit/name matching", () => {
  assert.equal(normalizeVehicleLookupValue(" G-2001 "), "g2001");
  assert.deepEqual(
    vehicleLookupValues({ unit_no: "G-2001", unitNo: "G2001", name: "Truck G 2001" }),
    ["g2001", "g2001", "truckg2001"],
  );
});

test("unique exact vehicle match rejects partial and ambiguous matches", () => {
  const vehicles = [
    { id: "1", unit_no: "G2001", name: "Truck G2001" },
    { id: "2", unit_no: "G2002", name: "Truck G2002" },
  ];
  assert.equal(uniqueExactVehicleMatch(vehicles, "g2001")?.id, "1");
  assert.equal(uniqueExactVehicleMatch(vehicles, "g20"), null);
  assert.equal(uniqueExactVehicleMatch([...vehicles, { id: "3", unit_no: "G-2001" }], "g2001"), null);
});

test("create location resolver accepts canonical ids and saved display names", () => {
  const locations = [
    { location: { id: "loc-chino", name: "Chino Yard" } },
    { location: { id: "loc-texas", name: "Texas Yard" } },
  ];
  assert.equal(resolveCreateLocation(locations, "loc-chino")?.location.id, "loc-chino");
  assert.equal(resolveCreateLocation(locations, " chino yard ")?.location.id, "loc-chino");
  assert.equal(resolveCreateLocation(locations, "missing"), null);
});

test("create default location does not overwrite a selected location", () => {
  const locations = [
    { location: { id: "loc-arizona", name: "Arizona Yard" } },
    { location: { id: "loc-chino", name: "Chino Yard" } },
  ];
  assert.deepEqual(
    createLocationDefaultPatch({
      currentLocationId: "loc-chino",
      defaultLocation: { id: "loc-arizona", name: "Arizona Yard" },
      locations,
      template: { header_title: "Arizona Yard Workorder" },
    }),
    { locationId: "loc-chino", locationName: "Chino Yard" },
  );
  assert.deepEqual(
    createLocationDefaultPatch({
      currentLocationId: " Chino Yard ",
      defaultLocation: { id: "loc-arizona", name: "Arizona Yard" },
      locations,
    }),
    { locationId: "loc-chino", locationName: "Chino Yard" },
  );
});

test("create default location fills an empty form with template copy", () => {
  assert.deepEqual(
    createLocationDefaultPatch({
      currentLocationId: "",
      defaultLocation: { id: "loc-arizona", name: "Arizona Yard" },
      locations: [],
      template: {
        header_title: "Arizona Yard Workorder",
        brand_top: "PRO TEC",
        brand_bottom: "REPAIR",
        warranty_text: "Warranty",
        responsibility_text: "Responsibility",
        authorization_text: "Authorization",
      },
    }),
    {
      locationId: "loc-arizona",
      locationName: "Arizona Yard",
      headerTitle: "Arizona Yard Workorder",
      brandTop: "PRO TEC",
      brandBottom: "REPAIR",
      warrantyText: "Warranty",
      responsibilityText: "Responsibility",
      authorizationText: "Authorization",
    },
  );
});

test("create location template fallback uses the selected location name", () => {
  assert.equal(
    templateFieldsForCreateLocation({ name: "Texas Yard" }, null).headerTitle,
    "TEXAS YARD WORKORDER",
  );
  assert.equal(
    templateFieldsForCreateLocation(
      { name: "Texas Yard" },
      { header_title: "Custom Texas Template", brand_top: "A", brand_bottom: "B" },
    ).headerTitle,
    "Custom Texas Template",
  );
});

test("create location template patch repairs stale draft template fields", () => {
  const locations = [
    {
      location: { id: "loc-chino", name: "Chino Yard" },
      template: { header_title: "CHINO YARD WORKORDER", brand_top: "PRO TEC", brand_bottom: "REPAIR" },
    },
    {
      location: { id: "loc-newjersey", name: "New Jersey Yard" },
      template: null,
    },
  ];

  assert.deepEqual(
    createLocationTemplatePatch(
      {
        locationId: "loc-newjersey",
        headerTitle: "CHINO YARD WORKORDER",
        brandTop: "PRO TEC",
        brandBottom: "REPAIR",
      },
      locations,
    ),
    {
      locationName: "New Jersey Yard",
      headerTitle: "NEW JERSEY YARD WORKORDER",
      warrantyText: "NO WARRANTY ON PARTS SUPPLIED BY CUSTOMER",
      responsibilityText: "Not responsible for loss or damage to vehicle in case of fire, theft or any other cause beyond our control.",
      authorizationText: "I authorize the above repair to be completed along with necessary material(s). I grant you and/or your employees permission to operate the vehicle described herein on street, highways, or elsewhere for the purpose of testing and/or inspection. An express mechanic's lien is hereby acknowledged on above vehicle to secure the amount of repairs thereto.",
    },
  );
});
