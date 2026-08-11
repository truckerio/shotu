import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const detailPage = readFileSync(new URL("./WorkorderDetailPage.jsx", import.meta.url), "utf8");
const detailCss = readFileSync(new URL("../../styles/workorder-detail.css", import.meta.url), "utf8");
const detailToolbarCss = readFileSync(new URL("./workorder-detail-toolbar.css", import.meta.url), "utf8");
const workDoneButton = readFileSync(new URL("../../components/workorders/WorkDoneButton.jsx", import.meta.url), "utf8");
const detailSections = readFileSync(new URL("./WorkorderDetailSections.jsx", import.meta.url), "utf8");
const concernModule = readFileSync(new URL("../workorder-modules/work/WorkorderConcernModule.jsx", import.meta.url), "utf8");
const diagnosisRepairModule = readFileSync(new URL("../workorder-modules/diagnosis-repair/WorkorderDiagnosisRepairModule.jsx", import.meta.url), "utf8");
const assignmentModule = readFileSync(new URL("../workorder-modules/assignment/WorkorderAssignmentModule.jsx", import.meta.url), "utf8");
const completionModule = readFileSync(new URL("../workorder-modules/completion/WorkorderCompletionModule.jsx", import.meta.url), "utf8");
const activityModule = readFileSync(new URL("../workorder-modules/activity/WorkorderActivityModule.jsx", import.meta.url), "utf8");
const handoffFacts = readFileSync(new URL("../workorder-modules/WorkorderHandoffFacts.jsx", import.meta.url), "utf8");
const roleRouter = readFileSync(new URL("../../app/routes/RoleRouter.jsx", import.meta.url), "utf8");
const formController = readFileSync(new URL("../../app/routes/useRoleRouterFormController.js", import.meta.url), "utf8");
const lifecycleEffects = readFileSync(new URL("../../app/routes/useRoleRouterLifecycleEffects.js", import.meta.url), "utf8");
const detailViewModel = readFileSync(new URL("../../app/routes/useWorkorderDetailViewModel.js", import.meta.url), "utf8");
const detailRoute = readFileSync(new URL("../../app/routes/useWorkorderDetailRoute.js", import.meta.url), "utf8");
const mechanicActions = readFileSync(new URL("../mechanic/useMechanicWorkorderActions.js", import.meta.url), "utf8");
const officeActions = readFileSync(new URL("../office/useOfficeWorkorderActions.js", import.meta.url), "utf8");
const roleRouterModel = readFileSync(new URL("../../app/routes/role-router-model.js", import.meta.url), "utf8");
const presentation = readFileSync(new URL("../../lib/workorder-presentation.js", import.meta.url), "utf8");

