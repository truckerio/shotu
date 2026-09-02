import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { vehicleLookupRequestIsCurrent } from "./useVehicleLookupController.js";

const source = readFileSync(
  new URL("./useVehicleLookupController.js", import.meta.url),
  "utf8",
);

test("vehicle search keeps exact matches visible for explicit selection", () => {
  assert.doesNotMatch(source, /applyVehicleRef/);
  assert.doesNotMatch(source, /applyVehicle\(exactMatch\)/);
  assert.match(source, /const exactMatch = uniqueExactVehicleMatch\(vehicles, query\);/);
  assert.match(source, /results: vehicles/);
  assert.match(source, /\}, \[activeWorkorderId, selectedVehicle, unitLookupQuery\]\);/);
});

test("typing a Unit query updates only controller-owned lookup state", () => {
  assert.match(
    source,
    /const updateUnitLookupQuery = useCallback\(\(value\) => \{\s+lookupGenerationRef\.current \+= 1;\s+setVehicleLookup\(\(current\) => \(\{ \.\.\.current, loading: false, results: \[\] \}\)\);\s+setUnitLookupQuery\(value\);/,
  );
  assert.doesNotMatch(source, /updateUnitLookupQuery[\s\S]{0,300}updateField\("unitNo"/);
});

test("manual Unit entry is committed only through the explicit commit API", () => {
  assert.match(
    source,
    /const commitUnitNumber = useCallback\(\(updateField\) => \{\s+const value = unitLookupQuery;\s+if \(value !== formRef\.current\.unitNo\) updateField\("unitNo", value\);/,
  );
  assert.match(source, /unitLookupQuery,\s+updateUnitLookupQuery,\s+commitUnitNumber,/);
});

test("an old async query cannot publish results after the user types again", async () => {
  let currentGeneration = 4;
  const requestGeneration = currentGeneration;
  let resolveRequest;
  let published = false;
  const request = new Promise((resolve) => { resolveRequest = resolve; });
  const completion = request.then(() => {
    if (vehicleLookupRequestIsCurrent(requestGeneration, currentGeneration)) published = true;
  });

  currentGeneration += 1;
  resolveRequest();
  await completion;

  assert.equal(published, false);
});

test("vehicle search has a bounded request timeout", () => {
  assert.match(
    source,
    /api\(`\/api\/vehicles\/search\?q=\$\{encodeURIComponent\(query\)\}&limit=6`, \{ timeoutMs: 10_000 \}\)/,
  );
});

test("vehicle selection is scoped to the selected repair-location company", () => {
  assert.match(source, /vehiclesForCompany\(result\.vehicles \|\| \[\], companyIdRef\.current\)/);
  assert.match(source, /if \(!vehicleBelongsToCompany\(vehicle, companyIdRef\.current\)\)/);
  assert.match(source, /Select a vehicle owned by the same company as the repair location\./);
  assert.match(source, /!vehicleCompanyId\(selectedVehicle\)/);
});

test("active workorder units stay visible with their blocking message", () => {
  assert.match(source, /if \(!vehicleCanBeSelected\(vehicle, activeWorkorderId\)\)/);
  assert.match(source, /activeWorkorderUnavailableMessage\(exactMatch\)/);
});
