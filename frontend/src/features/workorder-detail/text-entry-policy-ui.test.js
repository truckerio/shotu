import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readSource = (relativePath) => readFileSync(new URL(relativePath, import.meta.url), "utf8");

const createForm = readSource("../generator/CreateWorkorderForm.jsx");
const createConcern = readSource("../workorder-modules/work/CreateConcernModule.jsx");
const createParts = readSource("../workorder-modules/parts/CreatePartsModule.jsx");
const createUnit = readSource("../workorder-modules/unit/CreateUnitModule.jsx");
const detailPage = readSource("./WorkorderDetailPage.jsx");
const workModule = readSource("../workorder-modules/diagnosis-repair/WorkorderDiagnosisRepairModule.jsx");
const teamModule = readSource("../workorder-modules/assignment/WorkorderAssignmentModule.jsx");
const concernModule = readSource("../workorder-modules/work/WorkorderConcernModule.jsx");
const completionModule = readSource("../workorder-modules/completion/WorkorderCompletionModule.jsx");
const unitModule = readSource("../workorder-modules/unit/WorkorderUnitModule.jsx");
const chatComposer = readSource("../../components/workorders/ChatComposer.jsx");
const usedPartsEditor = readSource("../../components/workorders/UsedPartsEditor.jsx");
const partCatalogCombobox = readSource("../../components/workorders/part-requests/PartCatalogCombobox.jsx");
const customerCompanyField = readSource("../../components/forms/CustomerCompanyField.jsx");
const unitSummary = readSource("../../components/forms/UnitSummary.jsx");

test("shared workorder writing surfaces use selectable spelling suggestions", () => {
  assert.match(createConcern, /<NarrativeField[\s\S]*form\.mechanicConcern/);
  assert.match(workModule, /<NarrativeField[\s\S]*diagnosis/);
  assert.match(workModule, /<NarrativeField[\s\S]*workPerformed/);
  assert.match(concernModule, /<NarrativeField/);
  assert.match(teamModule, /<NarrativeField[\s\S]*assignment\.reason/);
  assert.equal((detailPage.match(/<NarrativeField/g) || []).length, 3);
  assert.match(chatComposer, /<NarrativeField[\s\S]*className="chat-composer-input"/);
  assert.match(usedPartsEditor, /<NarrativeField[\s\S]*part\.repairOrder/);
});

test("shared workorder names and technical values use conservative keyboard policies", () => {
  assert.match(customerCompanyField, /textEntryProps\("name"\)/);
  assert.match(unitModule, /textEntryProps\("name"\)[\s\S]*form\.customerCompanyName/);
  assert.match(completionModule, /customerSignature/);
  assert.doesNotMatch(detailPage, /mechanicFinish\.name|expectedMechanicName/);
  assert.match(createUnit, /textEntryProps\("search"\)[\s\S]*role="combobox"/);
  assert.match(unitModule, /textEntryProps\("search"\)[\s\S]*aria-label=\{t\("unit\.number"\)\}/);
  assert.match(createParts, /value=\{part\.partNo\}[\s\S]*inputPolicy="identifier"/);
  assert.match(usedPartsEditor, /value=\{catalogQuery\}[\s\S]*inputPolicy="identifier"/);
  assert.match(partCatalogCombobox, /textEntryProps\(inputPolicy\)/);
  assert.match(unitSummary, /textEntryProps\("identifier"\)/);
});
