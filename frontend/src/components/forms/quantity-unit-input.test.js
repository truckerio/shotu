import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = readFileSync(new URL("./QuantityUnitInput.jsx", import.meta.url), "utf8");
const css = readFileSync(new URL("./quantity-unit-input.css", import.meta.url), "utf8");

test("quantity control exposes a searchable grouped unit listbox", () => {
  assert.match(component, /aria-haspopup="listbox"/);
  assert.match(component, /placeholder=\{t\("uom\.searchUnits"\)\}/);
  assert.match(component, /unitOptionGroups\(\s*query,\s*\(kind, value\) => t\(`/);
  assert.match(component, /role="option"/);
  assert.match(component, /onValueChange\(\{\s*quantity:\s*model\.quantity,\s*uomCode:\s*nextCode\s*\}\)/);
  assert.doesNotMatch(component, /quantity:\s*normalized,\s*uomCode:\s*nextCode/);
});

test("opening the quantity unit list does not focus search or summon a phone keyboard", () => {
  assert.doesNotMatch(component, /searchRef/);
  assert.doesNotMatch(component, /\.focus\(\)/);
  assert.match(component, /inputMode="search"/);
  assert.match(component, /enterKeyHint="search"/);
});

test("quantity control keeps a bounded mobile menu and stable grid", () => {
  assert.match(css, /min-width:\s*min\(320px,\s*calc\(100vw - 32px\)\)/);
  assert.match(css, /position:\s*fixed/);
  assert.match(css, /left:\s*16px/);
  assert.match(css, /right:\s*16px/);
  assert.match(component, /trigger\.getBoundingClientRect\(\)/);
  assert.match(component, /minimumUsefulHeight = isMobile \? 180 : 240/);
  assert.match(component, /availableBelow >= Math\.min\(menuHeight,\s*minimumUsefulHeight\)/);
  assert.match(component, /setMenuPlacement\(openBelow \? "below" : "above"\)/);
  assert.match(component, /setMenuStyle\(nextStyle\)/);
  assert.match(component, /data-placement=\{menuPlacement\}/);
  assert.match(component, /--quantity-menu-top/);
  assert.match(css, /grid-template-rows:\s*auto minmax\(0,\s*1fr\)/);
  assert.match(css, /max-height:\s*var\(--quantity-menu-max-height,\s*min\(360px,\s*60vh\)\)/);
  assert.match(css, /\.quantity-unit-options\s*\{[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto;/s);
  assert.match(css, /\.quantity-unit-menu\[data-placement="above"\]/);
  assert.match(css, /top:\s*var\(--quantity-menu-top,\s*16px\)/);
  assert.doesNotMatch(css, /bottom:\s*16px/);
});

test("known parts rows wrap inside narrow desktop create cards", () => {
  assert.match(css, /@container \(max-width:\s*520px\)/);
  assert.match(css, /grid-template-columns:\s*24px minmax\(0,\s*1fr\) minmax\(120px,\s*0\.75fr\) 64px/);
  assert.match(css, /\.operational-part-row\.has-quantity-unit\s*>\s*input:nth-last-of-type\(1\)\s*\{[^}]*grid-column:\s*2 \/ 4;/s);
  assert.match(css, /\.operational-part-row\.has-quantity-unit\s*>\s*button\s*\{[^}]*grid-row:\s*1 \/ 3;/s);
});
