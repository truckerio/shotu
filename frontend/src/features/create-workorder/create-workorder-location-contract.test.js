import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const form = readFileSync(new URL("../workorder-modules/location/CreateLocationModule.jsx", import.meta.url), "utf8");
const router = readFileSync(new URL("../../app/routes/RoleRouter.jsx", import.meta.url), "utf8");
const locationController = readFileSync(new URL("./useCreateLocationController.js", import.meta.url), "utf8");
const commands = readFileSync(new URL("../../app/routes/useRoleRouterCommands.js", import.meta.url), "utf8");
const createForm = readFileSync(new URL("../generator/CreateWorkorderForm.jsx", import.meta.url), "utf8");

test("required create location remains visible while location data loads or fails", () => {
  assert.match(form, /id="workorder-location"/);
  assert.doesNotMatch(form, /locationOptions\.length \? \([\s\S]*id="workorder-location"/);
  assert.match(form, /t\("create\.location\.loading"\)/);
  assert.match(form, /t\("create\.location\.unavailable"\)/);
  assert.match(form, /onClick=\{onReload\}>\{t\("create\.tryAgain"\)\}/);
});

test("granted cross-role Create uses the neutral authenticated context and submit APIs", () => {
  assert.match(locationController, /createTemplateEndpoint\(\)/);
  assert.doesNotMatch(locationController, /templateApiRole|\/api\/office\/locations/);
  assert.match(commands, /api\("\/api\/workorders"/);
  assert.match(commands, /!\["admin", "office"\]\.includes\(actor\.role\)/);
});

test("create location loading failures are explicit instead of silently swallowed", () => {
  assert.match(router, /useCreateLocationController/);
  assert.match(locationController, /setLocationsState\(\{ error: "", loading: true \}\)/);
  assert.match(locationController, /error\?\.message \|\| "Locations could not be loaded\."/);
  assert.doesNotMatch(locationController, /request\(endpoint\)[\s\S]{0,900}\.catch\(\(\) => \{\}\)/);
});

test("create conflicts are announced as alerts instead of generic status copy", () => {
  assert.match(commands, /message: error\.message, error: true/);
  assert.match(createForm, /role=\{error \? "alert" : "status"\}/);
});
