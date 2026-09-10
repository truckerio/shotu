import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Unit policy changes cannot skip hooks and location fallback stays compact", () => {
  const unit = readFileSync(new URL("../workorder-modules/unit/WorkorderUnitModule.jsx", import.meta.url), "utf8");
  assert.ok(unit.indexOf("if (!access) return null") > unit.lastIndexOf("useEffect(() =>"));
  const location = readFileSync(new URL("../workorder-modules/location/WorkorderLocationModule.jsx", import.meta.url), "utf8");
  assert.match(location, /!\(canWrite && locations\.length\)/);
});

function source(relativePath) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

const detailPage = source("./WorkorderDetailPage.jsx");
const detailSurface = source("../../components/workorders/WorkorderDetailSurface.jsx");
const detailHost = source("../workorder-modules/WorkorderDetailModuleHost.jsx");
const panelShell = source("../../components/workorders/WorkorderPanelShell.jsx");
const formLayout = source("../../components/workorders/WorkorderFormLayout.jsx");
const detailUnit = source("../workorder-modules/unit/WorkorderUnitModule.jsx");

test("only office Detail opts into the one-page presentation", () => {
  assert.match(detailPage, /presentation=\{isOfficeDetail \? "one-page" : "panel"\}/);
  assert.match(detailSurface, /presentation = "panel"/);
  assert.match(detailSurface, /presentation=\{presentation\}/);
  assert.match(panelShell, /data-workorder-presentation=\{presentation\}/);
});

test("office Detail keeps Location and Unit left, dates and mechanic right, and Parts last", () => {
  assert.match(detailHost, /const presentation = useContext\(WorkorderPresentationContext\)/);
  assert.match(detailHost, /const ONE_PAGE_CORE_IDS = \["unit", "schedule", "concern", "diagnosisRepair", "parts", "assignment"\]/);
  assert.match(detailHost, /const Renderer = detailModuleRenderer\(section\.id, renderers\)/);
  assert.match(detailHost, /import \{ WorkorderFormLayout \}/);
  assert.match(detailHost, /<WorkorderFormLayout/);
  assert.match(detailHost, /const locationSection = orderedSections\.find\(\(section\) => section\.id === "location"\)/);
  assert.match(detailHost, /location=\{locationSection \? renderSection\(locationSection, \{ presentation: "one-page", embedded: true \}\) : null\}/);
  assert.match(detailHost, /locationContent: locationSection \? renderSection\(locationSection, \{ presentation: "one-page", mapOnly: true \}\) : null/);
  assert.match(detailHost, /conversation=\{conversation\}/);
  assert.doesNotMatch(detailHost, /diagnosis=\{/);
  assert.match(detailHost, /parts=\{coreSections\.filter\(\(\{ id \}\) => id === "parts"\)/);
  assert.doesNotMatch(detailHost, /workorder-one-page-supporting/);
  assert.match(detailHost, /placementBySurface\?\.detail === "supporting"/);
  assert.match(detailHost, /supportingOnly = false/);
  assert.match(detailHost, /WorkorderPresentationContext\.Provider value=\{\{ \.\.\.presentation, mode: "panel" \}\}/);
  assert.match(detailHost, /renderSection\(section, \{ allowSupporting: true \}\)/);
  assert.match(formLayout, /workorder-form-layout-primary[\s\S]*?workorder-form-layout-location[\s\S]*?workorder-one-page-unit-context/s);
});

test("saved Detail Unit is fixed while descriptive details remain editable", () => {
  assert.match(detailUnit, /<output className="workorder-fixed-unit">\{form.unitNo/);
  assert.doesNotMatch(detailUnit, /role="combobox"|onUnitNumberChange\(/);
  for (const field of ["vinNo", "model", "mileage"]) assert.ok(detailUnit.includes('onFieldChange("' + field + '"'));
  assert.match(detailUnit, /UnitDetailsPopover/);
});

test("earlier notes remain available independently of Chat permission", () => {
  assert.match(detailPage, /const earlierNotes = isOfficeDetail && \(\(concernPolicy.canRead/);
  assert.match(detailPage, /diagnosisRepairPolicy.canRead && \(form.diagnosis \|\| form.workPerformed\)/);
  assert.match(detailPage, /chatPolicy.canRead \|\| earlierNotes \? \[\{ id: "chat"/);
  assert.match(detailPage, /\{earlierNotes\}\{chatPolicy.canRead \?/);
  assert.doesNotMatch(detailPage, /id="workorder-inline-chat"/);
});
