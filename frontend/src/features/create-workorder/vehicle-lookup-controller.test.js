import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./useVehicleLookupController.js", import.meta.url),
  "utf8",
);

test("vehicle search debounce is not restarted by callback identity changes", () => {
  assert.match(source, /const applyVehicleRef = useRef\(null\)/);
  assert.match(source, /applyVehicleRef\.current = applyVehicle/);
  assert.match(source, /applyVehicleRef\.current\(exactMatch\)/);
  assert.match(source, /\}, \[activeWorkorderId, form\.unitNo, selectedVehicle\]\);/);
  assert.doesNotMatch(source, /\}, \[activeWorkorderId, applyVehicle, form\.unitNo, selectedVehicle\]\);/);
});

test("vehicle search has a bounded request timeout", () => {
  assert.match(
    source,
    /api\(`\/api\/vehicles\/search\?q=\$\{encodeURIComponent\(query\)\}&limit=8`, \{ timeoutMs: 10_000 \}\)/,
  );
});

test("vehicle selection is scoped to the selected repair-location company", () => {
  assert.match(source, /vehiclesForCompany\(result\.vehicles \|\| \[\], companyIdRef\.current\)/);
  assert.match(source, /if \(!vehicleBelongsToCompany\(vehicle, companyIdRef\.current\)\)/);
  assert.match(source, /Select a vehicle owned by the same company as the repair location\./);
  assert.match(source, /!vehicleCompanyId\(selectedVehicle\)/);
});

test("active workorder units stay visible but cannot auto-select", () => {
  assert.match(source, /if \(!vehicleCanBeSelected\(vehicle, activeWorkorderId\)\)/);
  assert.match(source, /exactMatch && vehicleCanBeSelected\(exactMatch, activeWorkorderId\)/);
  assert.match(source, /activeWorkorderUnavailableMessage\(exactMatch\)/);
});
