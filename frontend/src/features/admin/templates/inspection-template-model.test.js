import assert from "node:assert/strict";
import test from "node:test";
import { INSPECTION_PRESETS as CANONICAL_PRESETS } from "../../../../../shared/inspection-template.js";
import { INSPECTION_PRESETS, changeInspectionType, matchingInspectionAssignments, eligibleInspectionTemplates, cloneInspectionTemplate, createInspectionTemplate, inspectionTemplateFromApi, inspectionTemplateDefinition, inspectionTemplateSummary, moveInspectionItem, validateInspectionTemplate } from "./inspection-template-model.js";

test("canonical presets provide all inspection types for truck and trailer", () => {
  assert.deepEqual(INSPECTION_PRESETS.filter((entry) => entry.inspectionType === "weekly").map(({ id }) => id), ["weekly-truck", "weekly-trailer"]);
  assert.equal(new Set(INSPECTION_PRESETS.map((entry) => entry.id)).size, 10);
  const template = createInspectionTemplate("weekly-truck", "truck-1");
  assert.equal(template.status, "draft");
  assert.match(inspectionTemplateSummary(template), /3 sections · 12 checks/);
  assert.deepEqual(template.sections[0].checks[0].allowedResponses, ["pass", "issue", "na"]);
  assert.deepEqual(validateInspectionTemplate(template), []);
});

test("template creation is isolated from preset state and rejects incomplete weekly checks", () => {
  const first = createInspectionTemplate("weekly-trailer", "first");
  const second = createInspectionTemplate("weekly-trailer", "second");
  first.sections[0].checks[0].label = "Changed";
  assert.notEqual(second.sections[0].checks[0].label, "Changed");
  assert.match(validateInspectionTemplate({ ...second, sections: [{ ...second.sections[0], checks: [{ ...second.sections[0].checks[0], allowedResponses: ["pass"] }] }]}).join(" "), /Pass, Issue, and N\/A/);
});

test("reordering is bounded and preserves every item", () => {
  assert.deepEqual(moveInspectionItem(["a", "b", "c"], 0, 2), ["b", "c", "a"]);
  assert.deepEqual(moveInspectionItem(["a", "b"], -1, 0), ["a", "b"]);
});

test("editing and reordering template checks preserves all required and N/A rule combinations", () => {
  const items = [true, false].flatMap((required) => [true, false].flatMap((allowNa) => [true, false].map((requireNaReason) => ({
    key: `check-${required}-${allowNa}-${requireNaReason}`, label: "Original check", required, allowNa, requireNaReason,
  }))));
  const record = { id: "definition", name: "Custom checks", applicabilityKey: "Truck", presetKey: "custom", version: {
    id: "version", optimisticVersion: 1, state: "draft", definition: { sections: [{ key: "checks", title: "Checks", items }] },
  } };
  const draft = cloneInspectionTemplate(inspectionTemplateFromApi(record));
  assert.deepEqual(validateInspectionTemplate(draft), []);
  draft.sections[0].checks[0].label = "Renamed check";
  draft.sections[0].checks = moveInspectionItem(draft.sections[0].checks, 0, 7);
  const saved = inspectionTemplateDefinition(draft);
  for (const original of items) {
    const actual = saved.sections[0].items.find((item) => item.key === original.key);
    assert.deepEqual(actual, { ...original, ...(original.key === items[0].key ? { label: "Renamed check" } : {}) });
  }
  assert.equal(record.version.definition.sections[0].items[0].label, "Original check");
});

test("new preset checks keep established required/N/A defaults", () => {
  const saved = inspectionTemplateDefinition(createInspectionTemplate("weekly-truck", "new"));
  for (const item of saved.sections.flatMap((section) => section.items)) {
    assert.equal(item.required, true);
    assert.equal(item.allowNa, true);
    assert.equal(item.requireNaReason, false);
  }
});


test("each canonical starter round trips its type, asset, checks, and policies", () => {
  for (const preset of INSPECTION_PRESETS) {
    const template = createInspectionTemplate(preset.id, "draft");
    const definition = inspectionTemplateDefinition(template);
    const canonical = CANONICAL_PRESETS.find((entry) => entry.assetType === template.unitType && entry.inspectionType === template.inspectionType);
    assert.deepEqual(definition, canonical);
    const restored = inspectionTemplateFromApi({ id: "def", name: template.name, applicabilityKey: template.unitType, presetKey: template.sourcePreset,
      version: { id: "draft", state: "draft", optimisticVersion: 1, definition } });
    assert.equal(restored.inspectionType, preset.inspectionType);
    assert.equal(restored.unitType, preset.unitType);
    assert.deepEqual(restored.sections, template.sections);
    assert.deepEqual(validateInspectionTemplate(restored), []);
    if (preset.inspectionType === "custom") assert.equal(restored.sourcePreset, "custom");
  }
});

test("legacy templates default weekly and changed preset types become custom", () => {
  const legacy = inspectionTemplateFromApi({ id: "def", name: "Legacy", applicabilityKey: "Truck", presetKey: "weekly-truck", version: { id: "draft", state: "draft", definition: { sections: [] } } });
  assert.equal(legacy.inspectionType, "weekly");
  const changed = changeInspectionType(legacy, "annual");
  assert.equal(changed.sourcePreset, "custom");
  assert.equal(inspectionTemplateDefinition(changed).inspectionType, "annual");
  assert.equal(changeInspectionType(legacy, "weekly").sourcePreset, "weekly-truck");
});

test("assignments and archive candidates are isolated by type, asset, and scope", () => {
  const assignments = [
    { id: "weekly", applicabilityKey: "Truck" },
    { id: "annual", applicabilityKey: "Truck", inspectionType: "annual" },
    { id: "location", applicabilityKey: "Truck", inspectionType: "annual", locationId: "shop" },
    { id: "trailer", applicabilityKey: "Trailer", inspectionType: "annual" },
  ];
  assert.deepEqual(matchingInspectionAssignments(assignments, { unitType: "Truck", inspectionType: "annual" }).map((entry) => entry.id), ["annual"]);
  assert.deepEqual(matchingInspectionAssignments(assignments, { unitType: "Truck" }).map((entry) => entry.id), ["weekly"]);
  assert.deepEqual(matchingInspectionAssignments(assignments, { unitType: "Truck", inspectionType: "annual", locationId: "shop" }).map((entry) => entry.id), ["location"]);
  const templates = [
    { versionId: "weekly", unitType: "Truck", status: "published" },
    { versionId: "annual", unitType: "Truck", inspectionType: "annual", status: "published" },
    { versionId: "draft", unitType: "Truck", inspectionType: "annual", status: "draft" },
    { versionId: "trailer", unitType: "Trailer", inspectionType: "annual", status: "published" },
  ];
  assert.deepEqual(eligibleInspectionTemplates(templates, { unitType: "Truck", inspectionType: "annual" }).map((entry) => entry.versionId), ["annual"]);
  assert.deepEqual(eligibleInspectionTemplates(templates, { unitType: "Truck", inspectionType: "annual", excludeVersionId: "annual" }), []);
});
