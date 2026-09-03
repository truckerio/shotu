import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const detail = readFileSync(new URL("./InspectionDetail.jsx", import.meta.url), "utf8");
const queue = readFileSync(new URL("./InspectionQueue.jsx", import.meta.url), "utf8");
const css = readFileSync(new URL("./inspections.css", import.meta.url), "utf8");

test("detail uses one radio group per checklist item and only expands issue details when selected", () => {
  assert.match(detail, /type="radio" name=\{item\.key\}/);
  assert.match(detail, /response === "issue" \? <div className="inspection-issue-fields">/);
  assert.match(detail, /disabled=\{!canComplete \|\| workorderFindings\.length > 0 \|\| saveState !== "Saved"\}/);
  assert.match(detail, /restrictedReadOnly && inspection\.status !== "completed"/);
  assert.match(detail, /inspection\.status === "in_progress"/);
  assert.match(detail, /if \(!inspectionResponseShouldSave\(item, value, commit\)\) \{ setSaveState\("Unsaved"\); return; \}/);
});

test("inspection queue shares progressive queue and does not render a privileged read-only action", () => {
  assert.match(queue, /<ProgressiveQueue/);
  assert.match(queue, /<OperationalCollectionTable/);
  assert.match(queue, /<OperationalCollectionRow/);
  assert.doesNotMatch(queue, /inspection-row-open/);
  assert.doesNotMatch(queue, /<button className="inspection-row-action"/);
});

test("inspection UI keeps phone controls at 44px and a single compact detail column", () => {
  assert.match(detail, /inspection-detail-layout/);
  assert.match(detail, /inspection-detail-primary/);
  assert.match(detail, /inspection-detail-support/);
  assert.match(detail, /<section className="inspection-detail-primary" aria-label="Inspection checklist">/);
  assert.doesNotMatch(detail, /<main/);
  assert.match(css, /\.inspection-detail-layout\.has-supporting \{ grid-template-columns: minmax\(0, 1\.65fr\) minmax\(320px, \.75fr\); \}/);
  assert.match(css, /@media \(max-width: 700px\)[\s\S]*\.inspection-response-group label,[\s\S]*min-height: 44px/);
  assert.match(css, /@media \(max-width: 700px\)[\s\S]*\.inspection-detail-layout\.has-supporting,[\s\S]*grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(css, /@media \(max-width: 700px\)[\s\S]*grid-template-columns: repeat\(3,/);
  assert.match(css, /scrollWidth|overflow/);
});
