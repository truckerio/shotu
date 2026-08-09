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
