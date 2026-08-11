import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./PartCatalogCombobox.jsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("./part-catalog-combobox.css", import.meta.url), "utf8");

test("catalog lookup stays deterministic, bounded, debounced, and cancellable", () => {
  assert.match(source, /SEARCH_DELAY_MS = 250/);
  assert.match(source, /new AbortController\(\)/);
  assert.match(source, /requestSequence\.current/);
  assert.match(source, /\/api\/parts-helper\/catalog\?\$\{params\}/);
  assert.match(source, /limit: "8"/);
  assert.doesNotMatch(source, /parts-helper\/identify|live-prices/);
});

test("saved part values stay closed until the user interacts with the combobox", () => {
  assert.match(source, /const \[interacting, setInteracting\] = useState\(false\)/);
  assert.match(source, /if \(!interacting \|\| disabled/);
  assert.match(source, /onFocus=\{\(\) => \{[\s\S]*?setInteracting\(true\)/);
  assert.match(source, /onChange=\{\(event\) => \{[\s\S]*?setInteracting\(true\)/);
  assert.match(source, /closeFromOutside[\s\S]*?setInteracting\(false\)/);
  assert.match(source, /event\.key === "Escape"[\s\S]*?setInteracting\(false\)/);
  assert.match(source, /event\.key === "Tab"[\s\S]*?setInteracting\(false\)/);
});

test("combobox exposes listbox semantics and complete keyboard selection", () => {
  assert.match(source, /role="combobox"/);
  assert.match(source, /aria-autocomplete="list"/);
  assert.match(source, /role="listbox"/);
  assert.match(source, /role="option"/);
  assert.match(source, /event\.key === "Escape"/);
  assert.match(source, /event\.stopPropagation\(\)/);
  assert.match(source, /event\.key === "Tab"/);
  assert.match(source, /"ArrowDown", "ArrowUp", "Enter"/);
  assert.match(source, /onClick=\{\(\) => select\(part\)\}/);
  assert.match(source, /scrollIntoView/);
});

test("manual entry remains available for empty, unmatched, and failed lookup", () => {
  assert.match(source, /No company parts imported/);
  assert.match(source, /No catalog match\. Continue manually or use Find\./);
  assert.match(source, /No catalog match\. Continue manually\./);
  assert.match(source, /Parts lookup unavailable\. Manual entry still works\./);
  assert.match(source, /onChange\(event\.target\.value\)/);
});

test("catalog popup stays readable beyond the narrow input column", () => {
  assert.match(styles, /\.part-catalog-popup\s*\{[\s\S]*?right:\s*auto;/);
  assert.match(styles, /\.part-catalog-popup\s*\{[\s\S]*?width:\s*480px;/);
  assert.match(styles, /max-width:\s*calc\(100vw - 32px\);/);
  assert.match(styles, /overflow-wrap:\s*anywhere;/);
  assert.match(styles, /@media \(max-width: 640px\)[\s\S]*?max-width:\s*calc\(100vw - 24px\);/);
});
