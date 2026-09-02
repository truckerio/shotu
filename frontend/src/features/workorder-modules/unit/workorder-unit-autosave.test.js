import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const unitModule = readFileSync(new URL("./WorkorderUnitModule.jsx", import.meta.url), "utf8");
const detailSections = readFileSync(new URL("../../workorder-detail/WorkorderDetailSections.jsx", import.meta.url), "utf8");
const roleRouter = readFileSync(new URL("../../../app/routes/RoleRouter.jsx", import.meta.url), "utf8");

test("detail Unit lookup renders controller-owned query and commits only on blur", () => {
  assert.match(unitModule, /value=\{unitLookupQuery\}/);
  assert.match(unitModule, /onChange=\{\(event\) => onUnitNumberChange\(event\.target\.value\)\}/);
  assert.match(unitModule, /onBlur=\{onUnitNumberCommit\}/);
  assert.doesNotMatch(unitModule, /value=\{form\.unitNo\}[\s\S]{0,120}onChange=\{\(event\) => onUnitNumberChange/);
});

test("selecting a vehicle does not blur-commit the temporary query first", () => {
  assert.match(unitModule, /onMouseDown=\{\(event\) => event\.preventDefault\(\)\}[\s\S]*onClick=\{\(\) => onApplyVehicle\(vehicle\)\}/);
});

test("detail and create Unit inputs use separate update policies", () => {
  assert.match(roleRouter, /commitDetailUnitNumber: \(\) => commitUnitNumber\(updateField\)/);
  assert.match(roleRouter, /updateUnitNumber: \(value\) => \{ updateUnitLookupQuery\(value\); updateField\("unitNo", value\); \}/);
  assert.match(detailSections, /onUnitNumberCommit,[\s\S]*unitLookupQuery,[\s\S]*onUnitNumberChange: updateUnitNumber/);
});
