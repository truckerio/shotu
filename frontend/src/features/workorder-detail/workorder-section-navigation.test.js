import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../../components/workorders/WorkorderObjectPage.jsx", import.meta.url),
  "utf8",
);

test("section navigation responds on click without changing routes during pointerdown", () => {
  assert.match(source, /setVisualActiveSection\(sectionId\)/);
  assert.match(source, /onSelect\(sectionId\)/);
  assert.doesNotMatch(source, /onPointerDown/);
  assert.doesNotMatch(source, /startTransition/);
  assert.match(source, /aria-current=\{visualActiveSection === section\.id \? "page" : undefined\}/);
});

test("section navigation resolves icons from module-owned manifests", () => {
  assert.match(source, /workorderModuleDescriptor\(sectionId\)\?\.icon \|\| Tool02/);
  assert.doesNotMatch(source, /SECTION_ICONS/);
});

test("More navigation keeps its stable visible label and exposes overflow selection", () => {
  assert.doesNotMatch(source, /DotsHorizontal/);
  assert.equal((source.match(/<span>\{t\("detail\.more"\)\}<\/span>/g) || []).length, 3);
  assert.match(source, /ChevronDown aria-hidden="true"/);
  assert.match(source, /aria-current=\{desktopActiveOverflowSection \? "page" : undefined\}/);
  assert.match(source, /aria-current=\{phoneActiveOverflowSection \? "page" : undefined\}/);
  assert.match(source, /t\("detail\.moreSections"\)[\s\S]*desktopActiveOverflowSection\.label[\s\S]*t\("detail\.selected"\)/);
});

test("desktop navigation measures its container and preserves phone four-plus-More behavior", () => {
  assert.match(source, /new ResizeObserver\(measure\)/);
  assert.match(source, /fitWorkorderSections\(orderedSections, \{ availableWidth, sectionWidths, moreWidth \}\)/);
  assert.match(source, /const phoneLayout = splitWorkorderSections\(orderedSections\)/);
  assert.match(source, /preferenceKey = ""/);
  assert.match(source, /className = ""/);
});
