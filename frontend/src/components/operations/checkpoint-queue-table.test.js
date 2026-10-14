import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("Workorder row forwards injected checkpoint identity and batch metadata to the DOM row", () => {
  const workspace = read("./OperationsWorkspace.jsx");
  assert.match(workspace, /function OperationRow\(\{ item, onOpenWorkorder, \.\.\.rowProps \}\)/);
  assert.match(workspace, /<OperationalCollectionRow\s+\{\.\.\.rowProps\}/);
});

test("checkpoint scrolling is shared by main and embedded Workorders", () => {
  const workspace = read("./OperationsWorkspace.jsx");
  assert.match(workspace, /checkpointScrolling = true/);
  assert.match(workspace, /checkpointScrolling && !\["drafts", "parts"\]\.includes\(filters.category\)/);
  assert.match(read("../../features/admin/workspace/OperationsPage.jsx"), /<OperationsWorkspace[^>]*checkpointScrolling/);
  assert.doesNotMatch(read("../../features/admin/workspace/LocationsPage.jsx"), /checkpointScrolling/);
  assert.match(workspace, /<CollectionPagination enabled=\{!checkpointEnabled\}/);
});

test("shared checkpoint table has independent rail gutter, measured anchors, and inline recovery", () => {
  const table = read("../ui/CheckpointCollection.jsx");
  assert.match(read("./CheckpointQueueTable.jsx"), /<CheckpointCollection/);
  assert.match(table, /data-checkpoint-item/);
  assert.match(table, /getBoundingClientRect\(\).top - view.top - saved.offset/);
  assert.match(table, /queue\.retry\(\)/);
  assert.match(table, /queue\.pageCount > 1 \? <CheckpointRail/);
  assert.match(table, /window.addEventListener\("scroll"/);
  assert.match(read("./checkpoint-queue-table.css"), /grid-template-columns: 25px minmax\(0, 1fr\)/);
});

test("rail stays within the same card padding as the toolbar fields", () => {
  const css = read("./checkpoint-queue-table.css");
  assert.doesNotMatch(css, /margin-left:\s*-16px/);
  assert.match(css, /grid-template-columns: 25px minmax\(0, 1fr\)/);
});

test("semantic virtual tables own their spacers so headers span unloaded batches", () => {
  const presenter = read("../ui/CheckpointCollection.jsx");
  assert.match(presenter, /renderedRows\?\.type === OperationalDataTable \|\| renderedRows\?\.type === OperationalCollectionTable/);
  assert.match(presenter, /cloneElement\(renderedRows, \{ checkpointSpacing: spacing \}\)/);
  assert.match(read("../ui/OperationalDataTable.jsx"), /<Row id="checkpoint-spacer-before" data-checkpoint-spacer="before" aria-hidden="true"/);
  assert.match(read("../ui/OperationalDataTable.jsx"), /aria-hidden="true" isDisabled disabledBehavior="all"/);
  assert.match(read("../ui/OperationalDataTable.jsx"), /colSpan=\{columns.length\}/);
  assert.match(read("./OperationalCollectionPage.jsx"), /checkpointSpacing\?\.after > 0/);
  assert.match(presenter, /if \(view\) fitViewport\(view\)/);
});

test("shared checkpoint headers stay locked with a non-interactive fade on desktop", () => {
  const presenter = read("../ui/CheckpointCollection.jsx");
  const css = read("../ui/checkpoint-collection.css");
  assert.match(css, /\.checkpoint-collection \.operational-collection-table-head \{ position: sticky; top: 0; z-index: 2; \}/);
  assert.match(css, /\.checkpoint-collection :is\(\.operational-collection-table-head, \[data-checkpoint-header\]\)::after\s*\{[^}]*linear-gradient\(to bottom, rgb\(249 250 251 \/ 70%\), rgb\(249 250 251 \/ 25%\) 40%,[^}]*height: 16px;[^}]*inset: 100% 0 auto;[^}]*pointer-events: none;[^}]*position: absolute;/);
  assert.match(css, /\.checkpoint-collection-viewport thead \[role="columnheader"\]::after\s*\{[^}]*linear-gradient\(to bottom,[^}]*pointer-events: none;/);
  assert.match(presenter, /renderedRows\?\.type === OperationalDataTable[\s\S]*?"is-data-table-frame"[\s\S]*?renderedRows\?\.type === OperationalCollectionTable \? "is-collection-table-frame"/);
  assert.match(css, /\.checkpoint-collection-viewport\.is-collection-table-frame\s*\{[^}]*border: 1px solid #d0d5dd;[^}]*border-radius: 8px;/);
  assert.match(css, /\.checkpoint-collection-viewport\.is-data-table-frame\s*\{[^}]*border: 1px solid #e4e7ec;[^}]*border-radius: 10px;/);
  assert.match(css, /\.checkpoint-collection-viewport\.is-collection-table-frame > \.operational-collection-table,[\s\S]*?\.is-data-table-frame > \.operational-data-table-frame\s*\{[^}]*border: 0;[^}]*border-radius: 0;/);
  assert.match(css, /\.checkpoint-collection \.checkpoint-collection-viewport > \.operational-collection-table\s*\{[^}]*overflow: visible;/);
  assert.match(css, /@media \(max-width: 700px\)[\s\S]*\.checkpoint-collection-viewport thead \{ position: static; \}/);
  assert.match(css, /@media \(max-width: 700px\)[\s\S]*\.checkpoint-collection-viewport:is\(\.is-collection-table-frame, \.is-data-table-frame\)\s*\{[^}]*border: 0;[^}]*border-radius: 0;/);
});
