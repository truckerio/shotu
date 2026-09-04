import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(relativePath) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

const controller = read("../AdminWorkspace.jsx");
const shell = read("./AdminWorkspaceShell.jsx");
const settings = read("./AdminSettingsWorkspace.jsx");
const locations = read("./LocationsPage.jsx");
const adminStyles = read("../admin.css");
const users = read("./UsersPage.jsx");
const template = read("./TemplatePage.jsx");
const operationsPage = read("./OperationsPage.jsx");
const operationsStyles = read("./operations-page.css");
const inventory = read("../../inventory/InventoryWorkspace.jsx");
const collectionPage = read("../../../components/operations/OperationalCollectionPage.jsx");

test("AdminWorkspace remains a controller with a stable public export", () => {
  assert.match(controller, /export function AdminWorkspace\(\{/);
  assert.ok(controller.replace(/\n$/, "").split("\n").length <= 450, "AdminWorkspace should stay at or below 450 lines");
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
  assert.match(shell, /<AdminSettingsWorkspace/);
  assert.match(settings, /<IntegrationsSettings/);
  assert.match(settings, /<InspectionTemplatesPage/);
  assert.match(shell, /<LocationDetailPage/);
  assert.match(shell, /<LocationsPage/);
  assert.match(locations, /<UsersPage/);
  assert.match(locations, /<TemplatePage/);
  assert.match(locations, /<WorkorderRulesPage/);
  assert.match(locations, /<KioskSettingsPanel/);
});

test("Operations and Inventory share the operational collection page composition", () => {
  assert.match(operationsPage, /<OperationalCollectionPage/);
  assert.match(operationsPage, /title=\{<OperationsTitle product=\{product\} canSwitch=\{canSwitch\} onChange=\{changeProduct\} \/>\}/);
  assert.match(inventory, /<OperationalCollectionPage/);
  assert.match(inventory, /presentation=\{presentation\}/);
  assert.match(inventory, /<OperationalCollectionTabs/);
  assert.match(inventory, /<OperationalCollectionTable/);
  assert.match(collectionPage, /headingLevel=\{embedded \? 2 : 1\}/);
});

test("admin Operations keeps the authorized workorder queue mounted while inspections are active", () => {
  assert.match(operationsPage, /workorderAccess\.canRead \? <div hidden=\{product !== "workorders"\}>/);
  assert.match(operationsPage, /<OperationsWorkspace actor=\{actor\}/);
  assert.doesNotMatch(operationsPage, /:\s*<OperationsWorkspace/);
});

test("admin Operations title menu offers only the authorized peer views and clears inspection creation on change", () => {
  assert.match(operationsPage, /const PRODUCT_VIEWS = \[/);
  assert.match(operationsPage, /label: "Workorders", description: "Manage repair work"/);
  assert.match(operationsPage, /label: "Inspections", description: "Review scheduled checks"/);
  assert.match(operationsPage, /aria-current=\{product === view\.id \? "page" : undefined\}/);
  assert.match(operationsPage, /setCreatingInspection\(false\);/);
  assert.doesNotMatch(operationsPage, /ProductModeSwitch/);
  assert.match(operationsStyles, /@media \(max-width: 640px\)[\s\S]*\.admin-operations-content > \.page-header \{[\s\S]*grid-template-columns: minmax\(0, 1fr\) auto;/);
  assert.match(operationsStyles, /\.admin-operations-content > \.page-header \.page-header-actions \{[\s\S]*grid-column: 2;[\s\S]*width: auto;/);
});

test("admin Operations opens the inspection returned by create", () => {
  assert.match(operationsPage, /const \[createdInspectionId, setCreatedInspectionId\] = useState\(""\)/);
  assert.match(operationsPage, /onCreated=\{\(result\) => \{ setCreatingInspection\(false\); setCreatedInspectionId\(result\?\.inspection\?\.id \|\| ""\); \}\}/);
  assert.match(operationsPage, /initialInspectionId=\{createdInspectionId \|\| initialInspectionId\}/);
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
  assert.doesNotMatch(locations, /admin-location-detail-header/);
  assert.doesNotMatch(adminStyles, /admin-location-detail-header/);
  assert.match(locations, /label: "Locations"/);
  assert.match(locations, /href: "\/\?adminView=locations"/);
  assert.match(locations, /isPlainPrimaryActivation\(event\)/);
  assert.match(locations, /\.admin-location-row/);
  assert.match(locations, /focus\(\{ preventScroll: true \}\)/);
  assert.doesNotMatch(locations, /aria-label="Back to locations"/);
  assert.match(locations, /aria-label="Location settings"/);
});
