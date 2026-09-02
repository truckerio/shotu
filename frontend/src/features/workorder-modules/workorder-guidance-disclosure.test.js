import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readSource = (relativePath) => readFileSync(new URL(relativePath, import.meta.url), "utf8");

test("Create Workorder removes repeated summaries and keeps optional guidance behind help", () => {
  const concern = readSource("./work/CreateConcernModule.jsx");
  const schedule = readSource("./schedule/CreateScheduleModule.jsx");
  const location = readSource("./location/CreateLocationModule.jsx");
  const assignment = readSource("./assignment/CreateAssignmentModule.jsx");
  const parts = readSource("./parts/CreatePartsModule.jsx");

  assert.match(concern, /SectionHelpDisclosure/);
  assert.doesNotMatch(concern, /summary=\{t\("create\.concern\.summary"\)\}/);
  assert.doesNotMatch(concern, /hint=\{t\("create\.concern\.hint"\)\}/);
  assert.doesNotMatch(schedule, /summary=\{t\("create\.schedule\.summary"\)\}/);
  assert.doesNotMatch(location, /summary=\{t\("create\.location\.summary"\)\}/);
  assert.match(assignment, /SectionHelpDisclosure/);
  assert.match(assignment, /description=""/);
  assert.match(parts, /SectionHelpDisclosure/);
  assert.doesNotMatch(parts, /summary=\{t\("create\.parts\.summary"\)\}/);
  assert.doesNotMatch(parts, /create-parts-action-help/);
  assert.doesNotMatch(parts, /create-parts-scan-help/);
});

test("Detail Workorder hides tutorials while keeping state owners and optional repair fields", () => {
  const diagnosis = readSource("./diagnosis-repair/WorkorderDiagnosisRepairModule.jsx");
  const concern = readSource("./work/WorkorderConcernModule.jsx");
  const photos = readSource("./photos/WorkorderPhotosModule.jsx");
  const odoo = readSource("./odoo/WorkorderOdooModule.jsx");
  const odooPanel = readSource("./odoo/WorkorderOdooPanel.jsx");

  assert.match(diagnosis, /SectionHelpDisclosure/);
  assert.doesNotMatch(diagnosis, /hint=\{localeText\("detail\.(diagnosisHint|repairHint)"\)\}/);
  assert.doesNotMatch(diagnosis, /repairRequired|detail\.repairRequired|is-completion-required/);
  assert.doesNotMatch(concern, /summary=\{concern/);
  assert.match(concern, /role="status"/);
  assert.match(concern, /<span>\{text\("detail\.addCorrection"/);
  assert.doesNotMatch(photos, /photos\.noneOnWorkorder/);
  assert.match(odoo, /SectionHelpDisclosure/);
  assert.doesNotMatch(odoo, /Service order readiness and entry/);
  assert.doesNotMatch(odooPanel, /Odoo entry becomes available after/);
  assert.match(odooPanel, /surveillance-odoo-blockers" role="status"/);
});

test("deep Detail Parts guidance uses help without hiding conditional rules", () => {
  const request = readSource("../../components/workorders/part-requests/OfficeRequestCard.jsx");
  const history = readSource("../../components/workorders/part-requests/RepairHistorySuggestions.jsx");
  const surface = readSource("../../components/workorders/part-requests/OfficePartsSurface.jsx");
  const composer = readSource("../../components/workorders/part-requests/OfficePartComposer.jsx");
  const usedParts = readSource("../../components/workorders/UsedPartsEditor.jsx");

  assert.match(request, /SectionHelpDisclosure label=\{t\("parts\.reviewRequestHelp"\)\}/);
  assert.match(request, /SectionHelpDisclosure label=\{t\("parts\.responseHelp"\)\}/);
  assert.match(request, /placeholder=\{t\("parts\.responsePlaceholder"\)\}/);
  assert.match(history, /SectionHelpDisclosure label=\{t\("parts\.repairSuggestionHelp"\)\}/);
  assert.equal((surface.match(/parts\.planningDoesNotRecordUse/g) || []).length, 2);
  assert.doesNotMatch(composer, /parts\.planningDoesNotRecordUse/);
  assert.doesNotMatch(usedParts, /parts\.legacyManualEvidence/);
});
