import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const detailPage = readFileSync(new URL("./WorkorderDetailPage.jsx", import.meta.url), "utf8");
const detailSections = readFileSync(new URL("./WorkorderDetailSections.jsx", import.meta.url), "utf8");
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
  assert.match(detailPage, /"Work done"/);
  assert.match(detailPage, /completion\.workDone/);
  assert.match(detailPage, /completion\.yes/);
  assert.match(detailPage, /completion\.keepWorking/);
  assert.doesNotMatch(detailPage, /Write your name to confirm|expectedMechanicName|mechanicFinishNameMatches/);
  assert.doesNotMatch(detailPage, /Finish workorder|Finish work|Finishing/);
  assert.match(mechanicActions, /\/mark-done/);
  assert.match(roleRouter, /useMechanicWorkorderActions/);
});

test("mechanic progress is automatic and timing stays outside the primary work form", () => {
  const workSection = detailSections.slice(
    detailSections.indexOf('id="work"'),
    detailSections.indexOf('id="parts"'),
  );
  assert.doesNotMatch(workSection, /WorkorderHandoffFacts/);
  assert.doesNotMatch(workSection, /Save progress/);
  assert.match(detailSections, /id="activity"[\s\S]*WorkorderHandoffFacts/);
  assert.match(detailSections, /MechanicProgressStatus/);
});

test("manager handoff actions use allowed actions and documented endpoints", () => {
  assert.match(detailSections, /allowedActions\?\.returnToMechanic/);
  assert.match(detailSections, /allowedActions\?\.cancel/);
  assert.match(officeActions, /action: "return"/);
  assert.match(officeActions, /action: "cancel"/);
  assert.match(officeActions, /expectedUpdatedAt: workorder\.updatedAt/);
  assert.match(detailPage, /maxLength="1000"/);
  assert.match(detailViewModel, /formatLifecycleLabel/);
  assert.match(roleRouter, /useOfficeWorkorderActions/);
  assert.match(presentation, /cancelled: "Cancelled"/);
});

test("shared detail shows canonical read-only timing and separates authorization", () => {
  assert.match(detailSections, /aria-label="Workorder timing"/);
  assert.match(detailSections, /Customer authorization/);
  assert.doesNotMatch(detailSections, /<input type="time"/);
  assert.match(lifecycleEffects, /canonicalPreviewTimes\(workorder\)/);
  assert.match(roleRouterModel, /authorizedBy: approvalName \|\| savedForm\.authorizedBy \|\| ""/);
  assert.match(detailSections, /Pending Manager approval/);
  assert.match(detailSections, /Authorized by/);
  assert.doesNotMatch(detailSections, /Authorization recorded by/);
});

test("closed missing-information correction uses the server-authorized administrative seam", () => {
  assert.match(detailSections, /activeAttention/);
  assert.match(detailSections, /Information requested by Surveillance/);
  assert.match(detailSections, /disabled=\{!activeWorkorder\.allowedActions\?\.update\}/);
});

test("Manager detail fields keep a scoped backup and autosave through the shared office endpoint", () => {
  assert.match(formController, /writeOfficeWorkorderEditBackup\(actorId, workorderId, patch\)/);
  assert.match(roleRouter, /import \{ clearOfficeWorkorderEditBackup, writeOfficeWorkorderEditBackup \}/);
  assert.match(roleRouter, /writeEditBackup: writeOfficeWorkorderEditBackup/);
  assert.match(detailRoute, /readOfficeWorkorderEditBackup\(actor\.id, workorder\.id\)/);
  assert.match(officeActions, /saveOfficeWorkorder\(\{ automatic: true \}\)/);
  assert.match(officeActions, /Saved automatically\./);
});
