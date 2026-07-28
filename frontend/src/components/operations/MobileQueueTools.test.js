import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const componentUrl = new URL("./MobileQueueTools.jsx", import.meta.url);
const toolbarUrl = new URL("./MobileQueueToolbar.jsx", import.meta.url);
const adminWorkspaceUrl = new URL("./OperationsWorkspace.jsx", import.meta.url);
const cssUrl = new URL("./mobile-queue-tools.css", import.meta.url);

test("mobile queue tools use the accessible shared dialog contract", async () => {
  const source = await readFile(componentUrl, "utf8");

  assert.match(source, /aria-haspopup="dialog"/);
  assert.match(source, /aria-expanded=\{open\}/);
  assert.match(source, /<MobileFilterSheet/);
  assert.match(source, /onClearFilters/);
  assert.match(source, /Show results/);
});

test("mobile queue trigger and actions meet the 44px target", async () => {
  const css = await readFile(cssUrl, "utf8");

  assert.match(css, /\.mobile-queue-tools-trigger\s*\{[\s\S]*height: 44px;[\s\S]*width: 44px;/);
  assert.match(css, /\.mobile-queue-tools-footer button\s*\{[\s\S]*min-height: 44px;/);
});

test("phone queue toolbar keeps shared tabs and filter on one line", async () => {
  const css = await readFile(cssUrl, "utf8");
  const toolbar = await readFile(toolbarUrl, "utf8");
  const adminWorkspace = await readFile(adminWorkspaceUrl, "utf8");
  const phoneRules = css.slice(css.indexOf("@media (max-width: 700px)"));

  assert.match(toolbar, /<WorkorderQueueTabs/);
  assert.match(toolbar, /<MobileQueueTools/);
  assert.match(adminWorkspace, /<MobileQueueToolbar/);
  assert.match(adminWorkspace, /className="role-mobile-primary-queues"/);
  assert.match(phoneRules, /\.mobile-queue-toolbar\.mobile-queue-toolbar\s*\{[\s\S]*display: flex;[\s\S]*padding-right: 48px;[\s\S]*position: relative;/);
  assert.match(phoneRules, /\.mobile-queue-toolbar\.mobile-queue-toolbar \.mechanic-queue-tabs\s*\{[\s\S]*grid-template-columns: none;[\s\S]*justify-content: space-between;/);
  assert.match(phoneRules, /\.mechanic-queue-tabs button\s*\{[\s\S]*font-size: 11px;[\s\S]*white-space: nowrap;/);
  assert.match(phoneRules, /\.mechanic-queue-tabs button strong\s*\{[\s\S]*height: 20px;[\s\S]*min-width: 20px;/);
  assert.match(phoneRules, /\.mobile-queue-toolbar > \.mobile-queue-tools\s*\{[\s\S]*position: absolute;[\s\S]*right: 0;[\s\S]*top: 50%;/);
  assert.match(css, /\.mobile-queue-tools-trigger\s*\{[\s\S]*background: transparent;[\s\S]*border: 0;/);
  assert.match(css, /\.mobile-queue-tools-trigger:focus-visible\s*\{/);
  assert.match(css, /\.mobile-queue-tools-indicator\s*\{/);
});
