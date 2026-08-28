import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(relativePath) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

const controller = read("../AdminWorkspace.jsx");
const shell = read("./AdminWorkspaceShell.jsx");
const locations = read("./LocationsPage.jsx");
const adminStyles = read("../admin.css");
const users = read("./UsersPage.jsx");
const template = read("./TemplatePage.jsx");

test("AdminWorkspace remains a controller with a stable public export", () => {
  assert.match(controller, /export function AdminWorkspace\(\{/);
  assert.ok(controller.split("\n").length <= 450, "AdminWorkspace should stay at or below 450 lines");
  assert.match(controller, /<AdminWorkspaceShell/);
  assert.match(controller, /<AdminLocationDialogs/);
  assert.match(controller, /<AdminUserActionDialog/);
});

test("admin pages are owned outside the controller", () => {
  assert.doesNotMatch(controller, /OperationsWorkspace/);
  assert.doesNotMatch(controller, /IntegrationsSettings/);
  assert.doesNotMatch(controller, /KioskSettingsPanel/);
  assert.doesNotMatch(controller, /renderWorkorderPageHtml/);

  assert.match(shell, /<OperationsPage/);
  assert.doesNotMatch(shell, /SurveillanceWorkspace/);
  assert.doesNotMatch(shell, /Odoo entry/);
  assert.match(shell, /<IntegrationsSettings/);
  assert.match(shell, /<LocationDetailPage/);
  assert.match(shell, /<LocationsPage/);
  assert.match(locations, /<UsersPage/);
  assert.match(locations, /<TemplatePage/);
  assert.match(locations, /<WorkorderRulesPage/);
  assert.match(locations, /<KioskSettingsPanel/);
});

test("page owners retain their meaningful domain behavior", () => {
  assert.match(users, /locationUserGroups/);
  assert.match(users, /Pending invitations/);
  assert.match(users, /kiosk_pin_requires_change/);
  assert.match(template, /renderWorkorderPageHtml/);
  assert.match(template, /Mechanics can record parts used/);
  assert.match(locations, /assigned_active_user_count/);
  assert.match(locations, /fixedLocationId=\{detail\.location\.id\}/);
});

test("location detail uses a contextual Locations breadcrumb without changing location tabs", () => {
  assert.match(locations, /<ContextBreadcrumbs/);
  assert.match(locations, /className="admin-location-detail-header"/);
  assert.match(adminStyles, /\.admin-location-detail-header \.page-header-heading \{[^}]*flex-direction: column/);
  assert.match(locations, /label: "Locations"/);
  assert.match(locations, /href: "\/\?adminView=locations"/);
  assert.match(locations, /isPlainPrimaryActivation\(event\)/);
  assert.match(locations, /\.admin-location-row/);
  assert.match(locations, /focus\(\{ preventScroll: true \}\)/);
  assert.doesNotMatch(locations, /aria-label="Back to locations"/);
  assert.match(locations, /aria-label="Location settings"/);
});
