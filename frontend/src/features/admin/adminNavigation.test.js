import test from "node:test";
import assert from "node:assert/strict";
import {
  ADMIN_MOBILE_DESTINATIONS,
  adminLocationTarget,
  adminMobileDestinationState,
  initialAdminView,
} from "./adminNavigation.js";

test("phone admin navigation keeps setup destinations ahead of operations", () => {
  assert.deepEqual(ADMIN_MOBILE_DESTINATIONS.map(({ key }) => key), [
    "locations",
    "users",
    "template",
    "settings",
    "operations",
  ]);
  assert.equal(ADMIN_MOBILE_DESTINATIONS.at(-1).secondary, true);
});

test("location-local destinations reuse selection or first available location", () => {
  assert.equal(adminLocationTarget("loc-2", [{ id: "loc-1" }]), "loc-2");
  assert.equal(adminLocationTarget(null, [{ id: "loc-1" }]), "loc-1");
  assert.equal(adminLocationTarget(null, []), null);
});

test("location-local destination state includes active tab", () => {
  const users = ADMIN_MOBILE_DESTINATIONS.find(({ key }) => key === "users");
  const locations = ADMIN_MOBILE_DESTINATIONS.find(({ key }) => key === "locations");
  assert.equal(adminMobileDestinationState({ view: "locations", selectedId: "loc-1", tab: "users" }, users), true);
  assert.equal(adminMobileDestinationState({ view: "locations", selectedId: "loc-1", tab: "template" }, users), false);
  assert.equal(adminMobileDestinationState({ view: "locations", selectedId: "loc-1", tab: "rules" }, locations), true);
});

test("admin opens location setup by default while explicit destinations remain linkable", () => {
  assert.equal(initialAdminView(""), "locations");
  assert.equal(initialAdminView("?adminView=locations"), "locations");
  assert.equal(initialAdminView("?adminView=operations"), "operations");
  assert.equal(initialAdminView("?adminView=settings&settingsTab=integrations"), "settings");
  assert.equal(initialAdminView("?samsara=connected"), "settings");
});
