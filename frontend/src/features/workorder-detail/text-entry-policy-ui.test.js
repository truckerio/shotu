import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readSource = (relativePath) => readFileSync(new URL(relativePath, import.meta.url), "utf8");

const createForm = readSource("../generator/CreateWorkorderForm.jsx");
const detailPage = readSource("./WorkorderDetailPage.jsx");
const detailSections = readSource("./WorkorderDetailSections.jsx");
const chatComposer = readSource("../../components/workorders/ChatComposer.jsx");
const usedPartsEditor = readSource("../../components/workorders/UsedPartsEditor.jsx");
const customerCompanyField = readSource("../../components/forms/CustomerCompanyField.jsx");
const unitSummary = readSource("../../components/forms/UnitSummary.jsx");

test("shared workorder writing surfaces use selectable spelling suggestions", () => {
  assert.match(createForm, /<NarrativeField[\s\S]*form\.mechanicConcern/);
  assert.match(detailSections, /<NarrativeField[\s\S]*form\.diagnosis/);
  assert.match(detailSections, /<NarrativeField[\s\S]*form\.workPerformed/);
  assert.match(detailSections, /<NarrativeField[\s\S]*form\.officeNotes/);
  assert.match(detailSections, /<NarrativeField[\s\S]*officeAssignment\.reason/);
  assert.equal((detailPage.match(/<NarrativeField/g) || []).length, 3);
  assert.match(chatComposer, /<NarrativeField[\s\S]*className="chat-composer-input"/);
  assert.match(usedPartsEditor, /<NarrativeField[\s\S]*part\.repairOrder/);
});

test("shared workorder names and technical values use conservative keyboard policies", () => {
  assert.match(customerCompanyField, /textEntryProps\("name"\)/);
  assert.match(detailSections, /textEntryProps\("name"\)[\s\S]*form\.customerCompanyName/);
  assert.match(detailSections, /textEntryProps\("name"\)[\s\S]*form\.customerSignature/);
  assert.match(detailPage, /textEntryProps\("name"\)[\s\S]*mechanicFinish\.name/);
  assert.match(createForm, /textEntryProps\("search"\)[\s\S]*role="combobox"/);
  assert.match(detailSections, /textEntryProps\("search"\)[\s\S]*aria-label="Unit no\."/);
  assert.match(createForm, /textEntryProps\("identifier"\)[\s\S]*part\.partNo/);
  assert.match(usedPartsEditor, /textEntryProps\("identifier"\)[\s\S]*part\.partNo/);
  assert.match(unitSummary, /textEntryProps\("identifier"\)/);
});
