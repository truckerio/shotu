import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const panel = readFileSync(new URL("./PartRequestsPanel.jsx", import.meta.url), "utf8");

test("part request review and office-created parts share the quantity unit control", () => {
  assert.match(panel, /function AllocationEditor/);
  assert.ok((panel.match(/<QuantityUnitInput/g) || []).length >= 3);
  assert.match(panel, /allocations:[\s\S]*uomCode:\s*draft\.uomCode/);
  assert.match(panel, /formatQuantityUnit\(request\.quantity/);
});

test("legacy request and allocation units default through the shared catalog", () => {
  assert.match(panel, /normalizeUomCode\(request\?\.uomCode\)/);
  assert.match(panel, /allocation\.uomCode \|\| request\.uomCode/);
  assert.doesNotMatch(panel, /const\s+UNITS_OF_MEASURE\s*=/);
});
