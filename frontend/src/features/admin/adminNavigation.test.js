import test from "node:test";
import assert from "node:assert/strict";
import {
  ADMIN_MOBILE_DESTINATIONS,
  adminMobileDestinationState,
  initialAdminView,
} from "./adminNavigation.js";

test("phone admin navigation keeps location-owned setup inside Locations", () => {
  assert.deepEqual(ADMIN_MOBILE_DESTINATIONS.map(({ key }) => key), [
    "locations",
    "surveillance",
    "settings",
    "operations",
  ]);
  assert.equal(ADMIN_MOBILE_DESTINATIONS.at(-1).secondary, true);
});

test("admin phone shell reserves a shared profile destination outside route state", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) => readFile(
    new URL("./workspace/AdminWorkspaceShell.jsx", import.meta.url),
    "utf8",
  ));
  assert.match(source, /<ProfileMenu actor=\{actor\} mobileNav \/>/);
});

test("Locations stays active throughout location-owned users and template pages", () => {
  const locations = ADMIN_MOBILE_DESTINATIONS.find(({ key }) => key === "locations");
  assert.equal(adminMobileDestinationState({ view: "locations", selectedId: "loc-1", tab: "users" }, locations), true);
  assert.equal(adminMobileDestinationState({ view: "locations", selectedId: "loc-1", tab: "template" }, locations), true);
  assert.equal(adminMobileDestinationState({ view: "locations", selectedId: "loc-1", tab: "rules" }, locations), true);
  assert.equal(adminMobileDestinationState({ view: "locations", selectedId: "loc-1", tab: "kiosk" }, locations), true);
});

test("admin opens location setup by default while explicit destinations remain linkable", () => {
  assert.equal(initialAdminView(""), "locations");
  assert.equal(initialAdminView("?adminView=locations"), "locations");
  assert.equal(initialAdminView("?adminView=surveillance"), "surveillance");
  assert.equal(initialAdminView("?adminView=operations"), "operations");
  assert.equal(initialAdminView("?adminView=settings&settingsTab=integrations"), "settings");
  assert.equal(initialAdminView("?samsara=connected"), "settings");
});
