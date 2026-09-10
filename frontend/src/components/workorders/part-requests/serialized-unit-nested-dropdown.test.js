import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const picker = readFileSync(new URL("../../../features/workorder-modules/parts/CreateSerializedUnitPicker.jsx", import.meta.url), "utf8");
const dropdown = readFileSync(new URL("./SerializedUnitNestedDropdown.jsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("./serialized-unit-nested-dropdown.css", import.meta.url), "utf8");

test("Create Parts serial selection anchors below its Part field without changing shared dropdown dismissal", () => {
  assert.match(picker, /<SerializedUnitNestedDropdown[\s\S]*anchorToPartField/);
  assert.match(dropdown, /anchorToPartField = false/);
  assert.match(dropdown, /left: "0px"/);
  assert.match(dropdown, /top: "calc\(100% \+ 6px\)"/);
  assert.match(dropdown, /serializedPickerPlacement/);
  assert.match(dropdown, /serializedPickerMaxHeight/);
  assert.match(dropdown, /serialized-unit-nested-content"\)\?\.scrollHeight/);
  assert.match(dropdown, /visualViewport\?\.addEventListener\("scroll", measure\)/);
  assert.match(dropdown, /bottom: "calc\(100% \+ 6px\)"/);
  assert.match(dropdown, /data-anchor=\{anchorToPartField \? "part-field" : undefined\}/);
  assert.match(dropdown, /event\.key === "Escape"/);
  assert.match(dropdown, /closeFromOutside/);
  assert.match(dropdown, /function submitSearch\(event\) \{\s*event\.preventDefault\(\);\s*event\.stopPropagation\(\);/s);
  assert.match(styles, /\.create-part-identity-field > \.serialized-unit-nested-dropdown\[data-anchor="part-field"\][\s\S]*?width:\s*min\(29rem, 100%\);/);
});
