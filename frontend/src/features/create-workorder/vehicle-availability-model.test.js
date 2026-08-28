import assert from "node:assert/strict";
import test from "node:test";

import {
  activeWorkorderUnavailableMessage,
  vehicleCanBeSelected,
  vehicleHasActiveWorkorder,
} from "./vehicle-availability-model.js";

const activeVehicle = { active_workorder: { id: "wo-active", serial: "WO-1024", status: "in_progress" } };

test("active vehicle cannot be selected for a new workorder", () => {
  assert.equal(vehicleHasActiveWorkorder(activeVehicle), true);
  assert.equal(vehicleCanBeSelected(activeVehicle), false);
  assert.match(activeWorkorderUnavailableMessage(activeVehicle), /WO-1024 \(in progress\)/);
});

test("the current workorder can retain its own active vehicle", () => {
  assert.equal(vehicleCanBeSelected(activeVehicle, "wo-active"), true);
  assert.equal(vehicleCanBeSelected({}), true);
});
