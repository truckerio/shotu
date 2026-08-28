import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeRepairSuggestionsResponse,
  repairSuggestionMeta,
} from "./repair-suggestions-model.js";

test("normalizes, deduplicates, and bounds repair history suggestions", () => {
  const suggestions = normalizeRepairSuggestionsResponse({ suggestions: [
    { text: " Replace hub seal ", usageCount: "4", confidence: 0.9, examples: [{ unitNo: "T-12" }] },
    { repairOrder: "replace HUB seal", count: 9 },
    { workPerformed: "Adjust brakes", uses: 1 },
    { text: "Inspect hub" },
    { text: "Clean assembly" },
    { text: "Fill hub oil" },
    { text: "Must not appear" },
  ] });

  assert.equal(suggestions.length, 5);
  assert.equal(suggestions[0].text, "Replace hub seal");
  assert.equal(suggestions[0].usageCount, 4);
  assert.equal(suggestions[0].confidence, "high");
  assert.equal(suggestions[0].examples[0].unitNo, "T-12");
  assert.equal(suggestions[1].text, "Adjust brakes");
});

test("formats usage, confidence, and available history context", () => {
  assert.equal(repairSuggestionMeta({
    usageCount: 2,
    confidence: "medium",
    context: "Same trailer type",
    examples: [],
  }), "Used 2 times · medium confidence · Same trailer type");

  assert.equal(repairSuggestionMeta({
    usageCount: 1,
    confidence: "",
    context: "",
    source: "odoo",
    examples: [],
  }), "Used 1 time · Odoo service history");

  assert.equal(repairSuggestionMeta({
    usageCount: 3,
    confidence: "confirmed",
    sameAsset: true,
    context: "",
    source: "odoo",
    examples: [],
  }, "asset-1"), "Used 3 times · Confirmed link · Same unit");
});

test("localizes static repair metadata without changing operational context", () => {
  const suggestion = {
    usageCount: 2,
    confidence: "high",
    sameAsset: true,
    context: "",
    examples: [],
    source: "service_history",
  };
  assert.equal(repairSuggestionMeta(suggestion, "", "es"), "Usado 2 veces · Confianza alta · Misma unidad");
});
