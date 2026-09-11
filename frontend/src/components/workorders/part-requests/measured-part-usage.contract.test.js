import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./MeasuredPartUsageDialog.jsx", import.meta.url), "utf8");
const editor = readFileSync(new URL("../UsedPartsEditor.jsx", import.meta.url), "utf8");

test("measured catalog parents use the aggregate endpoint and retain an in-memory retry key", () => {
  assert.match(editor, /getUnitDefinition\(catalogPart\.uomCode\)\?\.category/);
  assert.match(editor, /\["quantity", "measured_bulk"\]\.includes\(partStockTracking\(catalogPart\)\)/);
  assert.match(source, /const transientKeys = new Map\(\)/);
  assert.match(source, /transientKeys\.has\(storage\)/);
  assert.match(source, /operation: "aggregateUsageReserve"/);
  assert.match(source, /operation: "aggregateUsageLifecycle"/);
});

test("measured selection bypasses manual rows and retains the aggregate-owned retry behavior", () => {
  assert.match(source, /setCompleted\(true\)/);
  assert.match(source, /await onReserved\?\.\(result\.usage, result\)/);
  assert.match(source, /aggregateReservedRefresh/);
  assert.match(source, /disabled=\{busy \|\| completed \|\| !amount\.valid\}/);
  assert.match(editor, /if \(\["quantity", "measured_bulk"\]\.includes\(partStockTracking\(catalogPart\)\)\) setMeasuredDialogPart\(catalogPart\)/);
  assert.match(editor, /function closeMeasuredDialog\(\)/);
  assert.doesNotMatch(editor, /used-part-quantity-/);
  assert.doesNotMatch(editor, /parts\.legacyManualEvidence/);
});

test("a newly selected measured part starts its repair order from the catalog description", () => {
  assert.match(source, /import \{ repairOrderAfterCatalogSelection \} from "\.\/catalog-parts-model\.js"/);
  assert.match(source, /setRepairOrder\(repairOrderAfterCatalogSelection\("", catalogPart\)\)/);
});

test("aggregate evidence stays in the canonical Parts row hierarchy", () => {
  assert.match(source, /className="part-row used-part-aggregate-row"/);
  assert.doesNotMatch(source, /<h3>\{t\("parts\.measuredUsageEvidence"\)\}<\/h3>/);
});
