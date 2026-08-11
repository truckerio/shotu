import test from "node:test";
import assert from "node:assert/strict";
import {
  ADMIN_MOBILE_DESTINATIONS,
  adminMobileDestinationState,
  canonicalAdminSearch,
  initialAdminView,
} from "./adminNavigation.js";

test("phone admin navigation keeps location-owned setup inside Locations", () => {
  assert.deepEqual(ADMIN_MOBILE_DESTINATIONS.map(({ key }) => key), [
    "locations",
    "modules",
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

test("admin phone destinations divide the full bottom navigation evenly", async () => {
  const styles = await import("node:fs/promises").then(({ readFile }) => readFile(
    new URL("./admin.css", import.meta.url),
    "utf8",
  ));
  assert.match(styles, /\.admin-mobile-nav\s*\{[^}]*grid-template-columns:\s*repeat\(5, minmax\(0, 1fr\)\)/s);
  assert.doesNotMatch(styles, /\.admin-mobile-nav\s*\{[^}]*grid-template-columns:\s*repeat\(6,/s);
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
  assert.equal(initialAdminView("?adminView=modules"), "modules");
  assert.equal(initialAdminView("?adminView=surveillance"), "operations");
  assert.equal(initialAdminView("?adminView=operations"), "operations");
  assert.equal(initialAdminView("?adminView=settings&settingsTab=integrations"), "settings");
  assert.equal(initialAdminView("?samsara=connected"), "settings");
});

test("legacy Admin Odoo links redirect to the Operations Odoo backlog", () => {
  assert.equal(
    canonicalAdminSearch("?adminView=surveillance"),
    "?adminView=operations&category=odoo_backlog",
  );
  assert.equal(
    canonicalAdminSearch("?adminView=surveillance&company=company-1"),
    "?adminView=operations&company=company-1&category=odoo_backlog",
  );
  assert.equal(canonicalAdminSearch("?adminView=modules"), "?adminView=modules");
});
