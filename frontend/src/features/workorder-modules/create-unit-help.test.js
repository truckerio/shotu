import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readSource = (relativePath) => readFileSync(new URL(relativePath, import.meta.url), "utf8");
const createUnit = readSource("./unit/CreateUnitModule.jsx");
const createConcern = readSource("./work/CreateConcernModule.jsx");
const createLocation = readSource("./location/CreateLocationModule.jsx");
const createSchedule = readSource("./schedule/CreateScheduleModule.jsx");
const createParts = readSource("./parts/CreatePartsModule.jsx");
const workorderObjectPage = readSource("../../components/workorders/WorkorderObjectPage.jsx");
const workorderDetailStyles = readSource("../../styles/workorder-detail.css");

test("unit instructions stay behind accessible help disclosure", () => {
  assert.match(createUnit, /<FormSection[\s\S]*title=\{t\("create\.unit\.unit"\)\}[\s\S]*action=\{\(/);
  assert.match(createUnit, /<SectionHelpDisclosure label=\{t\("create\.unit\.summary"\)\}>/);
  assert.match(createUnit, /<p>\{t\("create\.unit\.summary"\)\}<\/p>/);
  assert.match(createUnit, /<p>\{t\("create\.unit\.searchHelp"\)\}<\/p>/);
  assert.match(createUnit, /<p>\{t\("create\.unit\.detailsHelp"\)\}<\/p>/);
  assert.match(createUnit, /<p>\{t\("create\.unit\.customerHint"\)\}<\/p>/);
  assert.doesNotMatch(createUnit, /summary=\{t\("create\.unit\.summary"\)\}/);
  assert.doesNotMatch(createUnit, /description=\{t\("create\.unit\.searchHelp"\)\}/);
  assert.doesNotMatch(createUnit, /description=\{t\("create\.unit\.detailsHelp"\)\}/);
  assert.doesNotMatch(createUnit, /hint=\{t\("create\.unit\.customerHint"\)\}/);
  assert.doesNotMatch(createUnit, /headerAction=\{\([\s\S]*create\.unit\.summary/);
});

test("Create panels keep one useful heading layer", () => {
  assert.match(createUnit, /showTitle=\{false\}[\s\S]*<FormSection[\s\S]*title=\{t\("create\.unit\.unit"\)\}/);
  assert.match(createUnit, /<FormSection title=\{t\("create\.unit\.customer"\)\}>/);
  assert.match(createConcern, /showTitle=\{false\}[\s\S]*<FormSection[\s\S]*title=\{t\("create\.concern\.problem"\)\}/);
  assert.match(createLocation, /showTitle=\{false\}[\s\S]*<FormSection title=\{t\("create\.location\.repairLocation"\)\}>/);
  assert.match(createSchedule, /showTitle=\{false\}[\s\S]*<FormSection title=\{t\("create\.schedule\.workDates"\)\}>/);
  assert.match(createParts, /showTitle=\{!compactLayout\}/);
  assert.match(createParts, /compactLayout \? \([\s\S]*create-parts-labor-title/);
  assert.match(createParts, /function LegacyCreatePartsEditor/);
});

test("title-hidden Create help stays beside the visible section heading", () => {
  assert.match(createConcern, /<FormSection[\s\S]*title=\{t\("create\.concern\.problem"\)\}[\s\S]*action=\{<SectionHelpDisclosure/);
  assert.doesNotMatch(createConcern, /headerAction=/);
  assert.match(createParts, /headerAction=\{compactLayout \? null : partsHelp\}/);
  assert.match(createParts, /className="create-parts-group-heading has-help"[\s\S]*create-parts-labor-title[\s\S]*\{partsHelp\}/);
});

test("panel sections support one minimal visible title or a title-hidden Create layout", () => {
  assert.match(workorderObjectPage, /headerAction = null/);
  assert.match(workorderObjectPage, /showTitle = true/);
  assert.match(workorderObjectPage, /role="tabpanel"[\s\S]*aria-label=\{title\}/);
  assert.match(workorderObjectPage, /showTitle \? <div><h2>\{title\}<\/h2>\{summary \? <p>\{summary\}<\/p> : null\}<\/div> : null/);
  assert.match(workorderObjectPage, /workorder-section-panel-action/);
  assert.match(workorderObjectPage, /headerAction \? \([\s\S]*is-action-only/);
  assert.match(workorderDetailStyles, /workorder-section-panel-heading\.is-action-only[\s\S]*border-bottom: 0[\s\S]*justify-content: flex-end/);
});
