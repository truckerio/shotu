import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const detailPage = readFileSync(new URL("./WorkorderDetailPage.jsx", import.meta.url), "utf8");
const detailSections = readFileSync(new URL("./WorkorderDetailSections.jsx", import.meta.url), "utf8");
const roleRouter = readFileSync(new URL("../../app/routes/RoleRouter.jsx", import.meta.url), "utf8");

test("existing mechanic completion flow uses Work done language", () => {
  assert.match(detailPage, /"Work done"/);
  assert.match(detailPage, /Mark work as done\?/);
  assert.match(detailPage, /Confirm work done/);
  assert.doesNotMatch(detailPage, /Finish workorder|Finish work|Finishing/);
  assert.match(roleRouter, /\/mark-done/);
});

test("manager handoff actions use allowed actions and documented endpoints", () => {
  assert.match(detailSections, /allowedActions\?\.returnToMechanic/);
  assert.match(detailSections, /allowedActions\?\.cancel/);
  assert.match(roleRouter, /workorders\/\$\{activeWorkorder\.workorder\.id\}\/return/);
  assert.match(roleRouter, /workorders\/\$\{activeWorkorder\.workorder\.id\}\/cancel/);
  assert.match(roleRouter, /expectedUpdatedAt: activeWorkorder\.workorder\.updatedAt/);
  assert.match(detailPage, /maxLength="1000"/);
  assert.match(roleRouter, /value: "cancelled", label: "Cancelled"/);
});

test("shared detail shows canonical read-only timing and separates authorization", () => {
  assert.match(detailSections, /aria-label="Workorder timing"/);
  assert.match(detailSections, /Customer authorization/);
  assert.doesNotMatch(detailSections, /<input type="time"/);
  assert.match(roleRouter, /canonicalPreviewTimes\(workorder\)/);
  assert.match(roleRouter, /authorizedBy: approvalName \|\| savedForm\.authorizedBy \|\| ""/);
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
