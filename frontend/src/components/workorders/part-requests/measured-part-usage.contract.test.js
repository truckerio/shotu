import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./MeasuredPartUsageDialog.jsx", import.meta.url), "utf8");
const editor = readFileSync(new URL("../UsedPartsEditor.jsx", import.meta.url), "utf8");

test("measured catalog parents use the aggregate endpoint and retain an in-memory retry key", () => {
  assert.match(editor, /getUnitDefinition\(catalogPart\.uomCode\)\?\.category/);
  assert.match(editor, /MEASURED_UOM_CATEGORIES\.has\(category\)/);
  assert.match(source, /const transientKeys = new Map\(\)/);
  assert.match(source, /transientKeys\.has\(storage\)/);
  assert.match(source, /operation: "aggregateUsageReserve"/);
  assert.match(source, /operation: "aggregateUsageLifecycle"/);
});

test("measured success cannot be retried when refresh fails and restores its originating combobox", () => {
  assert.match(source, /setCompleted\(true\)/);
  assert.match(source, /await onReserved\?\.\(result\.usage, result\)/);
  assert.match(source, /aggregateReservedRefresh/);
  assert.match(source, /disabled=\{busy \|\| completed\}/);
  assert.match(editor, /measuredDialogOriginRef\.current = index/);
  assert.match(editor, /function closeMeasuredDialog\(\)/);
  assert.match(editor, /legacyManualRowsRef/);
  assert.match(editor, /parts\.legacyManualEvidence/);
});

test("aggregate evidence stays in the canonical Parts row hierarchy", () => {
  assert.match(source, /className="part-row used-part-aggregate-row"/);
  assert.doesNotMatch(source, /<h3>\{t\("parts\.measuredUsageEvidence"\)\}<\/h3>/);
});
