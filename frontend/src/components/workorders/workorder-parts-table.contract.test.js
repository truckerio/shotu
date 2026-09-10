import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(name) {
  return readFileSync(new URL(name, import.meta.url), "utf8");
}

const table = source("./WorkorderPartsTable.jsx");
const tableCss = source("./workorder-parts-table.css");
const usedParts = source("./UsedPartsEditor.jsx");
const usedPartsCss = source("./used-parts-editor.css");
const createParts = source("../../features/workorder-modules/parts/CreatePartsModule.jsx");

test("labor uses the same unboxed row surface as parts", () => {
  assert.doesNotMatch(tableCss, /\.operational-part-labor-row\s*\{[^}]*(?:background|border|padding)\s*:/s);
});

test("shared parts grid has backward-compatible default and detail column contracts", () => {
  assert.match(table, /export const DEFAULT_WORKORDER_PARTS_COLUMNS = Object\.freeze\(\[[\s\S]*?PRODUCT,[\s\S]*?QUANTITY_UOM,[\s\S]*?REPAIR_ORDER,/);
  assert.match(table, /export const DETAIL_WORKORDER_PARTS_COLUMNS = Object\.freeze\(\[[\s\S]*?\.\.\.DEFAULT_WORKORDER_PARTS_COLUMNS,[\s\S]*?STATUS_ACTION,/);
  assert.match(table, /columns,/);
  assert.match(table, /legacyDetailColumns = className\.split\(" "\)\.includes\("used-parts-items-table"\)/);
  assert.match(table, /gridTemplate/);
  assert.match(table, /data-workorder-parts-columns=\{normalizedColumns\.join\(" "\)\}/);
  assert.match(table, /"--workorder-parts-grid-template": gridTemplate \|\| gridTemplateFor\(normalizedColumns\)/);
  assert.match(table, /\{children\}/);
});

test("each declared column contributes a track, including future authorized columns", () => {
  assert.match(table, /export const WORKORDER_PARTS_COLUMN_DESCRIPTORS = Object\.freeze\(/);
  assert.match(table, /const columnTracks = columns\.map\(\(column\) => \([\s\S]*?WORKORDER_PARTS_COLUMN_DESCRIPTORS\[column\]\?\.track \|\| FUTURE_COLUMN_TRACK/s);
  assert.match(table, /return \[ROW_ORDINAL_TRACK, \.\.\.columnTracks, \.\.\.trailingTrack\]\.join\(" "\);/);
  assert.match(table, /CREATE_ROW_ACTION_TRACK/);
  assert.match(table, /STATUS_ACTION\)[\s\S]*?\? \[\][\s\S]*?: \[CREATE_ROW_ACTION_TRACK\]/s);
});

test("shared header renders only the declared visible columns", () => {
  assert.match(table, /export function WorkorderPartsColumnHead/);
  assert.match(table, /normalizedColumns\.map\(\(column\) => <span key=\{column\}>\{labels\?\.\[column\] \|\| ""\}<\/span>\)/);
  assert.match(tableCss, /\.workorder-parts-grid > \.operational-part-row\s*\{[^}]*grid-template-columns:\s*var\(--workorder-parts-grid-template\);/s);
});

test("Create and detail consume the shared contract without changing row children", () => {
  assert.match(createParts, /columns=\{DEFAULT_WORKORDER_PARTS_COLUMNS\}/);
  assert.match(createParts, /<WorkorderPartsColumnHead[\s\S]*?className="create-parts-column-head"[\s\S]*?columns=\{DEFAULT_WORKORDER_PARTS_COLUMNS\}/);
  assert.match(createParts, /WORKORDER_PARTS_COLUMNS\.PRODUCT]: t\("create\.parts\.part"\)/);
  assert.match(createParts, /WORKORDER_PARTS_COLUMNS\.QUANTITY_UOM]: t\("parts\.quantityUnit"\)/);
  assert.match(createParts, /WORKORDER_PARTS_COLUMNS\.REPAIR_ORDER]: t\("create\.parts\.repairOrder"\)/);
  assert.match(usedParts, /<WorkorderPartsColumnHead[\s\S]*?columns=\{DETAIL_WORKORDER_PARTS_COLUMNS\}/);
  assert.match(usedParts, /WORKORDER_PARTS_COLUMNS\.PRODUCT]: t\("parts\.part"\)/);
  assert.match(usedParts, /WORKORDER_PARTS_COLUMNS\.QUANTITY_UOM]: t\("parts\.quantityUnit"\)/);
  assert.match(usedParts, /WORKORDER_PARTS_COLUMNS\.REPAIR_ORDER]: t\("parts\.repairOrder"\)/);
  assert.match(usedParts, /WORKORDER_PARTS_COLUMNS\.STATUS_ACTION]: t\("parts\.statusAction"\)/);
  assert.match(usedPartsCss, /\.used-parts-editor \.used-part-serialized-row\s*\{[^}]*grid-template-columns:\s*var\(--workorder-parts-grid-template\);/s);
});
