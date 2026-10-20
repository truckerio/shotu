import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./LaborProductSelector.jsx", import.meta.url), "utf8");

test("labor product dialog and popup keep parent workorder submission and Escape local", () => {
  assert.match(source, /event\.preventDefault\(\);\s*event\.stopPropagation\(\);\s*if \(busyRef\.current\)/);
  assert.match(source, /onKeyDown=\{\(event\) => \{\s*if \(event\.key === "Escape"\) \{ event\.stopPropagation\(\); closeList\(\); focusTrigger\(\); \}/);
});

test("selection and dialog return focus to the closed dropdown trigger", () => {
  assert.match(source, /function focusTrigger\(\) \{ triggerRef\.current\?\.focus\(\); \}/);
  assert.match(source, /closeList\(\); focusTrigger\(\);/);
  assert.doesNotMatch(source, /onFocus=/);
});

test("labor dropdown contains search without a duplicate removal action", () => {
  const trigger = source.slice(source.indexOf('<DropdownTrigger ref={triggerRef}'), source.indexOf('{open ? <div className="labor-product-popup"'));
  assert.match(trigger, /aria-expanded=\{open\}/);
  assert.match(trigger, /labor-product-value/);
  assert.doesNotMatch(trigger, /<input|Clear|Remove/);
  const popup = source.slice(source.indexOf('{open ? <div className="labor-product-popup"'));
  assert.match(popup, /aria-label="Search labor products"/);
  assert.doesNotMatch(popup, /Remove labor selection|labor-product-clear/);
});

test("Enter remains inside the labor selector instead of submitting its parent form", () => {
  assert.match(source, /else if \(event\.key === "Enter"\) \{\s*event\.preventDefault\(\);\s*if \(!open\) \{\s*setOpen\(true\);/);
  assert.match(source, /const activeProduct = orderedItems\[activeIndex\];\s*if \(activeProduct\) select\(activeProduct\);/);
});


test("selector announces current product and closes disabled menus", () => {
  assert.match(source, /Choose labor product: \$\{selectedLabel\}/);
  assert.match(source, /if \(disabled \|\| !locationId\) setOpen\(false\)/);
});


test("labor reuses the shared dropdown trigger and chevron", () => {
  assert.match(source, /import \{ Dropdown, DropdownTrigger \} from/);
  assert.match(source, /<DropdownTrigger ref=\{triggerRef\}/);
  assert.doesNotMatch(source, /labor-product-chevron|⌄/);
});


test("Create and detail labor rows use the shared bin action and preserve edit gates", async () => {
  const create = await readFile(new URL("../../features/workorder-modules/parts/CreatePartsModule.jsx", import.meta.url), "utf8");
  const detail = await readFile(new URL("./UsedPartsEditor.jsx", import.meta.url), "utf8");
  for (const owner of [create, detail]) {
    assert.match(owner, /laborAction=\{<IconButton[^\n]*icon=\{Trash01\}[^\n]*onLaborProductChange\?\.\(null\)/);
  }
  assert.match(create, /disabled=\{!onLaborProductChange \|\| !laborProduct\}/);
  assert.match(detail, /disabled=\{!laborEditable \|\| !onLaborProductChange \|\| !laborProduct\}/);
  assert.equal((create.match(/label="Remove labor selection"/g) || []).length, 2, "desktop and phone Create both expose the bin");
  assert.equal((detail.match(/label="Remove labor selection"/g) || []).length, 2, "both detail layouts expose the bin");
});
