import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = readFileSync(new URL("./QuantityUnitInput.jsx", import.meta.url), "utf8");
const css = readFileSync(new URL("./quantity-unit-input.css", import.meta.url), "utf8");

test("quantity control exposes a searchable grouped unit listbox", () => {
  assert.match(component, /aria-haspopup="listbox"/);
  assert.match(component, /placeholder="Search units"/);
  assert.match(component, /unitOptionGroups\(query\)/);
  assert.match(component, /role="option"/);
  assert.match(component, /onValueChange\(\{\s*quantity:\s*model\.quantity,\s*uomCode:\s*nextCode\s*\}\)/);
  assert.doesNotMatch(component, /quantity:\s*normalized,\s*uomCode:\s*nextCode/);
});

test("quantity control keeps a bounded mobile menu and stable grid", () => {
  assert.match(css, /min-width:\s*min\(320px,\s*calc\(100vw - 32px\)\)/);
  assert.match(css, /position:\s*fixed/);
  assert.match(css, /left:\s*16px/);
  assert.match(css, /right:\s*16px/);
});
