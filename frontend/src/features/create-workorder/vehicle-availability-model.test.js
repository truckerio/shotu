import assert from "node:assert/strict";
import test from "node:test";

import {
  activeWorkorderForVehicle,
  activeWorkorderUnavailableMessage,
  moveVehicleSearchResultIndex,
  vehicleCanBeSelected,
  vehicleHasActiveWorkorder,
  vehicleSearchResultAction,
} from "./vehicle-availability-model.js";

test("missing exact vehicle has no active workorder", () => {
  assert.equal(activeWorkorderForVehicle(null), null);
  assert.equal(vehicleHasActiveWorkorder(null), false);
});

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

test("search result actions select available units and open active workorders", () => {
  assert.deepEqual(vehicleSearchResultAction({}), { type: "select-vehicle", workorderId: "" });
  assert.deepEqual(vehicleSearchResultAction(activeVehicle), { type: "open-workorder", workorderId: "wo-active" });
});

test("search result keyboard movement stays inside the compact list", () => {
  assert.equal(moveVehicleSearchResultIndex(-1, 3, "ArrowDown"), 0);
  assert.equal(moveVehicleSearchResultIndex(-1, 3, "ArrowUp"), 2);
  assert.equal(moveVehicleSearchResultIndex(1, 3, "ArrowDown"), 2);
  assert.equal(moveVehicleSearchResultIndex(2, 3, "ArrowDown"), 2);
  assert.equal(moveVehicleSearchResultIndex(1, 3, "Home"), 0);
  assert.equal(moveVehicleSearchResultIndex(1, 3, "End"), 2);
  assert.equal(moveVehicleSearchResultIndex(1, 3, "Escape"), null);
  assert.equal(moveVehicleSearchResultIndex(0, 0, "ArrowDown"), -1);
});
