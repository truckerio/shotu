import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = readFileSync(new URL("./AnchoredSelect.jsx", import.meta.url), "utf8");
const css = readFileSync(new URL("./anchored-select.css", import.meta.url), "utf8");

test("shared selector anchors its accessible listbox below the trigger", () => {
  assert.match(component, /aria-haspopup="listbox"/);
  assert.match(component, /role="listbox"/);
  assert.match(component, /role="option"/);
  assert.match(component, /aria-selected=\{option\.value === value\}/);
  assert.match(component, /labelHidden \? "is-label-hidden"/);
  assert.match(component, /ArrowDown[\s\S]*ArrowUp[\s\S]*Home[\s\S]*End/);
  assert.match(css, /\.anchored-select-popover\s*\{[^}]*left:\s*0;[^}]*position:\s*absolute;[^}]*right:\s*0;[^}]*top:\s*calc\(100% \+ 4px\);[^}]*width:\s*100%;/s);
  assert.match(css, /\.anchored-select-option\s*\{[^}]*background:\s*transparent;[^}]*border:\s*0;[^}]*min-height:\s*34px;[^}]*width:\s*100%;/s);
  assert.match(css, /\.anchored-select-option\.is-selected::after\s*\{[^}]*content:\s*"✓";/s);
});
