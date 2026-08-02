import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const form = readFileSync(new URL("../generator/CreateWorkorderForm.jsx", import.meta.url), "utf8");
const router = readFileSync(new URL("../../app/routes/RoleRouter.jsx", import.meta.url), "utf8");
const locationController = readFileSync(new URL("./useCreateLocationController.js", import.meta.url), "utf8");

test("required create location remains visible while location data loads or fails", () => {
  assert.match(form, /id="workorder-location"/);
  assert.doesNotMatch(form, /locationOptions\.length \? \([\s\S]*id="workorder-location"/);
  assert.match(form, /Loading locations\.\.\./);
  assert.match(form, /Locations unavailable/);
  assert.match(form, /onClick=\{onReloadLocations\}>Try again/);
});

test("create location loading failures are explicit instead of silently swallowed", () => {
  assert.match(router, /useCreateLocationController/);
  assert.match(locationController, /setLocationsState\(\{ error: "", loading: true \}\)/);
  assert.match(locationController, /error\?\.message \|\| "Locations could not be loaded\."/);
  assert.doesNotMatch(locationController, /request\(endpoint\)[\s\S]{0,900}\.catch\(\(\) => \{\}\)/);
});
