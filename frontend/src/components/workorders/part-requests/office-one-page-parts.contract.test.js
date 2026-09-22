import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(name) {
  return readFileSync(new URL(name, import.meta.url), "utf8");
}

const panel = source("../PartRequestsPanel.jsx");
const office = source("./OfficePartsSurface.jsx");
const section = source("./UsedPartsSection.jsx");
const editor = source("../UsedPartsEditor.jsx");
const editorCss = source("../used-parts-editor.css");

test("office one-page Parts reaches the used-parts editor without changing mechanic presentation", () => {
  assert.match(panel, /presentation = "panel"/);
  assert.match(panel, /<OfficePartsSurface \{\.\.\.commonProps\} presentation=\{presentation\} \/>/);
  assert.match(panel, /<MechanicPartsSurface \{\.\.\.commonProps\} locale=\{locale\} \/>/);
  assert.match(office, /presentation = "panel"/);
  assert.match(office, /<UsedPartsSection[\s\S]*presentation=\{presentation\}/);
  assert.match(section, /presentation = "panel"/);
  assert.match(section, /presentation=\{presentation\}/);
});

test("office Detail passes the shared labor control through the shared parts table", () => {
  assert.match(panel, /onLaborProductChange,/);
  assert.match(office, /onLaborProductChange=\{onLaborProductChange\}/);
  assert.match(section, /onLaborProductChange=\{onLaborProductChange\}/);
  assert.match(editor, /<WorkorderPartsTable className="detail-operational-parts-editor used-parts-labor-table">[\s\S]*?<LaborProductSelector[\s\S]*?<QuantityUnitInput/);
  assert.match(editor, /onChange=\{onLaborProductChange \|\| \(\(\) => \{\}\)\}/);
  assert.match(editor, /<LaborProductSelector[\s\S]*?disabled=\{!laborEditable\}/);
  assert.match(editor, /<QuantityUnitInput[\s\S]*?id="workorder-labor-hours"[\s\S]*?disabled=\{!laborEditable \|\| laborRepairOrderDisabled\}/);
});

test("one-page Detail Parts stays on the shared table lifecycle surface", () => {
  assert.match(editor, /const onePage = presentation === "one-page"/);
  assert.match(editor, /<WorkorderPartsTable className="detail-operational-parts-editor used-parts-items-table">/);
  assert.match(editor, /activeSerializedParts\.map\(\(part, index\) => renderSerializedPartRow/);
  assert.match(editor, /recordedManualParts\.map\(\(part, index\) => renderRecordedPartRow/);
  assert.doesNotMatch(editor, /CompactWorkorderParts|if \(onePage\)/);
  assert.doesNotMatch(editorCss, /\.compact-workorder-parts/);
});

test("one-page catalog selection stays in the existing inventory lifecycle", () => {
  assert.match(editor, /const \[serializedDialogPart, setSerializedDialogPart\]/);
  assert.match(editor, /<PartCatalogCombobox[\s\S]*onSelect=\{\(catalogPart\) => \{[\s\S]*setCatalogQuery\(catalogPart\.partNumber\)[\s\S]*setSerializedDialogPart\(catalogPart\)/);
  assert.match(editor, /\{serializedDialog\}/);
  assert.match(editor, /onReserved=\{async \(usage\) => \{[\s\S]*serializedParts\?\.recordUsage\?\.\(usage\)/);
  assert.match(editor, /anchorToPartField=\{onePage\}/);
});

test("office request actions remain rendered after the one-page table", () => {
  assert.match(office, /<OfficePartComposer detail=\{detail\} onChanged=\{onChanged\} \/>/);
  assert.match(office, /requests\.map\(\(request\) => \(/);
  assert.match(office, /presentation === "one-page" \? " is-one-page" : ""/);
});
