import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("./ModulesPage.jsx", import.meta.url), "utf8");
const shell = await readFile(new URL("../workspace/AdminWorkspaceShell.jsx", import.meta.url), "utf8");
const workspace = await readFile(new URL("../AdminWorkspace.jsx", import.meta.url), "utf8");
const controller = await readFile(new URL("./useAdminModulesController.js", import.meta.url), "utf8");
const styles = await readFile(new URL("./modules.css", import.meta.url), "utf8");

test("Modules page uses the canonical catalog and progressive module management", () => {
  assert.match(page, /WORKORDER_MODULES/);
  assert.match(page, /Search modules/);
  assert.match(page, /User exceptions/);
  assert.match(page, /Effective access:/);
  assert.match(page, /<details className="admin-module-exceptions">/);
  assert.match(page, /Required to create/);
  assert.match(page, /moduleSupportsWrite\(module\)/);
  assert.match(page, /This module is view-only and has no edit actions/);
  assert.match(page, /module\.key === "partsScanning"/);
  assert.match(page, /Mechanics are off by default/);
  assert.match(page, /without granting broader Parts edits/);
  assert.match(page, /Use system default/);
  assert.match(page, /Use company default/);
  assert.match(page, /Use company role setting/);
  assert.match(page, /Use location role setting/);
  assert.doesNotMatch(page, /DEFAULT_ACCESS|const MODULES =/);
});

test("admin shell exposes Modules as a first-class destination", () => {
  assert.match(shell, /<ModulesPage/);
  assert.match(shell, />Modules<\/button>/);
  assert.match(workspace, /adminView=modules/);
  assert.match(workspace, /modulePageProps/);
  assert.match(workspace, /useAdminModulesController/);
  assert.match(controller, /openLocation\(id, "work", "modules"\)/);
  assert.match(controller, /expectedVersion: companyPolicy\.version/);
  assert.match(controller, /expectedVersion: policy\.version/);
  assert.match(controller, /userModuleAccess: companyPolicy\.userModuleAccess/);
  assert.match(controller, /error\.status === 409/);
  assert.match(controller, /await loadCompanyPolicy\(companyId\)/);
  assert.match(controller, /\/workorder-policy/);
  assert.match(page, /titleRef\.current\?\.focus\(\)/);
  assert.match(page, /ref=\{titleRef\} tabIndex="-1"/);
});

test("Modules page keeps shared keyboard dropdowns and responsive containment contracts", () => {
  assert.match(page, /<ContextBreadcrumbs/);
  assert.match(page, /label: "Modules"/);
  assert.match(page, /href: "\/\?adminView=modules"/);
  assert.match(page, /isPlainPrimaryActivation\(event\)/);
  assert.match(page, /\.admin-module-card/);
  assert.match(page, /focus\(\{ preventScroll: true \}\)/);
  assert.doesNotMatch(page, /← All modules/);
  assert.match(page, /<Dropdown aria-label=\{label\} value=\{presentedValue\}/);
  assert.match(page, /<details className="admin-module-exceptions">/);
  assert.match(page, /role="tablist"/);
  assert.match(page, /aria-selected=\{surface === item\}/);
  assert.match(styles, /@media \(max-width: 760px\)/);
  assert.match(styles, /minmax\(0, 1fr\)/);
  assert.match(styles, /min-width: 0/);
  assert.doesNotMatch(styles, /overflow-x:\s*(scroll|auto)/);
});

test("back navigation styling does not override the primary save action", () => {
  assert.match(page, /className="admin-module-manager-heading-row"/);
  assert.match(page, /className="admin-module-manager-identity"/);
  assert.match(styles, /\.admin-module-manager-heading-row > \.button/);
  assert.doesNotMatch(styles, /admin-module-manager-header > button:first-child/);
});

test("module manager keeps a bounded premium layout for every module", () => {
  assert.match(styles, /\.admin-module-manager \{[^}]*max-width: 1120px;/);
  assert.match(styles, /\.admin-module-role-list \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(styles, /\.admin-module-role-control \{[^}]*border: 1px solid #e4e7ec;[^}]*border-radius: 8px;/);
  assert.match(page, /className="admin-module-manager-scope"/);
  assert.match(page, /className="admin-module-exception-status"/);
  assert.match(page, /<ChevronDown aria-hidden="true"/);
  assert.match(styles, /\.admin-module-manager \.dropdown-select-trigger \{ min-height: 44px; \}/);
});
