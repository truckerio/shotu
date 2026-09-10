import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(relativePath) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

const createShell = source("./CreateWorkorderShell.jsx");
const createForm = source("../generator/CreateWorkorderForm.jsx");
const createHost = source("../workorder-modules/WorkorderCreateModuleHost.jsx");
const panelShell = source("../../components/workorders/WorkorderPanelShell.jsx");
const sectionPrimitive = source("../../components/workorders/WorkorderObjectPage.jsx");
const createUnit = source("../workorder-modules/unit/CreateUnitModule.jsx");
const createConcern = source("../workorder-modules/work/CreateConcernModule.jsx");
const css = source("../../components/workorders/workorder-object-page.css");
const formLayout = source("../../components/workorders/WorkorderFormLayout.jsx");

test("Create opts into an explicit presentation while mechanic Create retains panel navigation", () => {
  const createPage = source("./CreateWorkorderPage.jsx");
  assert.match(createPage, /const createPresentation = isMechanicCreate \? "panel" : "one-page"/);
  assert.match(createPage, /presentation=\{createPresentation\}/);
  assert.match(createShell, /presentation = "panel"/);
  assert.match(createShell, /presentation === "panel"[\s\S]*?<WorkorderSectionNav/s);
  assert.match(createForm, /<WorkorderCreateModuleHost presentation=\{presentation\}/);
  assert.match(panelShell, /const onePage = presentation === "one-page"/);
  assert.match(panelShell, /\{!onePage \? \([\s\S]*?<WorkorderObjectSummary[\s\S]*?<WorkorderSectionNav/s);
});

test("one-page Create and Detail use the same ordered form layout", () => {
  assert.match(createHost, /const ONE_PAGE_CORE_IDS = \["unit", "schedule", "concern", "parts", "assignment"\]/);
  assert.match(createHost, /import \{ WorkorderFormLayout \}/);
  assert.match(createHost, /<WorkorderFormLayout/);
  assert.match(createHost, /const locationSection = orderedSections\.find\(\(section\) => section\.id === "location"\)/);
  assert.match(createHost, /location=\{locationSection \? renderSection\(locationSection, \{ embedded: true, showMap: !unitSection \}\) : null\}/);
  assert.match(createHost, /locationContent: locationSection \? renderSection\(locationSection, \{ mapOnly: true \}\)/);
  assert.match(createHost, /schedule=\{coreSections\.filter\(\(\{ id \}\) => id === "schedule"\)/);
  assert.match(createHost, /assignment=\{coreSections\.filter\(\(\{ id \}\) => id === "assignment"\)/);
  assert.match(createHost, /parts=\{coreSections\.filter\(\(\{ id \}\) => id === "parts"\)/);
  assert.doesNotMatch(createHost, /Select unit &amp; customer/);
  assert.match(formLayout, /workorder-form-layout-primary[\s\S]*?workorder-one-page-location-row[\s\S]*?workorder-one-page-unit-context[\s\S]*?workorder-form-layout-concern/s);
  assert.match(formLayout, /workorder-form-layout-schedule[\s\S]*?\{schedule\}[\s\S]*?\{assignment\}/s);
  assert.match(formLayout, /workorder-form-layout-parts/);
});

test("the shared primitive keeps core sections visible and changes supporting sections to disclosures", () => {
  assert.match(sectionPrimitive, /const onePageCore = presentation\.mode === "one-page"/);
  assert.match(sectionPrimitive, /const open = onePageCore \|\| activeSection === id/);
  assert.match(sectionPrimitive, /presentation\.mode === "one-page" && !onePageCore[\s\S]*?\? "accordion"/);
});

test("one-page layout uses its control-panel width to stack at tablet and constrained-preview sizes", () => {
  assert.match(css, /workorder-one-page-stack\s*\{[^}]*container-type:\s*inline-size/);
  assert.match(css, /\.workorder-one-page-unit-schedule\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1\.7fr\) minmax\(220px, 0\.55fr\)/s);
  assert.match(css, /@container \(max-width: 760px\)[\s\S]*?\.workorder-one-page-unit-schedule\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s);
});

test("one-page sections are a flat working surface, not cards", () => {
  assert.match(css, /data-workorder-presentation="one-page"[\s\S]*?\.workorder-section-panel\s*\{[^}]*background:\s*transparent;[^}]*border:\s*0;[^}]*border-radius:\s*0;[^}]*box-shadow:\s*none;[^}]*padding:\s*0;/s);
  assert.match(css, /workorder-one-page-unit-schedule > \.workorder-section-panel[\s\S]*?background:\s*transparent;[\s\S]*?border:\s*0;[\s\S]*?border-radius:\s*0;[\s\S]*?box-shadow:\s*none;[\s\S]*?padding:\s*0;/s);
  assert.doesNotMatch(css, /workorder-one-page-unit-schedule > \.workorder-section-panel\s*\{[^}]*border:\s*1px[^}]*border-radius:\s*8px[^}]*padding:\s*18px/s);
  assert.match(css, /\.workorder-one-page-stack > \.workorder-section-panel,[\s\S]*?border-top:\s*1px solid #e4e7ec/);
  assert.match(css, /\.operational-form-section \+ \.operational-form-section\s*\{[^}]*border-top:\s*1px solid #e4e7ec;[^}]*box-shadow:\s*none;/s);
});

test("one-page Create compacts optional unit details and concern without changing panel behavior", () => {
  assert.match(createForm, /unit: \{[\s\S]*?presentation,/);
  assert.match(createForm, /concern: \{[\s\S]*?presentation \}/);
  assert.match(createUnit, /const onePage = presentation === "one-page"/);
  assert.match(createUnit, /open=\{onePage \? unitDetailsOpen : true\}/);
  assert.match(createUnit, /onToggle=\{onePage \? setUnitDetailsOpen : undefined\}/);
  assert.match(createConcern, /rows=\{presentation === "one-page" \? 2 : 4\}/);
  assert.match(createUnit, /presentation = "panel"/);
  assert.match(createConcern, /presentation = "panel"/);
});
