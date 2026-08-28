import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = readFileSync(new URL("./AnchoredSelect.jsx", import.meta.url), "utf8");
const css = readFileSync(new URL("./anchored-select.css", import.meta.url), "utf8");

test("shared selector composes the animated accessible dropdown", () => {
  assert.match(component, /import \{ Dropdown \}/);
  assert.match(component, /<Dropdown aria-labelledby=\{labelId\}/);
  assert.match(component, /labelHidden \? "is-label-hidden"/);
  assert.match(component, /options\.map\(\(option\) => <option/);
  assert.match(css, /\.anchored-select \.dropdown-select-trigger/);
});
