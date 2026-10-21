import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const source = readFileSync(new URL("./BusinessAddressField.jsx", import.meta.url), "utf8");

test("Business address remains editable with accessible optional provider suggestions", () => {
  assert.match(source, /<textarea[^>]*aria-label="Business address"/);
  assert.match(source, /role="listbox" id=\{listId\} aria-label="Address suggestions"/);
  assert.match(source, /aria-activedescendant/);
  for (const key of ["ArrowDown", "ArrowUp", "Enter", "Escape"]) assert.ok(source.includes(`"${key}"`));
  assert.match(source, /onBlur=.*dismiss\(\)/);
  assert.match(source, /query.trim\(\).length < 3/);
  assert.match(source, /}, 300\)/);
  assert.match(source, /generation.current === current/);
  assert.match(source, /live.current.scope === expectedScope/);
  assert.match(source, /live.current.value === expectedValue/);
  assert.match(source, /googleMapsAttribution.*alt="Google Maps"/);
  assert.doesNotMatch(source, /API key missing|Configure Google|Settings/);
});
