import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const editor = readFileSync(new URL("./UsedPartsEditor.jsx", import.meta.url), "utf8");
const section = readFileSync(new URL("./part-requests/UsedPartsSection.jsx", import.meta.url), "utf8");
const mechanicSurface = readFileSync(new URL("./part-requests/MechanicPartsSurface.jsx", import.meta.url), "utf8");
const module = readFileSync(new URL("../../features/workorder-modules/parts/WorkorderPartsModule.jsx", import.meta.url), "utf8");
const roleRouter = readFileSync(new URL("../../app/routes/RoleRouter.jsx", import.meta.url), "utf8");
const roleRouterModel = readFileSync(new URL("../../app/routes/role-router-model.js", import.meta.url), "utf8");
const detailPage = readFileSync(new URL("../../features/workorder-detail/WorkorderDetailPage.jsx", import.meta.url), "utf8");

test("mechanic used-parts interface text is owned by the selected locale", () => {
  assert.match(editor, /interfaceText\(locale, key\)/);
  assert.match(editor, /locale = "en"/);
  assert.match(editor, /parts\.noUsedPartsRecorded/);
  assert.match(editor, /progress\.saving/);
  assert.doesNotMatch(editor, /parts\.legacyManualEvidence/);
});

test("installed serialized summaries keep identity locked, edit only repair wording, and feed every preview", () => {
  assert.match(editor, /installedParts\.map/);
  assert.match(editor, /<WorkorderPartsRow[\s\S]*?className="used-part-serialized-row"/);
  assert.match(editor, /<strong>\{part\.partNo\}<\/strong>/);
  assert.match(editor, /value=\{serializedRepairOrder\(part\)\}/);
  assert.match(editor, /operation: "serializedUsageRepairOrder"/);
  assert.match(editor, /usageId: part\.usageId/);
  assert.match(editor, /await context\.onChanged\(\)/);
  assert.match(editor, /onBlur=\{\(\) => serializedRepairAutosave\.flushOne\(part\)\}/);
  assert.match(detailPage, /serializedRepairFlushRef\.current\(\)/);
  assert.match(detailPage, /runAfterSerializedRepairFlush/);
  assert.match(editor, /<RepairHistorySuggestions[\s\S]*catalogPartId=\{part\.catalogPartId\}/);
  assert.doesNotMatch(editor, /used-part-serialized-row[\s\S]{0,800}<PartCatalogCombobox/);
  assert.doesNotMatch(editor, /used-part-serialized-row[\s\S]{0,800}<QuantityUnitInput/);
  assert.match(roleRouter, /workorderPreviewForm\(form, activeWorkorder\)/);
  assert.match(roleRouterModel, /parts: workorderPreviewParts\(form\.parts, installedSerializedUsedParts\(detail\), aggregateParts\.filter\(\(usage\) => \["consumed", "installed_pending_approval"\]\.includes\(usage\.status\)\)\.map/);
  assert.match(roleRouterModel, /aggregatePartUsages/);
  assert.match(roleRouter, /useWorkorderPrintController\([\s\S]*form: previewForm/);
  assert.equal((detailPage.match(/form=\{renderedPreviewForm\}/g) || []).length, 5);
});

test("locale reaches the mechanic editor without changing office defaults", () => {
  assert.match(mechanicSurface, /<UsedPartsSection[\s\S]*locale=\{locale\}/);
  assert.match(section, /locale=\{locale\}/);
  assert.match(editor, /locale === "en" \? readonlyMessage : t\("parts\.usedPartsReadOnly"\)/);
  assert.match(module, /isMechanicDetail \? t\("parts\.usedTitle"\) : "Parts"/);
});
