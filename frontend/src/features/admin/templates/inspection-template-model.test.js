import assert from "node:assert/strict";
import test from "node:test";
import { INSPECTION_PRESETS, cloneInspectionTemplate, createInspectionTemplate, inspectionTemplateFromApi, inspectionTemplateDefinition, inspectionTemplateSummary, moveInspectionItem, validateInspectionTemplate } from "./inspection-template-model.js";

test("weekly-only presets provide truck and trailer templates with Pass, Issue, and N/A", () => {
  assert.deepEqual(INSPECTION_PRESETS.map(({ id }) => id), ["weekly-truck", "weekly-trailer"]);
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
