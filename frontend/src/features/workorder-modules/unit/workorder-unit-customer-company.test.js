import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./WorkorderUnitModule.jsx", import.meta.url), "utf8");

test("detail unit customer company reuses the editable Samsara tag combobox", () => {
  assert.match(source, /import \{ CustomerCompanyField \} from "\.\.\/\.\.\/\.\.\/components\/forms\/index\.js";/);
  assert.match(source, /import \{ normalizedVehicleTagNames \} from "\.\/CreateUnitModule\.jsx";/);
  assert.match(source, /selectedVehicle,/);
  assert.match(source, /normalizedVehicleTagNames\(selectedVehicle\?\.tag_names \|\| selectedVehicle\?\.tagNames\)/);
  assert.match(source, /<CustomerCompanyField[\s\S]*?value=\{form\.customerCompanyName\}[\s\S]*?onChange=\{\(value\) => onFieldChange\("customerCompanyName", value\)\}[\s\S]*?label=\{t\("unit\.customerCompany"\)\}[\s\S]*?suggestions=\{vehicleTags\}[\s\S]*?suggestionsLabel=\{t\("create\.unit\.vehicleTags"\)\}/);
});

test("detail customer company does not replace manual entry with vehicle tags", () => {
  assert.doesNotMatch(source, /customerCompanyName", vehicleTags\.join/);
  assert.doesNotMatch(source, /<select[\s\S]*?customerCompanyName/);
});
