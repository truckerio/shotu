import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const component = readFileSync(new URL("./RepairHistorySuggestions.jsx", import.meta.url), "utf8");
const office = readFileSync(new URL("./OfficePartComposer.jsx", import.meta.url), "utf8");
const officeRequest = readFileSync(new URL("./OfficeRequestCard.jsx", import.meta.url), "utf8");
const officeReview = readFileSync(new URL("./useOfficeRequestReview.js", import.meta.url), "utf8");
const used = readFileSync(new URL("../UsedPartsEditor.jsx", import.meta.url), "utf8");
const css = readFileSync(new URL("./repair-history-suggestions.css", import.meta.url), "utf8");

test("history lookup is bounded, cancellable, stale-safe, and explicit apply only", () => {
  assert.match(component, /new AbortController\(\)/);
  assert.match(component, /requestSequence/);
  assert.match(component, /window\.setTimeout/);
  assert.match(component, /limit: "5"/);
  assert.match(component, /repair-suggestions\?/);
  assert.match(component, /onClick=\{\(\) => \{\s*onApply\(suggestion\.text\);/s);
  assert.match(component, /interfaceText\(locale, key\)/);
  assert.match(component, /parts\.repairSuggestionHelp/);
});

test("history suggestions can be dismissed and reopened without changing repair text", () => {
  assert.match(component, /aria-label=\{t\("parts\.hidePreviousWorkSuggestions"\)\}/);
  assert.match(component, /onClick=\{\(\) => setExpanded\(false\)\}/);
  assert.match(component, /parts\.showPreviousWork/);
  assert.match(component, /onClick=\{\(\) => setExpanded\(true\)\}/);
  assert.match(component, /currentRepairOrder = ""/);
  assert.match(component, /useState\(\(\) => !normalizedRepairOrder\)/);
  assert.match(component, /setExpanded\(!normalizedRepairOrder\)/);
  assert.match(component, /\[catalogPartId, normalizedPartNumber, normalizedRepairOrder\]/);
  assert.doesNotMatch(component, /setExpanded\(false\)[\s\S]{0,120}onApply/);
});

test("existing or newly applied repair wording keeps history collapsed", () => {
  assert.match(office, /currentRepairOrder=\{draft\.repairOrder\}/);
  assert.match(officeRequest, /currentRepairOrder=\{review\.form\.repairOrder\}/);
  assert.match(used, /currentRepairOrder=\{serializedRepairOrder\(part\)\}/);
  assert.match(component, /onApply\(suggestion\.text\);\s*setExpanded\(false\);/s);
});

test("catalog selection does not silently apply repair-history or AI repair suggestions", () => {
  assert.doesNotMatch(office, /repairOrder: part\.repairOrder/);
  assert.doesNotMatch(office, /repairOrder: result\.part\.repairOrder/);
  assert.doesNotMatch(used, /repairOrder: catalogPart\.repairOrder/);
  assert.doesNotMatch(used, /repairOrder: result\.part\.repairOrder/);
  assert.doesNotMatch(officeReview, /repairOrder:\s*result\.part\.repairOrder/);
  assert.match(used, /purpose="workorder_assignment"/);
  assert.match(used, /setSerializedDialogPart\(catalogPart\)/);
  assert.doesNotMatch(used, /onSelect=\{\(catalogPart\) => \{[\s\S]{0,500}partNo: catalogPart\.partNumber/);
  assert.match(office, /<RepairHistorySuggestions/);
  assert.match(officeRequest, /<RepairHistorySuggestions/);
  assert.match(used, /<RepairHistorySuggestions/);
  assert.match(used, /locale=\{locale\}/);
});

test("mobile apply controls meet the 44px target", () => {
  assert.match(css, /@media \(max-width: 700px\)[\s\S]*\.repair-history-suggestions button[\s\S]*min-height: 44px/);
});
