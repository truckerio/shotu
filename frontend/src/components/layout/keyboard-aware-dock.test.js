import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = readFileSync(new URL("./KeyboardAwareDock.jsx", import.meta.url), "utf8");
const css = readFileSync(new URL("./keyboard-aware-dock.css", import.meta.url), "utf8");

test("hide mode removes dock from accessibility and interaction while keyboard is open", () => {
  assert.match(component, /const hidden = resolvedMode === "hide" && keyboardOpen/);
  assert.match(component, /aria-hidden=\{hidden \? "true" : undefined\}/);
  assert.match(component, /inert=\{hidden \? true : undefined\}/);
  assert.match(css, /\.keyboard-aware-dock--hide\[data-keyboard-open="true"\]\s*\{[^}]*display:\s*none;/s);
});

test("follow mode uses keyboard inset and closed dock respects safe area", () => {
  assert.match(component, /new Set\(\["hide", "follow"\]\)/);
  assert.match(css, /padding-bottom:\s*env\(safe-area-inset-bottom\)/);
  assert.match(css, /\.keyboard-aware-dock--follow\[data-keyboard-open="true"\]\s*\{[^}]*bottom:\s*var\(--keyboard-inset, 0px\);[^}]*padding-bottom:\s*0;/s);
});
