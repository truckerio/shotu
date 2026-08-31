import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const allocationEditor = readFileSync(new URL("./part-requests/AllocationEditor.jsx", import.meta.url), "utf8");
const officeComposer = readFileSync(new URL("./part-requests/OfficePartComposer.jsx", import.meta.url), "utf8");
const officeRequest = readFileSync(new URL("./part-requests/OfficeRequestCard.jsx", import.meta.url), "utf8");
const requestModel = readFileSync(new URL("./part-requests/part-request-model.js", import.meta.url), "utf8");
const requestReview = readFileSync(new URL("./part-requests/useOfficeRequestReview.js", import.meta.url), "utf8");
const requestSummary = readFileSync(new URL("./part-requests/RequestSummary.jsx", import.meta.url), "utf8");

test("part request review and office-created parts share the quantity unit control", () => {
  assert.match(allocationEditor, /function AllocationEditor/);
  const quantityOwners = [allocationEditor, officeComposer, officeRequest].join("\n");
  assert.ok((quantityOwners.match(/<QuantityUnitInput/g) || []).length >= 3);
  assert.match(officeComposer, /allocations:[\s\S]*uomCode:\s*draft\.uomCode/);
  assert.match(requestSummary, /formatQuantityUnit\(request\.quantity/);
});

test("legacy request and allocation units default through the shared catalog", () => {
  assert.match(requestModel, /normalizeUomCode\(request\?\.uomCode\)/);
  assert.match(allocationEditor, /allocation\.uomCode \|\| uomCode/);
  assert.doesNotMatch([requestModel, requestReview, allocationEditor].join("\n"), /const\s+UNITS_OF_MEASURE\s*=/);
});

test("supply source uses the same anchored selector as fitment", () => {
  assert.match(allocationEditor, /className="allocation-source-select"/);
  assert.match(allocationEditor, /label=\{`\$\{t\("parts\.supplySource"\)\} \$\{index \+ 1\}`\}/);
  assert.match(allocationEditor, /onChange=\{\(sourceType\) => updateSource\(index, sourceType\)\}/);
  assert.doesNotMatch(allocationEditor, /<select value=\{allocation\.sourceType\}/);
});
