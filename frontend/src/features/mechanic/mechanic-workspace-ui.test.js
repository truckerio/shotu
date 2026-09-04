import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workspace = readFileSync(new URL("./MechanicWorkspace.jsx", import.meta.url), "utf8");
const css = readFileSync(new URL("./mechanic-workspace.css", import.meta.url), "utf8");

test("desktop mechanic home exposes one next-job action and visible queue tools", () => {
  assert.match(workspace, /<h2>\{t\("mechanic\.nextJob"\)\}<\/h2>/);
  assert.match(workspace, /className="[^"]*mechanic-next-job-action[^"]*"/);
  assert.match(workspace, /mechanicJobActionKey\(nextJob\)/);
  assert.match(workspace, /className="mechanic-wide-queues"[\s\S]*tabs=\{queueTabs\}/);
  assert.match(workspace, /className="mechanic-visible-tools"[\s\S]*aria-label=\{t\("mechanic\.searchWorkorders"\)\}/);
  assert.match(css, /\.mechanic-home-more[\s\S]*display:\s*none/);
});

test("create workorder stays visible in the shared page actions instead of More", () => {
  const pageHeader = workspace.indexOf("<PageHeader");
  const createAction = workspace.indexOf("<WorkspaceCreateActions");
  const primaryStart = workspace.indexOf('className="mechanic-primary-queues"');
  const moreStart = workspace.indexOf('className="mechanic-home-more"');

  assert.ok(pageHeader >= 0);
  assert.ok(createAction >= 0);
  assert.match(workspace.slice(pageHeader, primaryStart), /actions=\{createActions\}/);
  assert.ok(primaryStart >= 0);
  assert.ok(createAction < moreStart);
  assert.equal(workspace.slice(moreStart).includes("mechanic.createWorkorder"), false);
  assert.match(workspace, /actor=\{actor\}[\s\S]*onCreateWorkorder=\{workorderAccess\.canWrite \? onCreateWorkorder : null\}[\s\S]*createLabel=\{t\("mechanic\.createWorkorder"\)\}/);
});

test("phone mechanic home shows three important queues and keeps secondary queues in More", () => {
  assert.match(workspace, /className="mechanic-phone-queues"[\s\S]*tabs=\{phonePrimaryTabs\}/);
  assert.match(workspace, /className="mechanic-secondary-queues"[\s\S]*tabs=\{phoneSecondaryTabs\}/);
  assert.match(css, /@media \(max-width:\s*700px\)[\s\S]*\.mechanic-primary-queues \.mechanic-queue-tabs[\s\S]*grid-template-columns:\s*repeat\(3,/);
  assert.match(css, /@media \(max-width:\s*700px\)[\s\S]*\.mechanic-home-more[\s\S]*display:\s*block/);
});

test("search stays outside the compact More disclosure", () => {
  const visibleTools = workspace.indexOf('className="mechanic-visible-tools"');
  const moreStart = workspace.indexOf('className="mechanic-home-more"');
  assert.ok(visibleTools >= 0);
  assert.ok(moreStart > visibleTools);
  assert.match(workspace.slice(visibleTools, moreStart), /aria-label=\{t\("mechanic\.searchWorkorders"\)\}/);
  assert.equal(workspace.slice(moreStart).includes('t("mechanic.searchWorkorders")'), false);
});

test("mechanic home keeps a readable desktop column and overflow-safe children", () => {
  assert.match(css, /--mechanic-home-max-width:\s*1440px/);
  assert.match(css, /\.mechanic-home-content[\s\S]*max-width:\s*var\(--mechanic-home-max-width\)/);
  assert.match(css, /\.mechanic-home-content[\s\S]*min-width:\s*0/);
  assert.match(css, /\.mechanic-next-job[\s\S]*overflow-wrap:\s*anywhere/);
  assert.match(css, /@media \(max-width:\s*1366px\)/);
});

test("combined inspection queues expose accurate counts and explicit claim actions", () => {
  assert.match(workspace, /dashboard\?\.counts\[tab\.countKey\][\s\S]*item\.queueType === "inspection"/);
  assert.match(workspace, /workorder\.status === "requested"[\s\S]*productModuleCapabilities\(actor, "inspections", workorder\.inspection\.locationId\)\.canWrite/);
  assert.match(workspace, /\/actions\/claim/);
  assert.match(workspace, /expectedVersion:item\.inspection\.version/);
  assert.match(workspace, /mechanic\.acceptInspection/);
});
