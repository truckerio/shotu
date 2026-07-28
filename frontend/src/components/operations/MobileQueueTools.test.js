import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const componentUrl = new URL("./MobileQueueTools.jsx", import.meta.url);
const cssUrl = new URL("./mobile-queue-tools.css", import.meta.url);

test("mobile queue tools use the accessible shared dialog contract", async () => {
  const source = await readFile(componentUrl, "utf8");

  assert.match(source, /aria-haspopup="dialog"/);
  assert.match(source, /aria-expanded=\{open\}/);
  assert.match(source, /<MobileFilterSheet/);
  assert.match(source, /onClearFilters/);
  assert.match(source, /Show results/);
});

test("mobile queue trigger and actions meet the 44px target", async () => {
  const css = await readFile(cssUrl, "utf8");

  assert.match(css, /\.mobile-queue-tools-trigger\s*\{[\s\S]*height: 44px;[\s\S]*width: 44px;/);
  assert.match(css, /\.mobile-queue-tools-footer button\s*\{[\s\S]*min-height: 44px;/);
});
