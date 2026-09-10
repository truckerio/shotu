import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./LaborProductSelector.jsx", import.meta.url), "utf8");

test("labor product dialog and popup keep parent workorder submission and Escape local", () => {
  assert.match(source, /event\.preventDefault\(\);\s*event\.stopPropagation\(\);\s*if \(busyRef\.current\)/);
  assert.match(source, /onKeyDown=\{\(event\) => \{\s*if \(event\.key === "Escape"\) \{ event\.stopPropagation\(\); closeList\(\); \}/);
});

test("selection and dialog focus return do not reopen an empty labor popup", () => {
  assert.match(source, /function focusInputWithoutOpening\(\) \{\s*suppressNextInputOpenRef\.current = true;/);
  assert.match(source, /if \(suppressNextInputOpenRef\.current\) \{ suppressNextInputOpenRef\.current = false; return; \}/);
});

test("Enter remains inside the labor selector instead of submitting its parent form", () => {
  assert.match(source, /else if \(event\.key === "Enter"\) \{\s*event\.preventDefault\(\);\s*if \(!open\) \{\s*setOpen\(true\);/);
  assert.match(source, /const activeProduct = orderedItems\[activeIndex\];\s*if \(activeProduct\) select\(activeProduct\);/);
});
