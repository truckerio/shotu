import assert from "node:assert/strict";
import test from "node:test";
import { inspectionTemplateDefinitionSchema } from "./template.schemas.js";
import { inspectionPreset, INSPECTION_RENDERER_VERSION, INSPECTION_ANNUAL_RENDERER_VERSION } from "../../../../shared/inspection-template.js";
import { changeInspectionPrintLayout, changeInspectionType, createInspectionTemplate, inspectionTemplateDefinition, inspectionTemplateFromApi, inspectionTemplatePreviewHtml } from "../../../../frontend/src/features/admin/templates/inspection-template-model.js";

function roundtrip(definition) {
  return inspectionTemplateDefinition(inspectionTemplateFromApi({ id: "definition", name: definition.label, applicabilityKey: definition.assetType, presetKey: definition.presetKey,
    version: { id: "version", state: "draft", definition } }));
}

test("legacy layout absence and renderer survive model and schema roundtrip", () => {
  const definition = { ...inspectionPreset("Truck", "weekly") };
  delete definition.printLayout;
  assert.deepEqual(roundtrip(definition), definition);
  assert.equal(Object.hasOwn(inspectionTemplateDefinitionSchema.parse(definition), "printLayout"), false);
});

test("print layouts select their matching renderer and remain independent of inspection type", () => {
  const template = createInspectionTemplate("weekly-truck", "draft");
  const annual = changeInspectionPrintLayout(template, "annual_report");
  assert.equal(annual.inspectionType, "weekly");
  assert.equal(annual.rendererVersion, INSPECTION_ANNUAL_RENDERER_VERSION);
  const changedType = changeInspectionType(annual, "annual");
  assert.equal(changedType.printLayout, "annual_report");
  assert.equal(changedType.rendererVersion, INSPECTION_ANNUAL_RENDERER_VERSION);
  const saved = inspectionTemplateDefinition(changedType);
  assert.deepEqual(roundtrip(saved), saved);
  assert.equal(inspectionTemplateDefinitionSchema.safeParse(saved).success, true);
  const standard = changeInspectionPrintLayout(changedType, "standard");
  assert.equal(standard.inspectionType, "annual");
  assert.equal(standard.rendererVersion, INSPECTION_RENDERER_VERSION);
  assert.equal(inspectionTemplateDefinitionSchema.safeParse(inspectionTemplateDefinition(standard)).success, true);
});

test("definition boundary rejects mismatched layout and renderer combinations", () => {
  const standard = inspectionPreset("Truck", "weekly");
  for (const definition of [
    { ...standard, printLayout: "annual_report" },
    { ...standard, printLayout: "standard", rendererVersion: INSPECTION_ANNUAL_RENDERER_VERSION },
    { ...standard, rendererVersion: INSPECTION_ANNUAL_RENDERER_VERSION },
    { ...standard, printLayout: "unrecognized" },
  ]) assert.equal(inspectionTemplateDefinitionSchema.safeParse(definition).success, false);
});

test("annual starters support all paper sections within the existing check limit", () => {
  for (const unitType of ["Truck", "Trailer"]) {
    const definition = inspectionPreset(unitType, "annual");
    assert.equal(definition.sections.length, 15);
    assert.equal(definition.sections.flatMap((section) => section.items).length, 56);
    assert.equal(inspectionTemplateDefinitionSchema.safeParse(definition).success, true);
    assert.deepEqual(roundtrip(definition), definition);
  }
});

test("preview renders the selected print document with pending sample evidence", () => {
  const template = createInspectionTemplate("annual-truck", "draft");
  template.name = '<script>alert("unsafe")</script>';
  const html = inspectionTemplatePreviewHtml(template);
  assert.match(html, /Sample unit/);
  assert.doesNotMatch(html, /<script>/i);
  assert.match(html, /IN PROGRESS/);
  assert.match(html, /&lt;script&gt;/);
});
