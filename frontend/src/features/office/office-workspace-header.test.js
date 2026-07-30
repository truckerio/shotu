import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workspace = readFileSync(new URL("./OfficeWorkspace.jsx", import.meta.url), "utf8");
const mechanicWorkspace = readFileSync(new URL("../mechanic/MechanicWorkspace.jsx", import.meta.url), "utf8");
const surveillanceWorkspace = readFileSync(new URL("../surveillance/SurveillanceWorkspace.jsx", import.meta.url), "utf8");

test("Manager uses the shared workspace identity header and a separate page title", () => {
  assert.match(workspace, /<WorkspaceHeader actor=\{actor\} className="role-home-account-header"\s*\/>/);
  assert.match(workspace, /<PageHeader\s+title="Workorders"/);
  assert.match(workspace, /<WorkspaceCreateActions actor=\{actor\}/);
});

test("every operational role uses the same workspace identity and page-title structure", () => {
  for (const source of [workspace, mechanicWorkspace, surveillanceWorkspace]) {
    assert.match(source, /<WorkspaceHeader actor=\{actor\}/);
    assert.match(source, /<PageHeader[\s\S]*?title="Workorders"/);
    assert.doesNotMatch(source, /title=\{<ProfileMenu/);
  }
});

test("Manager and Mechanic share one phone Create and profile action owner", () => {
  for (const source of [workspace, mechanicWorkspace]) {
    assert.match(source, /className="role-home-account-header"/);
    assert.match(source, /<WorkspaceCreateActions actor=\{actor\} onCreateWorkorder=\{onCreateWorkorder\}/);
  }
});

test("Manager queue controls clear incompatible Unassigned filters", () => {
  assert.match(workspace, /officeQueueFilterState\(nextTab, \{ lifecycleFilter, mechanicFilter \}\)/);
  assert.match(workspace, /officeTabForMechanicFilter\(current, nextMechanic\)/);
  assert.match(workspace, /WorkorderQueueTabs tabs=\{tabs\} activeTab=\{activeTab\} onChange=\{selectQueue\}/);
  assert.match(workspace, /onClick=\{\(\) => selectMechanic\(mechanic\.name\)\}/);
});

test("every role exposes a recovery action when a narrowing filter hides its queue", () => {
  assert.match(workspace, /onClearFilters=\{clearOfficeFilters\}/);
  assert.match(workspace, /Current filters hide this queue/);
  assert.match(mechanicWorkspace, /No matching jobs[\s\S]*Clear search/);
  assert.match(surveillanceWorkspace, /onClearFilters=\{clearSurveillanceFilters\}/);
  assert.match(surveillanceWorkspace, /Current filters hide this queue/);
});
