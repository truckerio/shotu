import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workspace = readFileSync(new URL("./OfficeWorkspace.jsx", import.meta.url), "utf8");
const mechanicWorkspace = readFileSync(new URL("../mechanic/MechanicWorkspace.jsx", import.meta.url), "utf8");
const surveillanceQueueView = readFileSync(new URL("../surveillance/workspace/SurveillanceQueueView.jsx", import.meta.url), "utf8");
const roleWorkspaceCss = readFileSync(new URL("../role-workspaces.css", import.meta.url), "utf8");
const officeCss = readFileSync(new URL("./office.css", import.meta.url), "utf8");
const rail = readFileSync(new URL("../../components/layout/RoleNavigationRail.jsx", import.meta.url), "utf8");
const railCss = readFileSync(new URL("../../components/layout/role-navigation-rail.css", import.meta.url), "utf8");

test("Manager uses an integrated Office rail with a separate page title", () => {
  assert.match(workspace, /const officeRail = \(/);
  assert.match(workspace, /<RoleNavigationRail actor=\{actor\} ariaLabel="Office workspace"/);
  assert.match(rail, /<WorkspaceHeader actor=\{actor\}/);
  assert.match(workspace, /<PageHeader[\s\S]*?title=\{pageTitle\}/);
  assert.match(workspace, /className=\{\["inventory", "units"\]\.includes\(activeTab\) \? "office-collection-page-header" : "office-operations-page-header"\}/);
  assert.match(officeCss, /\.office-collection-page-header\s*\{[\s\S]*?padding-inline:\s*0;/);
  assert.match(officeCss, /\.workspace-operations\.office-home > \.office-collection-page-header\s*\{[\s\S]*?margin-top:\s*8px;/);
  assert.doesNotMatch(officeCss, /\.office-collection-page-header \.page-header-copy h1/);
  assert.doesNotMatch(officeCss, /margin-bottom:\s*-6px|transform:\s*translateY\(-2px\)/);
  assert.match(workspace, /function requestedInventoryPageTitle\(search = ""\)/);
  assert.match(workspace, /params\.get\("view"\) === "invoices" \|\| params\.has\("invoiceRun"\) \|\| params\.get\("inventoryAction"\) === "upload-invoice"\) return "Invoice intake";/);
  assert.match(workspace, /params\.has\("countImport"\) \|\| params\.get\("inventoryAction"\) === "count"\) return "Starting inventory";/);
  assert.match(workspace, /const \[inventoryPageTitle, setInventoryPageTitle\] = useState\(\(\) => requestedInventoryPageTitle\(window\.location\.search\)\)/);
  assert.match(workspace, /<WorkspaceCreateActions actor=\{actor\}/);
});

test("Office separates workspace destinations from workorder queues", () => {
  assert.match(workspace, /id: "operations", label: "Operations"/);
  assert.match(workspace, /id: "workorders", label: "Workorders"/);
  assert.match(workspace, /id: "customers", label: "Customers"/);
  assert.match(workspace, /id: "inspections", label: "Inspections"/);
  assert.match(workspace, /id: "inventory", label: "Inventory"/);
  assert.match(workspace, /id: "inventory-stock", label: "Stock"/);
  assert.match(workspace, /id: "units", label: "Units"/);
  assert.match(workspace, /activeSection=\{inventorySection\} onSectionChange=\{syncInventorySection\}/);
  assert.match(workspace, /showSectionNavigation=\{false\}/);
  assert.match(workspace, /const desktopQueueTabs = tabs\.filter\(\(tab\) => !\["customers", "inventory", "units"\]\.includes\(tab\.key\)\)/);
  assert.match(workspace, /<WorkorderQueueTabs tabs=\{desktopQueueTabs\}/);
  assert.match(workspace, /const mobileSecondaryTabs = tabs\.filter\(\(tab\) => OFFICE_SECONDARY_TAB_KEYS\.includes\(tab\.key\)\)/);
  assert.match(workspace, /const isOperationsWorkspace = !\["inventory", "units"\]\.includes\(activeTab\)/);
  assert.match(workspace, /workspace-operations is-\$\{activeTab === "inventory" \? "inventory" : activeTab === "units" \? "units" : "operations"\}-workspace/);
  assert.match(workspace, /actions=\{isOperationsWorkspace \? <WorkspaceCreateActions[\s\S]*?\/> : null\}/);
  assert.match(workspace, /\{isOperationsWorkspace && activeTab !== "customers" \? <div className="queue-toolbar office-toolbar role-queue-toolbar">/);
  assert.match(workspace, /product === "inspections" \? "Inspections" : "Workorders"/);
  assert.match(workspace, /isOperationsWorkspace \? " operational-collection-surface office-primary-work-surface" : ""/);
  assert.match(workspace, /<section className="operational-collection-surface office-inspection-work-surface">/);
  assert.match(officeCss, /\.office-primary-work-surface\s*\{[\s\S]*?overflow:\s*hidden;[\s\S]*?padding:\s*0;/);
  assert.doesNotMatch(workspace, /<ProductModeSwitch/);
  assert.match(workspace, /actions=\{isOperationsWorkspace \? <WorkspaceCreateActions[\s\S]*?: activeTab === "inventory" \? inventoryHeaderActions : null\}/);
  assert.match(workspace, /presentation="embedded" activeSection=\{inventorySection\} onSectionChange=\{syncInventorySection\} onSectionTitleChange=\{setInventoryPageTitle\} onSectionActionsChange=\{setInventoryHeaderActions\} showSectionNavigation=\{false\} showSectionNavigationOnPhone/);
  assert.match(workspace, /\["inventory", "units"\]\.includes\(activeTab\) \? " is-frameless-collection" : ""/);
  assert.match(officeCss, /\.workspace-operations \.office-table-shell\.is-frameless-collection\s*\{[\s\S]*?border:\s*0;[\s\S]*?border-radius:\s*0;/);
  assert.match(officeCss, /\.workspace-operations\.office-home:is\(\.is-inventory-workspace, \.is-units-workspace, \.is-operations-workspace\)\s*\{[\s\S]*?gap:\s*12px;/);
  assert.match(officeCss, /\.is-inventory-workspace \.operational-collection-tabs button\s*\{[\s\S]*?min-height:\s*44px;/);
  assert.match(officeCss, /\.is-inventory-workspace \.operational-collection-toolbar\s*\{[\s\S]*?margin-top:\s*16px;[\s\S]*?padding-block:\s*12px;/);
  assert.match(officeCss, /\.is-units-workspace \.office-table-shell\s*\{[\s\S]*?min-height:\s*0;/);
  assert.match(officeCss, /@media \(max-width: 700px\)[\s\S]*?\.office-operations-page-header\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) auto;/);
  assert.match(officeCss, /\.is-operations-workspace \.role-desktop-queues \.mechanic-queue-tabs\s*\{[\s\S]*?flex-wrap:\s*nowrap;/);
  assert.match(officeCss, /\.is-operations-workspace \.role-desktop-queues \.mechanic-queue-tabs button\s*\{[\s\S]*?padding-inline:\s*4px;/);
  assert.match(officeCss, /\.office-shell\s*\{[\s\S]*?grid-template-columns:\s*220px minmax\(0, 1fr\);/);
  assert.match(workspace, /ariaLabel="Office workspace"/);
});

test("Office rail selections replace stale Inventory workflow URL state", () => {
  assert.match(workspace, /const INVENTORY_ROUTE_PARAMS = \["inventorySection", "invoiceRun", "inventoryAction", "countImport", "purchaseOrderId", "purchaseOrderNumber"/);
  assert.match(workspace, /function replaceOfficeWorkspaceRoute\(view = ""\)/);
  assert.match(workspace, /if \(view\) url\.searchParams\.set\("view", view\);\s*else url\.searchParams\.delete\("view"\);\s*for \(const key of INVENTORY_ROUTE_PARAMS\) url\.searchParams\.delete\(key\);/);
  assert.match(workspace, /if \(nextWorkspace === "operations"\) \{\s*replaceOfficeWorkspaceRoute\(\);/);
  assert.match(workspace, /if \(nextWorkspace === "customers"\) replaceOfficeWorkspaceRoute\("customers"\);/);
  assert.match(workspace, /if \(nextWorkspace === "units"\) replaceOfficeWorkspaceRoute\("units"\);/);
  assert.match(workspace, /url\.searchParams\.set\("view", "inventory"\);\s*for \(const key of INVENTORY_ROUTE_PARAMS\) url\.searchParams\.delete\(key\);\s*url\.searchParams\.set\("inventorySection", nextSection\);/);
  assert.match(workspace, /setInventoryWorkspaceResetKey\(\(current\) => current \+ 1\)/);
  assert.match(workspace, /<InventoryWorkspace key=\{inventoryWorkspaceResetKey\} actorId=\{actor\?\.id\}/);
});

test("every operational role uses the same workspace identity and page-title structure", () => {
  for (const source of [workspace, mechanicWorkspace]) assert.match(source, /<RoleNavigationRail actor=\{actor\}/);
  assert.match(surveillanceQueueView, /\{rail\}/);
  assert.match(workspace, /<PageHeader[\s\S]*?title=\{pageTitle\}/);
  assert.match(mechanicWorkspace, /<PageHeader[\s\S]*?title=\{t\("mechanic\.workorders"\)\}/);
  assert.match(surveillanceQueueView, /<PageHeader title="Workorders"/);
});

test("Manager and Mechanic share one phone Create and profile action owner", () => {
  assert.match(workspace, /<RoleNavigationRail actor=\{actor\} ariaLabel="Office workspace"/);
  assert.match(workspace, /<WorkspaceCreateActions[\s\S]*?actor=\{actor\}[\s\S]*?onCreateWorkorder=\{workorderAccess\.canWrite \? onCreateWorkorder : null\}/);
  assert.match(mechanicWorkspace, /<RoleNavigationRail actor=\{actor\} locale=\{locale\}/);
  assert.match(mechanicWorkspace, /<WorkspaceCreateActions[\s\S]*?actor=\{actor\}[\s\S]*?onCreateWorkorder=\{workorderAccess\.canWrite \? onCreateWorkorder : null\}/);
});

test("inspection workspaces retain the profile header on phone", () => {
  assert.match(workspace, /<RoleNavigationRail actor=\{actor\}/);
  assert.match(mechanicWorkspace, /workspace-operations inspection-workspace/);
  assert.match(railCss, /@media \(max-width:700px\)/);
  assert.match(workspace, /const officeMobileNavigation = \(/);
  assert.match(workspace, /\{officeMobileNavigation\}/);
  assert.match(officeCss, /\.office-mobile-nav \{[\s\S]*?display: grid;/);
  assert.match(workspace, /<WorkspaceHeader actor=\{actor\} className="office-phone-account-header" \/>/);
  assert.match(officeCss, /@media \(max-width: 700px\)[\s\S]*?\.office-phone-account-header \{ display: flex; \}/);
});

test("Office opens the newly created inspection instead of returning to the queue", () => {
  assert.match(workspace, /const \[createdInspectionId, setCreatedInspectionId\] = useState\(""\)/);
  assert.match(workspace, /onCreated=\{\(result\) => \{ setCreatingInspection\(false\); setCreatedInspectionId\(result\?\.inspection\?\.id \|\| ""\); \}\}/);
  assert.match(workspace, /initialInspectionId=\{createdInspectionId \|\| initialInspectionId\}/);
});

test("Manager queue controls clear incompatible Unassigned filters", () => {
  assert.match(workspace, /officeQueueFilterState\(nextTab, \{ lifecycleFilter, mechanicFilter \}\)/);
  assert.match(workspace, /officeTabForMechanicFilter\(current, nextMechanic\)/);
  assert.match(workspace, /WorkorderQueueTabs tabs=\{desktopQueueTabs\} activeTab=\{activeTab\} onChange=\{selectQueue\}/);
  assert.match(workspace, /onClick=\{\(\) => selectMechanic\(mechanic\.name\)\}/);
});

test("every role exposes a recovery action when a narrowing filter hides its queue", () => {
  assert.match(workspace, /onClearFilters=\{clearOfficeFilters\}/);
  assert.match(workspace, /Current filters hide this queue/);
  assert.match(mechanicWorkspace, /t\("mechanic\.noMatching"\)[\s\S]*t\("mechanic\.clearSearch"\)/);
  assert.match(surveillanceQueueView, /onClearFilters=\{clearFilters\}/);
  assert.match(surveillanceQueueView, /Current filters hide this queue/);
});
