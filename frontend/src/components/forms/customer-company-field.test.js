import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./CustomerCompanyField.jsx", import.meta.url), "utf8");

test("customer company suggestions use an editable accessible combobox", () => {
  assert.match(source, /role="combobox"/);
  assert.match(source, /aria-autocomplete="list"/);
  assert.match(source, /aria-activedescendant=/);
  assert.match(source, /role="listbox"/);
  assert.match(source, /role="option"/);
  assert.match(source, /handleKeyDown/);
  assert.match(source, /aria-describedby=\{accessibility\.describedBy\}/);
  assert.match(source, /aria-invalid=\{accessibility\.invalid \|\| undefined\}/);
  assert.match(source, /required=\{accessibility\.required \|\| undefined\}/);
});

test("one selected suggestion replaces the company while manual entry remains supported", () => {
  assert.match(source, /function select\(option\)[\s\S]*?onChange\?\.\(option\.name\)/);
  assert.match(source, /value=\{value\}[\s\S]*?onChange=\{\(event\) => onChange\?\.\(event\.target\.value, event\)\}/);
  assert.match(source, /options\.length \? \(/);
  assert.match(source, /onChange=\{\(event\) => onChange\?\.\(event\.target\.value, event\)\}/);
});
