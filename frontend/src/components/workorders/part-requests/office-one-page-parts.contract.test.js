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

test("office Detail uses the shared selectable labor control through the form callback", () => {
  assert.match(panel, /onLaborProductChange,/);
  assert.match(office, /onLaborProductChange=\{onLaborProductChange\}/);
  assert.match(section, /onLaborProductChange=\{onLaborProductChange\}/);
  assert.match(editor, /<LaborProductSelector[\s\S]*?onChange=\{onLaborProductChange\}/);
  assert.match(editor, /disabled=\{!laborEditable \|\| laborRepairOrderDisabled\}/);
});

test("one-page Detail Parts starts with labor plus three local inventory intake rows", () => {
  assert.match(editor, /const onePage = presentation === "one-page"/);
  assert.match(editor, /if \(onePage\) \{[\s\S]*?<WorkorderPartsTable columns=\{DETAIL_WORKORDER_PARTS_COLUMNS\} className="detail-operational-parts-editor used-parts-items-table used-parts-one-page-table">/);
  assert.match(editor, /\{renderPartsColumnHead\(\)\}[\s\S]*?<WorkorderPartsRow className="used-part-labor-row"/);
  assert.match(editor, /activeSerializedParts\.map\([\s\S]*recordedManualParts\.map\(/);
  assert.match(editor, /const \[onePageIntakeCount, setOnePageIntakeCount\] = useState\(DEFAULT_PART_ENTRY_ROWS\)/);
  assert.match(editor, /const localIntakeRowCount = Math\.max\(0, onePageIntakeCount - activeSerializedParts\.length - recordedManualParts\.length\)/);
  assert.match(editor, /Array\.from\(\{ length: localIntakeRowCount \}/);
  assert.match(editor, /id=\{`workorder-part-intake-row-\$\{intakeIndex\}`\}/);
  assert.match(editor, /const \[onePageIntakeQueries, setOnePageIntakeQueries\][\s\S]*?Array\.from\(\{ length: DEFAULT_PART_ENTRY_ROWS \}/);
  assert.doesNotMatch(editor.match(/if \(onePage\) \{[\s\S]*?\n  \}\n\n  if \(!partsEditable/)[0], /used-parts-empty/);
  assert.match(editorCss, /\.used-parts-one-page-table \{[\s\S]*?--workorder-parts-quantity-track: 158px/s);
  assert.match(editorCss, /\.used-parts-one-page-table \.quantity-unit-input \{[\s\S]*?grid-template-columns: 90px 60px/s);
  assert.match(editorCss, /\.used-parts-one-page-table \{[\s\S]*?minmax\(140px, 0\.55fr\)/s);
  assert.match(editorCss, /\.used-parts-one-page-table \.used-parts-manual-picker \.part-catalog-field > input \{[\s\S]*?border-bottom: 1px solid #d0d5dd/s);
});

test("starter intake slots stay local until the existing inventory lifecycle completes", () => {
  const onePage = editor.match(/if \(onePage\) \{[\s\S]*?\n  \}\n\n  if \(!partsEditable/)[0];
  assert.match(editor, /Detail's starter rows are intentionally local/);
  assert.match(onePage, /purpose="workorder_assignment"/);
  assert.match(editor, /const \[activeOnePageIntakeIndex, setActiveOnePageIntakeIndex\] = useState\(null\)/);
  assert.match(editor, /function clearActiveOnePageIntake\(\)[\s\S]*?updateOnePageIntakeQuery\(activeOnePageIntakeIndex, ""\)/);
  assert.match(onePage, /setActiveOnePageIntakeIndex\(intakeIndex\)/);
  assert.doesNotMatch(onePage, /onSave\(/);
  assert.doesNotMatch(onePage, /onChange=\{onPartsChange\}/);
});

test("office request actions remain rendered after the one-page table", () => {
  assert.match(office, /<OfficePartComposer detail=\{detail\} onChanged=\{onChanged\} \/>/);
  assert.match(office, /requests\.map\(\(request\) => \(/);
  assert.match(office, /presentation === "one-page" \? " is-one-page" : ""/);
});
