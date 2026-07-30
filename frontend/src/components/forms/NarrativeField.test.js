import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const narrativeField = readFileSync(new URL("./NarrativeField.jsx", import.meta.url), "utf8");

test("NarrativeField gives the shared rich control a full-width default", () => {
  assert.match(narrativeField, /style=\{\{ \.\.\.style, width: style\?\.width \|\| "100%" \}\}/);
  assert.match(narrativeField, /singleLine \? RichInput : RichTextarea/);
  assert.match(narrativeField, /checkNarrativeSpelling\(text\)/);
});

test("NarrativeField shows provider suggestions and keeps native fallback", () => {
  assert.match(narrativeField, /narrative-spelling-error/);
  assert.match(narrativeField, /applySuggestion\(suggestion\)/);
  assert.match(narrativeField, /spellCheck=\{providerAvailable === false\}/);
});
