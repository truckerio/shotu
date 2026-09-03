import assert from "node:assert/strict";
import test from "node:test";
import { INSPECTION_PRESETS, createInspectionTemplate, inspectionTemplateSummary, moveInspectionItem, validateInspectionTemplate } from "./inspection-template-model.js";

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
