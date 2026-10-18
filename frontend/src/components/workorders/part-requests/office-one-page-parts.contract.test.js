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
const laborPrice = source("../LaborPriceCell.jsx");
const measuredUsage = source("./MeasuredPartUsageDialog.jsx");
const editorCss = source("../used-parts-editor.css");

test("office and mechanic one-page Parts reach the shared used-parts editor", () => {
  assert.match(panel, /presentation = "panel"/);
  assert.match(panel, /<OfficePartsSurface \{\.\.\.commonProps\} presentation=\{presentation\} \/>/);
  assert.match(panel, /<MechanicPartsSurface \{\.\.\.commonProps\} locale=\{locale\} presentation=\{presentation\} \/>/);
  assert.match(office, /presentation = "panel"/);
  assert.match(office, /<UsedPartsSection[\s\S]*presentation=\{presentation\}/);
  assert.match(section, /presentation = "panel"/);
  assert.match(section, /presentation=\{presentation\}/);
});

test("office Detail passes the shared labor control through the shared parts table", () => {
  assert.match(panel, /onLaborProductChange,/);
  assert.match(office, /onLaborProductChange=\{onLaborProductChange\}/);
  assert.match(section, /onLaborProductChange=\{onLaborProductChange\}/);
  assert.match(editor, /<WorkorderPartsTable className="detail-operational-parts-editor used-parts-labor-table"[^>]*>[\s\S]*?<LaborProductSelector[\s\S]*?<QuantityUnitInput/);
  assert.match(editor, /onChange=\{onLaborProductChange \|\| \(\(\) => \{\}\)\}/);
  assert.match(editor, /<LaborProductSelector[\s\S]*?disabled=\{!laborEditable\}/);
  assert.match(editor, /<QuantityUnitInput[\s\S]*?id="workorder-labor-hours"[\s\S]*?disabled=\{!laborEditable \|\| laborRepairOrderDisabled\}/);
});

test("one-page Detail Parts stays on the shared table lifecycle surface", () => {
  assert.match(editor, /const onePage = presentation === "one-page"/);
  assert.match(editor, /<WorkorderPartsTable className="detail-operational-parts-editor used-parts-items-table"[^>]*>/);
  assert.match(editor, /<WorkorderPartsEntryTable[\s\S]*?className="detail-operational-parts-editor used-parts-items-table used-parts-one-page-table"/);
  assert.match(editor, /showPrice=\{canViewPrices\}/);
  assert.match(editor, /activeSerializedParts\.map\(\(part, index\) => renderSerializedPartRow/);
  assert.match(editor, /recordedManualParts\.map\(\(part, index\) => renderRecordedPartRow/);
  assert.match(editor, /initialUsedPartRows\(\[\]\)/);
  assert.match(editor, /visibleDraftRows\.map\(\(draft, index\) => renderDraftPartRow/);
  assert.match(editor, /draftRows\.slice\(0, availableUsedPartDraftCount\(recordedPartCount, draftRows\.length\)\)/);
  assert.match(editor, /onClick=\{addDraftRow\}/);
  assert.match(editor, /disabled=\{!canAddUsedPartDraft\(recordedPartCount, draftRows\.length\)\}/);
  assert.doesNotMatch(editor, /CompactWorkorderParts/);
  assert.doesNotMatch(editorCss, /\.compact-workorder-parts/);
});

test("one-page catalog selection stays in the existing inventory lifecycle", () => {
  assert.match(editor, /const \[serializedDialogPart, setSerializedDialogPart\]/);
  assert.match(editor, /<PartCatalogCombobox[\s\S]*onSelect=\{\(catalogPart\) => \{[\s\S]*setCatalogQuery\(catalogPart\.partNumber\)[\s\S]*setSerializedDialogPart\(catalogPart\)/);
  assert.match(editor, /\{serializedDialog\}/);
  assert.match(editor, /onReserved=\{async \(usage\) => \{[\s\S]*serializedParts\?\.recordUsage\?\.\(usage\)/);
  assert.match(editor, /anchorToPartField=\{onePage && activeDraftIndex >= 0\}/);
});

test("office request actions move into a shared modal opened by the Parts More menu", () => {
  assert.match(office, /<OfficePartComposer detail=\{detail\} onChanged=\{onChanged\} \/>/);
  assert.match(office, /requests\.map\(\(request\) => \(/);
  assert.match(office, /<MenuItem[^>]*textValue="Parts & supply"/);
  assert.match(office, /<ModalFrame/);
  assert.match(office, /setSupplyDialogOpen\(true\)/);
  assert.match(office, /const \[supplyDialogOpen, setSupplyDialogOpen\] = useState\(Boolean\(focusedRequestId\)\)/);
});

test("pricing controls pin displayed labor rates and respect read-only Workorders", () => {
  assert.match(laborPrice, /expectedRateVersionId/);
  assert.match(laborPrice, /if \(compact\)/);
  assert.match(laborPrice, /<ModalFrame[^>]*overlayClassName="workorder-rate-overlay"/);
  assert.match(editor, /usageKind="serialized"[^\n]*disabled=\{!partsEditable\}/);
  assert.match(editor, /<LaborPriceCell[^\n]*disabled=\{!laborEditable\}/);
  assert.match(measuredUsage, /usageKind="aggregate"[^\n]*disabled=\{!editable\}/);
});
