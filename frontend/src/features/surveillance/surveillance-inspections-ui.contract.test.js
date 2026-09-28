import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workspace = readFileSync(new URL("./SurveillanceWorkspace.jsx", import.meta.url), "utf8");
const queue = readFileSync(new URL("./workspace/SurveillanceQueueView.jsx", import.meta.url), "utf8");
const outlet = readFileSync(new URL("../../app/routes/RoleWorkspaceOutlet.jsx", import.meta.url), "utf8");
const createActions = readFileSync(new URL("../../components/layout/WorkspaceCreateActions.jsx", import.meta.url), "utf8");
const office = readFileSync(new URL("../office/OfficeWorkspace.jsx", import.meta.url), "utf8");
const operations = readFileSync(new URL("../admin/workspace/OperationsPage.jsx", import.meta.url), "utf8");
const surveillanceCss = readFileSync(new URL("./surveillance.css", import.meta.url), "utf8");

test("surveillance reuses one workspace with an in-place read-only inspection destination", () => {
  assert.match(workspace, /product === "inspections" && inspectionAccess\.canRead/);
  assert.match(workspace, /<InspectionExperience actor=\{actor\} projection="read_only" \/>/);
  assert.match(workspace, /<RoleNavigationRail actor=\{actor\} ariaLabel="Surveillance workspace"/);
  assert.match(queue, /\{rail\}/);
  assert.match(workspace, /<WorkspaceHeader actor=\{actor\} className="role-phone-account-header"/);
  assert.match(queue, /<WorkspaceHeader actor=\{actor\} className="role-phone-account-header"/);
  assert.match(outlet, /<SurveillanceWorkspace actor=\{actor\} inspectionAccess=\{inspectionAccess\} workorderAccess=\{workorderAccess\} \/>/);
});

test("shared create menu exposes exactly workorder and inspection when both callbacks are authorized", () => {
  assert.match(createActions, /id: "workorder", label: "Workorder"/);
  assert.match(createActions, /id: "inspection", label: "Inspection"/);
  assert.match(createActions, /actions\.length === 1/);
  assert.doesNotMatch(createActions, /Annual|FMCSA|Periodic/);
});

test("office and admin preserve authorized operation creation alongside the shared rail", () => {
  assert.match(office, /<RoleNavigationRail actor=\{actor\} ariaLabel="Office workspace"/);
  assert.doesNotMatch(office, /<ProductModeSwitch/);
  assert.match(operations, /title=\{product === "inspections" \? "Inspections" : "Workorders"\}/);
  assert.doesNotMatch(operations, /OperationsViewTitle|MenuTrigger|operations-page-title-trigger/);
  assert.match(operations, /setCreatingInspection\(false\);/);
  for (const source of [office, operations]) {
    assert.match(source, /onCreateWorkorder=\{workorderAccess\.canWrite/);
    assert.match(source, /onCreateInspection=\{inspectionAccess\.canWrite/);
  }
});

test("surveillance desktop filters use standard controls while touch overrides remain 44px", () => {
  assert.match(surveillanceCss, /\.surveillance-filter-row select[^}]*min-height:\s*40px;/s);
  assert.match(surveillanceCss, /\.surveillance-filter-row \.date-picker-control\s*\{\s*min-height:\s*40px;/s);
  assert.match(surveillanceCss, /@media \(max-width: 640px\)[\s\S]*?\.surveillance-filter-row select,[\s\S]*?min-height:\s*44px;/s);
});
