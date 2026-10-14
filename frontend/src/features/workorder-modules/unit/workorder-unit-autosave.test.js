import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const unitModule = readFileSync(new URL("./WorkorderUnitModule.jsx", import.meta.url), "utf8");
const createUnit = readFileSync(new URL("./CreateUnitModule.jsx", import.meta.url), "utf8");

test("detail Unit number stays fixed in both writable layouts", () => {
  assert.match(unitModule, /const compactUnit = \([\s\S]*?<output className="workorder-fixed-unit">\{form\.unitNo \|\| t\("detail\.notListed"\)\}<\/output>/);
  assert.match(unitModule, /\{canWrite && onePage \? compactUnit : canWrite \? \([\s\S]*?<output className="workorder-fixed-unit">\{form\.unitNo \|\| t\("detail\.notListed"\)\}<\/output>/);
  assert.doesNotMatch(unitModule, /<input[^>]*value=\{(?:form\.unitNo|unitLookupQuery)\}/);
});

test("create Unit search selects a vehicle without losing the result to blur", () => {
  assert.match(createUnit, /value=\{form\.unitNo\} onChange=\{\(event\) => \{[^}]*onUnitChange\(event\.target\.value\); \}\}/);
  assert.match(createUnit, /onMouseDown=\{\(event\) => event\.preventDefault\(\)\}.*onClick=\{\(\) => activateVehicleResult\(vehicle\)\}/);
  assert.match(createUnit, /function activateVehicleResult\(vehicle\) \{[\s\S]*?onVehicleSelect\(vehicle\);/);
});

test("detail keeps other Unit fields editable while Create alone edits the Unit number", () => {
  assert.match(unitModule, /const canWrite = writable\(access\) && Boolean\(activeWorkorder\.allowedActions\?\.update\)/);
  assert.match(unitModule, /onFieldChange\("unitType", event\.target\.value\)/);
  assert.match(unitModule, /onFieldChange\("customerCompanyName", value\)/);
  assert.match(createUnit, /role="combobox"[\s\S]*?value=\{form\.unitNo\} onChange=/);
  assert.doesNotMatch(unitModule, /onUnitNumberChange\(event\.target\.value\)|onUnitNumberCommit\}/);
});
