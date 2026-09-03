import test from "node:test";
import assert from "node:assert/strict";
import { listTemplateFamilies, validateTemplateDefinition } from "./template-family.registry.js";
import { weeklyInspectionPreset } from "../../../../shared/inspection-template.js";

test("registry accepts typed weekly definitions and has no periodic family", () => {
  assert.equal(validateTemplateDefinition("inspection", weeklyInspectionPreset("Truck")).assetType, "Truck");
  assert.doesNotMatch(JSON.stringify(listTemplateFamilies()), /annual|fmcsa|periodic/i);
  assert.throws(() => validateTemplateDefinition("unknown", {}), /Unknown/);
});

test("registry rejects duplicate immutable item keys and oversized checklists", () => {
  const value = structuredClone(weeklyInspectionPreset("Truck"));
  value.sections[1].items[0].key = value.sections[0].items[0].key;
  assert.throws(() => validateTemplateDefinition("inspection", value), /unique/i);
});
