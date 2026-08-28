import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const editor = readFileSync(new URL("./UsedPartsEditor.jsx", import.meta.url), "utf8");
const section = readFileSync(new URL("./part-requests/UsedPartsSection.jsx", import.meta.url), "utf8");
const mechanicSurface = readFileSync(new URL("./part-requests/MechanicPartsSurface.jsx", import.meta.url), "utf8");
const module = readFileSync(new URL("../../features/workorder-modules/parts/WorkorderPartsModule.jsx", import.meta.url), "utf8");

test("mechanic used-parts interface text is owned by the selected locale", () => {
  assert.match(editor, /interfaceText\(locale, key\)/);
  assert.match(editor, /locale = "en"/);
  assert.match(editor, /parts\.recoveredUnsavedEntries/);
  assert.match(editor, /parts\.detailsUnavailable/);
  assert.match(editor, /parts\.noUsedPartsRecorded/);
  assert.match(editor, /parts\.removePartRow/);
  assert.match(editor, /progress\.saving/);
  assert.match(editor, /progress\.saved/);
  assert.match(editor, /progress\.notSaved/);
});

test("locale reaches the mechanic editor without changing office defaults", () => {
  assert.match(mechanicSurface, /<UsedPartsSection[\s\S]*locale=\{locale\}/);
  assert.match(section, /locale=\{locale\}/);
  assert.match(editor, /locale === "en" \? readonlyMessage : t\("parts\.usedPartsReadOnly"\)/);
  assert.match(module, /isMechanicDetail \? t\("parts\.usedTitle"\) : "Parts"/);
});
