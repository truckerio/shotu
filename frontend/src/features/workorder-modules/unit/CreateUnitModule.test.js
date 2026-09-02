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

test("vehicle tags become editable customer company suggestions", () => {
  assert.match(source, /normalizedVehicleTagNames\(selectedVehicle\?\.tag_names\)/);
  assert.match(source, /suggestions=\{vehicleTags\}/);
  assert.match(source, /suggestionsLabel=\{t\("create\.unit\.vehicleTags"\)\}/);
  assert.doesNotMatch(source, /operational-vehicle-tag-picker/);
  assert.doesNotMatch(source, /customerCompanyName", vehicleTags\.join/);
});

test("customer company combobox retains touch and responsive popup geometry", () => {
  assert.match(formCss, /\.customer-company-combobox-trigger \{[\s\S]*min-width: 44px;/);
  assert.match(formCss, /\.customer-company-combobox-popover \{[\s\S]*max-height: min\(320px,[\s\S]*position: absolute;[\s\S]*width: 100%;/);
  assert.match(formCss, /\.customer-company-combobox-option \{[\s\S]*min-height: 40px;/);
});

test("minimal Unit help shares the visible heading row", () => {
  assert.match(source, /<FormSection[\s\S]*title=\{t\("create\.unit\.unit"\)\}[\s\S]*action=\{\([\s\S]*<SectionHelpDisclosure/);
  assert.doesNotMatch(source, /headerAction=\{\([\s\S]*create\.unit\.summary/);
  assert.match(formCss, /\.create-unit-card \.operational-form-section:first-child > \.operational-form-section-legend,[\s\S]*align-items: center;/);
});

test("unit lookup is a compact keyboard listbox with actionable active workorders", () => {
  assert.match(source, /aria-activedescendant=/);
  assert.match(source, /onKeyDown=\{handleUnitKeyDown\}/);
  assert.match(source, /moveVehicleSearchResultIndex/);
  assert.match(source, /vehicleSearchResultAction/);
  assert.match(source, /onOpenActiveWorkorder\?\.\(action\.workorderId\)/);
  assert.doesNotMatch(source, /disabled=\{unavailable\}/);
  assert.doesNotMatch(source, /closeBeforeAnother/);
  assert.match(formCss, /\.operational-unit-results \{[\s\S]*max-height: min\(312px,[\s\S]*overscroll-behavior: contain;/);
  assert.match(formCss, /\.operational-unit-results button \{[\s\S]*min-height: 52px;/);
  assert.match(formCss, /button\.is-unavailable \{[\s\S]*background: #f9fafb;[\s\S]*color: #475467;/);
});