test("existing mechanic completion flow uses Work done language", () => {
  assert.match(detailPage, /WorkDoneButton/);
  assert.match(workDoneButton, /label = "Work done"/);
  assert.match(detailPage, /completion\.workDone/);
  assert.match(detailPage, /completion\.yes/);
  assert.match(detailPage, /completion\.keepWorking/);
  assert.doesNotMatch(detailPage, /Write your name to confirm|expectedMechanicName|mechanicFinishNameMatches/);
  assert.doesNotMatch(detailPage, /Finish workorder|Finish work|Finishing/);
  assert.match(mechanicActions, /\/mark-done/);
  assert.match(mechanicActions, /selectDetailSection\("diagnosisRepair"\)/);
  assert.match(mechanicActions, /validationField: "workPerformed"/);
  assert.match(detailPage, /is-validation-warning/);
  assert.match(detailPage, /role=\{validation \? "alert" : "status"\}/);
  assert.match(diagnosisRepairModule, /is-completion-required/);
  assert.match(diagnosisRepairModule, /Required — add repair details here or in a part repair order/);
  assert.match(detailToolbarCss, /\.mechanic-action-message\.is-validation-warning[\s\S]*#b42318/);
  assert.match(detailCss, /@keyframes mechanic-required-field-blink/);
  assert.match(detailCss, /\.operational-form-field\.is-completion-required/);
  assert.match(detailCss, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(roleRouter, /useMechanicWorkorderActions/);
});

test("mechanic progress is automatic and timing stays outside the primary work form", () => {
  assert.doesNotMatch(diagnosisRepairModule, /WorkorderHandoffFacts/);
  assert.doesNotMatch(diagnosisRepairModule, /Save progress/);
  assert.match(activityModule, /id="activity"[\s\S]*WorkorderHandoffFacts/);
  assert.match(diagnosisRepairModule, /MechanicProgressStatus/);
});

test("manager handoff actions use allowed actions and documented endpoints", () => {
  assert.match(completionModule, /allowedActions\.returnToMechanic/);
  assert.match(completionModule, /allowedActions\.cancel/);
  assert.match(completionModule, /canMarkDone = allowedActions\.markDone === true/);
  assert.match(officeActions, /action: "return"/);
  assert.match(officeActions, /action: "cancel"/);
  assert.match(officeActions, /action: "mark-done"/);
  assert.match(officeActions, /resolveWorkPerformed\(form\)/);
  assert.match(detailSections, /onMarkDone: isOfficeDetail \? markOfficeWorkorderDone : openMechanicFinish/);
  assert.match(officeActions, /expectedUpdatedAt: workorder\.updatedAt/);
  assert.match(detailPage, /maxLength="1000"/);
  assert.match(detailViewModel, /formatLifecycleLabel/);
  assert.match(roleRouter, /useOfficeWorkorderActions/);
  assert.match(presentation, /cancelled: "Cancelled"/);
});

test("Work done visibility follows the server-authorized action for mechanic and office", () => {
  assert.match(
    detailPage,
    /canMarkWorkDone = \(isMechanicDetail \|\| isOfficeDetail\) && activeWorkorder\.allowedActions\?\.markDone === true/,
  );
  assert.match(detailPage, /actions: canMarkWorkDone && !isCompact/);
  assert.match(detailPage, /\{canMarkWorkDone && isMechanicDetail && isCompact \? \(/);
  assert.doesNotMatch(
    detailPage,
    /renderedDetailSection === "completion" && completionPolicy\.canWrite && activeWorkorder\?\.allowedActions\.markDone/,
  );
});

test("shared detail shows canonical read-only timing and separates authorization", () => {
  assert.match(handoffFacts, /aria-label="Workorder timing"/);
  assert.match(completionModule, /Customer authorization/);
  assert.doesNotMatch(`${concernModule}\n${assignmentModule}\n${completionModule}\n${activityModule}`, /<input type="time"/);
  assert.match(lifecycleEffects, /canonicalPreviewTimes\(workorder\)/);
  assert.match(roleRouterModel, /authorizedBy: approvalName \|\| savedForm\.authorizedBy \|\| ""/);
  assert.match(completionModule, /Pending Manager approval/);
  assert.match(completionModule, /Authorized by/);
  assert.doesNotMatch(completionModule, /Authorization recorded by/);
});

test("closed missing-information correction uses the server-authorized administrative seam", () => {
  assert.match(detailSections, /activeAttention/);
  assert.match(concernModule, /Information requested by Surveillance/);
  assert.match(concernModule, /canWrite = writable\(access\) && Boolean\(allowedActions\.update\)/);
});

test("Manager detail fields keep a scoped backup and autosave through the shared office endpoint", () => {
  assert.match(formController, /writeOfficeWorkorderEditBackup\(actorId, workorderId, patch\)/);
  assert.match(roleRouter, /import \{ clearOfficeWorkorderEditBackup, writeOfficeWorkorderEditBackup \}/);
  assert.match(roleRouter, /writeEditBackup: writeOfficeWorkorderEditBackup/);
  assert.match(detailRoute, /readOfficeWorkorderEditBackup\(actor\.id, workorder\.id\)/);
  assert.match(officeActions, /saveOfficeWorkorder\(\{ automatic: true \}\)/);
  assert.match(officeActions, /Saved automatically\./);
});
