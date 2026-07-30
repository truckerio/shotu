import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const narrativeField = readFileSync(new URL("./NarrativeField.jsx", import.meta.url), "utf8");
const narrativeCss = readFileSync(new URL("./narrative-field.css", import.meta.url), "utf8");
const chatComposer = readFileSync(new URL("../workorders/ChatComposer.jsx", import.meta.url), "utf8");

test("NarrativeField keeps shared controlled-input and sizing contracts", () => {
  assert.match(narrativeField, /style=\{\{ \.\.\.style, width: style\?\.width \|\| "100%" \}\}/);
  assert.match(narrativeField, /singleLine \? RichInput : RichTextarea/);
  assert.match(narrativeField, /CHECK_DELAY_MS = 650/);
  assert.match(narrativeField, /spellCheck=\{providerAvailable !== true\}/);
});

test("proofreading requests cancel, respect IME composition, and check context only on blur", () => {
  assert.match(narrativeField, /requestControllerRef\.current\?\.abort\(\)/);
  assert.match(narrativeField, /new AbortController\(\)/);
  assert.match(narrativeField, /isComposingRef\.current = true/);
  assert.match(narrativeField, /blurred && !singleLine \? "deep"/);
  assert.match(narrativeField, /focused \? "fast"/);
  assert.match(narrativeField, /if \(mode === "deep"\) execute\(\)/);
  assert.match(narrativeField, /PROVIDER_BACKOFF_MS/);
});

test("spelling and grammar suggestions expose accessible correction actions without correction history", () => {
  assert.match(narrativeField, /Ignore once/);
  assert.match(narrativeField, /Add to my dictionary/);
  assert.match(narrativeField, /aria-live="polite"/);
  assert.doesNotMatch(narrativeField, />Undo</);
  assert.doesNotMatch(narrativeField, /Corrected “/);
  assert.match(narrativeCss, /is-spelling/);
  assert.match(narrativeCss, /is-grammar/);
  assert.match(narrativeCss, /min-height: 44px/);
  assert.match(narrativeField, /window\.visualViewport/);
});

test("suggestions use the rich control's single controlled-input event path", () => {
  assert.match(chatComposer, /event\.target\.style\.height = "auto"/);
  assert.match(narrativeField, /control\.setRangeText\(/);
  assert.doesNotMatch(narrativeField, /new view\.InputEvent\("input"/);
  assert.doesNotMatch(narrativeField, /event\.stopImmediatePropagation\(\)/);
  assert.doesNotMatch(narrativeField, /dispatchReplacementInput\(control\)/);
  assert.match(narrativeField, /setControlRange\(\s*control,\s*replacement/);
  assert.doesNotMatch(narrativeField, /onChange\?\.\(\{ currentTarget:/);
});
