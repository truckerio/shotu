import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./OperationsWorkspace.jsx", import.meta.url), "utf8");
const filterSource = readFileSync(new URL("./OperationsFilterPopover.jsx", import.meta.url), "utf8");
const filterCss = readFileSync(new URL("./operations-filter-popover.css", import.meta.url), "utf8");
const css = readFileSync(new URL("./operations.css", import.meta.url), "utf8");
test("workorder column filters place icons at the far edge of each header", () => {
  const columnRule = filterCss.match(/^\.operations-filter-trigger\.is-column \{([^}]+)\}/m)?.[1];
  assert.ok(columnRule, "column trigger owns alignment without a table-specific ancestor");
  assert.match(columnRule, /justify-content: space-between;/);
  assert.match(columnRule, /width: 100%;/);
  assert.doesNotMatch(columnRule, /justify-content: flex-start/);
});
test("desktop Queue uses the shared field selector and canonical category update", () => {
  assert.match(source, /operations-toolbar-with-queue role-desktop-filters/);
  assert.match(source, /<WorkorderQueueFilter value=\{filters.category\} onChange=\{\(value\) => updateFilter\("category", value\)\}/);
  assert.match(source, /OPERATION_CATEGORIES.map\(\(category\) => \(/);
  assert.doesNotMatch(source, /<OperationalCollectionTabs/);
  assert.match(source, /<MobileQueueToolbar/);
  assert.match(css, /\.operations-toolbar-with-queue\s*\{[^}]*grid-template-columns:/s);
});
test("Queue selector remains mounted for Drafts and Part requests", () => {
  const toolbar = source.slice(source.indexOf('<OperationalCollectionToolbar className="operations-toolbar operations-toolbar-with-queue'));
  assert.ok(toolbar.indexOf('<WorkorderQueueFilter') < toolbar.indexOf('filters.category !== "drafts"'));
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
  assert.match(filterSource, /<Dialog aria-label=\{label\}>/);
});
