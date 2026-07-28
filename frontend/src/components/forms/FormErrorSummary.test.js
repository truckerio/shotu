import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./FormErrorSummary.jsx", import.meta.url), "utf8");

test("form errors wait until their active section has rendered", () => {
  assert.match(source, /focusReady = true/);
  assert.match(source, /focusOnMount && focusReady && itemCount > 0/);
  assert.match(source, /requestAnimationFrame[\s\S]*requestAnimationFrame/);
  assert.match(source, /firstField\.focus\(\{ preventScroll: true \}\)/);
  assert.match(source, /onFocusTarget\?\.\(firstField\)/);
});
