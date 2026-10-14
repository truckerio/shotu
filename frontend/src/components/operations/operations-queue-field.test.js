import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./OperationsWorkspace.jsx", import.meta.url), "utf8");
const css = readFileSync(new URL("./operations.css", import.meta.url), "utf8");
test("desktop Queue uses the shared field selector and canonical category update", () => {
  assert.match(source, /operations-toolbar-with-queue role-desktop-filters/);
  assert.match(source, /<Dropdown aria-label="Queue" value=\{filters.category\} onChange=\{\(event\) => updateFilter\("category", event.target.value\)\}/);
  assert.match(source, /OPERATION_CATEGORIES.map\(\(category\) => <option/);
  assert.doesNotMatch(source, /<OperationalCollectionTabs/);
  assert.match(source, /<MobileQueueToolbar/);
  assert.match(css, /\.operations-toolbar-with-queue\s*\{[^}]*grid-template-columns:/s);
});
test("Queue selector remains mounted for Drafts and Part requests", () => {
  const toolbar = source.slice(source.indexOf('<OperationalCollectionToolbar className="operations-toolbar operations-toolbar-with-queue'));
  assert.ok(toolbar.indexOf('aria-label="Queue"') < toolbar.indexOf('filters.category !== "drafts"'));
  assert.match(toolbar, /filters.category === "drafts"[\s\S]*<WorkorderDraftQueue/);
  assert.match(toolbar, /filters.category === "parts"[\s\S]*<PartRequestQueue/);
});
test("desktop toolbar only exposes search and queue while columns retain refinement controls", () => {
  const toolbar = source.slice(source.indexOf('<OperationalCollectionToolbar className="operations-toolbar operations-toolbar-with-queue'), source.indexOf('Counts unavailable:'));
  assert.match(toolbar, /fields=\{\["search"\]\}/);
  assert.doesNotMatch(toolbar, /OperationsFilterPopover/);
  assert.match(source, /column label="Location"/);
  assert.match(source, /column label="Lifecycle \/ attention"/);
  assert.match(source, /column label="Created \/ age"/);
  assert.match(source, /<Dialog aria-label=\{label\}>/);
});
