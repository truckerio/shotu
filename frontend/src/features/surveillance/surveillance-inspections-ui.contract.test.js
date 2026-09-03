import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workspace = readFileSync(new URL("./SurveillanceWorkspace.jsx", import.meta.url), "utf8");
const queue = readFileSync(new URL("./workspace/SurveillanceQueueView.jsx", import.meta.url), "utf8");
const outlet = readFileSync(new URL("../../app/routes/RoleWorkspaceOutlet.jsx", import.meta.url), "utf8");
const createActions = readFileSync(new URL("../../components/layout/WorkspaceCreateActions.jsx", import.meta.url), "utf8");
const office = readFileSync(new URL("../office/OfficeWorkspace.jsx", import.meta.url), "utf8");
const operations = readFileSync(new URL("../admin/workspace/OperationsPage.jsx", import.meta.url), "utf8");

test("surveillance reuses one workspace with an in-place read-only inspection destination", () => {
  assert.match(workspace, /product === "inspections" && inspectionAccess\.canRead/);
  assert.match(workspace, /<InspectionExperience actor=\{actor\} projection="read_only" \/>/);
  assert.match(workspace, /<ProductModeSwitch value=\{product\} onChange=\{setProduct\} \/>/);
  assert.match(queue, /inspectionAccess\.canRead && workorderAccess\.canRead/);
  assert.match(outlet, /<SurveillanceWorkspace actor=\{actor\} inspectionAccess=\{inspectionAccess\} workorderAccess=\{workorderAccess\} \/>/);
});

test("shared create menu exposes exactly workorder and inspection when both callbacks are authorized", () => {
  assert.match(createActions, /id: "workorder", label: "Workorder"/);
  assert.match(createActions, /id: "inspection", label: "Inspection"/);
  assert.match(createActions, /actions\.length === 1/);
  assert.doesNotMatch(createActions, /Annual|FMCSA|Periodic/);
});

test("office retains the shared switch while admin owns a title menu and both authorize create entries", () => {
  assert.match(office, /<ProductModeSwitch value=\{product\}/);
  assert.match(office, /inspectionAccess\.canRead \? <ProductModeSwitch/);
  assert.match(operations, /<OperationsTitle product=\{product\} canSwitch=\{canSwitch\} onChange=\{changeProduct\}/);
  assert.match(operations, /<MenuTrigger>/);
  assert.match(operations, /const canSwitch = inspectionAccess\.canRead && workorderAccess\.canRead;/);
  assert.match(operations, /setCreatingInspection\(false\);/);
  for (const source of [office, operations]) {
    assert.match(source, /onCreateWorkorder=\{workorderAccess\.canWrite/);
    assert.match(source, /onCreateInspection=\{inspectionAccess\.canWrite/);
  }
});
