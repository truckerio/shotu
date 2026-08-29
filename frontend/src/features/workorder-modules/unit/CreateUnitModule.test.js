import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./CreateUnitModule.jsx", import.meta.url), "utf8");
const formCss = readFileSync(new URL("../../../components/forms/operational-form.css", import.meta.url), "utf8");

test("vehicle tags accept only bounded, unique strings", () => {
  assert.match(source, /if \(!Array\.isArray\(tagNames\)\) return \[\];/);
  assert.match(source, /tagNames\.slice\(0, MAX_VEHICLE_TAGS\)\.reduce/);
  assert.match(source, /if \(typeof tag !== "string"\) return tags;/);
  assert.match(source, /normalized\.length > MAX_VEHICLE_TAG_LENGTH/);
  assert.match(source, /seen\.has\(key\)/);
  assert.doesNotMatch(source, /MAX_VISIBLE_VEHICLE_TAGS/);
});

test("vehicle tags set one customer company through the existing form contract", () => {
  assert.match(source, /normalizedVehicleTagNames\(selectedVehicle\?\.tag_names\)/);
  assert.match(source, /vehicleTags\.length \? <div className="operational-vehicle-tag-picker"/);
  assert.match(source, /onClick=\{\(\) => onChange\("customerCompanyName", tag\)\}/);
  assert.doesNotMatch(source, /customerCompanyName", vehicleTags\.join/);
});

test("vehicle tag chips wrap and retain phone-sized tap targets", () => {
  assert.match(formCss, /\.operational-vehicle-tag-list \{[\s\S]*flex-wrap: wrap;/);
  assert.match(formCss, /\.operational-vehicle-tag-list button \{[\s\S]*max-width: 100%;[\s\S]*min-height: 44px;/);
  assert.match(formCss, /text-overflow: ellipsis/);
});
