import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const detailPage = readFileSync(new URL("./WorkorderDetailPage.jsx", import.meta.url), "utf8");
const detailSections = readFileSync(new URL("./WorkorderDetailSections.jsx", import.meta.url), "utf8");
const roleRouter = readFileSync(new URL("../../app/routes/RoleRouter.jsx", import.meta.url), "utf8");
const roleRouterModel = readFileSync(new URL("../../app/routes/role-router-model.js", import.meta.url), "utf8");
const presentation = readFileSync(new URL("../../lib/workorder-presentation.js", import.meta.url), "utf8");

test("existing mechanic completion flow uses Work done language", () => {
  assert.match(detailPage, /"Work done"/);
  assert.match(detailPage, /completion\.workDone/);
  assert.match(detailPage, /completion\.yes/);
  assert.match(detailPage, /completion\.keepWorking/);
  assert.doesNotMatch(detailPage, /Write your name to confirm|expectedMechanicName|mechanicFinishNameMatches/);
  assert.doesNotMatch(detailPage, /Finish workorder|Finish work|Finishing/);
  assert.match(roleRouter, /\/mark-done/);
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
  assert.match(roleRouter, /workorders\/\$\{activeWorkorder\.workorder\.id\}\/return/);
  assert.match(roleRouter, /workorders\/\$\{activeWorkorder\.workorder\.id\}\/cancel/);
  assert.match(roleRouter, /expectedUpdatedAt: activeWorkorder\.workorder\.updatedAt/);
  assert.match(detailPage, /maxLength="1000"/);
  assert.match(roleRouter, /formatLifecycleLabel/);
  assert.match(presentation, /cancelled: "Cancelled"/);
});

test("shared detail shows canonical read-only timing and separates authorization", () => {
  assert.match(detailSections, /aria-label="Workorder timing"/);
  assert.match(detailSections, /Customer authorization/);
  assert.doesNotMatch(detailSections, /<input type="time"/);
  assert.match(roleRouter, /canonicalPreviewTimes\(workorder\)/);
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
  assert.match(roleRouter, /writeOfficeWorkorderEditBackup\(actor\.id, workorderId, patch\)/);
  assert.match(roleRouter, /readOfficeWorkorderEditBackup\(actor\.id, detail\.workorder\.id\)/);
  assert.match(roleRouter, /saveOfficeWorkorder\(\{ automatic: true \}\)/);
  assert.match(roleRouter, /Saved automatically\./);
});
