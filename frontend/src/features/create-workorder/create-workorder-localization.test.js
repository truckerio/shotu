import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { interfaceText, missingLocaleKeys } from "../../i18n/index.js";

function source(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const createForm = source("../generator/CreateWorkorderForm.jsx");
const createModules = [
  source("../workorder-modules/work/CreateConcernModule.jsx"),
  source("../workorder-modules/location/CreateLocationModule.jsx"),
  source("../workorder-modules/parts/CreatePartsModule.jsx"),
  source("../workorder-modules/schedule/CreateScheduleModule.jsx"),
  source("../workorder-modules/unit/CreateUnitModule.jsx"),
];

test("Create form and modules accept the mechanic locale with an English default", () => {
  assert.match(createForm, /locale = "en"/);
  assert.match(createForm, /locale, onChange: onFieldChange/);
  for (const moduleSource of createModules) {
    assert.match(moduleSource, /locale = "en"/);
    assert.match(moduleSource, /interfaceText\(locale, key\)/);
  }
});

test("Create modules localize static controls while preserving submitted values", () => {
  const unit = createModules.at(-1);
  const parts = createModules[2];
  assert.match(unit, /<option value="Truck">\{t\("create\.unit\.truck"\)\}<\/option>/);
  assert.match(unit, /<option value="Trailer">\{t\("create\.unit\.trailer"\)\}<\/option>/);
  assert.match(parts, /<PartCatalogCombobox[\s\S]*locale=\{locale\}/);
  assert.match(parts, /<QuantityUnitInput[\s\S]*locale=\{locale\}/);
  assert.match(createForm, /create\.validation\.\$\{key\}/);
});

test("Create interface translations are present in English, Spanish, and Punjabi", () => {
  assert.deepEqual(missingLocaleKeys("es"), []);
  assert.deepEqual(missingLocaleKeys("pa"), []);
  assert.equal(interfaceText("es", "create.unit.searching"), "Buscando unidades...");
  assert.equal(interfaceText("pa", "create.parts.add"), "ਪਾਰਟ ਜੋੜੋ");
  assert.equal(interfaceText("es", "uom.unit.gal"), "Galón");
  assert.equal(interfaceText("pa", "create.validation.unitNo"), "ਯੂਨਿਟ ਦਰਜ ਕਰੋ ਜਾਂ ਚੁਣੋ।");
});
