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
  assert.match(component, /onClick=\{\(\) => onApply\(suggestion\.text\)\}/);
  assert.match(component, /Nothing is filled until you apply a suggestion/);
});

test("history suggestions can be dismissed and reopened without changing repair text", () => {
  assert.match(component, /aria-label="Hide previous work suggestions"/);
  assert.match(component, /onClick=\{\(\) => setExpanded\(false\)\}/);
  assert.match(component, /Show previous work/);
  assert.match(component, /onClick=\{\(\) => setExpanded\(true\)\}/);
  assert.match(component, /useEffect\(\(\) => \{\s*setExpanded\(true\);\s*\}, \[catalogPartId, normalizedPartNumber\]\)/s);
  assert.doesNotMatch(component, /setExpanded\(false\)[\s\S]{0,120}onApply/);
});

test("catalog selection does not automatically write repair order", () => {
  assert.doesNotMatch(office, /repairOrder: part\.repairOrder/);
  assert.doesNotMatch(office, /repairOrder: result\.part\.repairOrder/);
  assert.doesNotMatch(used, /repairOrder: catalogPart\.repairOrder/);
  assert.doesNotMatch(used, /repairOrder: result\.part\.repairOrder/);
  assert.doesNotMatch(officeReview, /repairOrder:\s*result\.part\.repairOrder/);
  assert.match(office, /<RepairHistorySuggestions/);
  assert.match(officeRequest, /<RepairHistorySuggestions/);
  assert.match(used, /<RepairHistorySuggestions/);
});

test("mobile apply controls meet the 44px target", () => {
  assert.match(css, /@media \(max-width: 700px\)[\s\S]*\.repair-history-suggestions button[\s\S]*min-height: 44px/);
});
