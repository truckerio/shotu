import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { INSPECTION_REQUIRED_CAPABILITIES } from "./inspection-config.js";
import { INSPECTION_WORKFLOW_STEPS, inspectionCreatePayload, requiredCapabilityHook, startPayload } from "./inspection-workflow.js";
import { createInspectionSchema, inspectionVersionActionSchema } from "../../../src/server/modules/inspections/inspection.schemas.js";
import { inspectionStartPayload } from "../../../frontend/src/features/inspections/inspection-api-model.js";

test("inspection workflow declares every daily-life stage with implemented capability contracts", () => {
  assert.deepEqual(INSPECTION_WORKFLOW_STEPS, ["admin-template-and-module", "office-request-and-assign", "mechanic-start-save-interrupt-resume", "mechanic-issue-workorder-complete", "summary-link-back", "read-only-slip", "print", "follow-up", "correction", "reinspection"]);
  for (const capability of INSPECTION_REQUIRED_CAPABILITIES) assert.equal(requiredCapabilityHook(capability), true);
});

test("inspection fixture create payload has a bounded idempotency key accepted by the live route schema", () => {
  const payload = inspectionCreatePayload({ location: { companyId: "11111111-1111-4111-8111-111111111111", id: "22222222-2222-4222-8222-222222222222" }, assetId: "33333333-3333-4333-8333-333333333333", mechanicUserId: "44444444-4444-4444-8444-444444444444", label: "QA fixture" });
  assert.equal(createInspectionSchema.safeParse(payload).success, true);
  assert.match(payload.idempotencyKey, /^qa-inspection-create-/);
  assert.ok(payload.idempotencyKey.length <= 120);
});

test("inspection start payload sends truck evidence and keeps trailer payload minimal", () => {
  assert.deepEqual(startPayload({ version: 3, unitType: "Truck", previousReportAvailable: true }), { expectedVersion: 3, odometerMiles: 124500, engineHours: 2500.5, previousReportReviewed: true });
  assert.deepEqual(startPayload({ version: 4, unitType: "Truck", previousReportAvailable: false }), { expectedVersion: 4, odometerMiles: 124500, engineHours: 2500.5, previousReportReviewed: false });
  assert.deepEqual(startPayload({ version: 5, unitType: "Trailer", previousReportAvailable: true }), { expectedVersion: 5, previousReportReviewed:true });
});

test("browser and harness start payloads validate against the actual API schema",()=>{
  for(const unitType of ["Truck","Trailer"]){const inspection={version:1,unitType,previousReportAvailable:false};assert.equal(inspectionVersionActionSchema.safeParse(inspectionStartPayload(inspection,{odometerMiles:"12"})).success,true);assert.equal(inspectionVersionActionSchema.safeParse(startPayload(inspection)).success,true);}
});

test("inspection runner keeps live writes behind the configuration gate and reports no success after a pending capability", async () => {
  const source = await readFile(new URL("./inspection-workflow-runner.js", import.meta.url), "utf8");
  const workflow = await readFile(new URL("./inspection-workflow.js", import.meta.url), "utf8");
  assert.match(source, /parseInspectionWorkflowConfig/);
  assert.match(source, /redactQaError/);
  assert.match(workflow, /createClient\("mechanic"\)/);
  assert.match(source, /requiredCapabilityHook\(capability\)/);
  assert.match(source, /cleanupWorkorderIds/);
  assert.match(workflow, /trailerAssetId/);
  assert.match(workflow, /actions\/no-workorder/);
  assert.match(workflow, /actions\/correct/);
  assert.match(workflow, /actions\/reinspect/);
  assert.match(workflow, /mark-done/);
  assert.match(workflow, /workorders\/\$\{encodeURIComponent\(workorderId\)\}\/assignments/);
  assert.match(workflow, /mechanicIds\?\.includes\(actors\.mechanic\.id\)/);
  assert.match(workflow, /\/close/);
  assert.match(workflow, /const workorderId = workorder\.body\?\.workorderId/);
  assert.match(workflow, /onWorkorderFixture\(workorderId\)/);
  assert.match(workflow, /replayedArchiveId/);
  assert.match(workflow, /documentSha256/);
  assert.match(workflow, /documentByteSize/);
  assert.match(workflow, /requestBytes/);
  assert.match(workflow, /application\/pdf/);
  assert.match(workflow, /%PDF-/);
  assert.match(workflow, /payload\.odometerMiles = 124500/);
  assert.match(workflow, /previousReportAvailable/);
  assert.match(workflow, /unitType.*trailer/);
  assert.match(workflow, /reinspection start/);
  assert.match(workflow, /reinspection save/);
  assert.match(workflow, /reinspection complete/);
  assert.doesNotMatch(workflow, /pending: true/);
});

test("inspection workflow explicitly accepts each successful creation response", async () => {
  const workflow = await readFile(new URL("./inspection-workflow.js", import.meta.url), "utf8");
  assert.ok((workflow.match(/expectedStatuses: \[201\]/g) || []).length >= 7);
});

test("inspection browser assertions use the mechanic mixed queue and require Office summary-link return before inspection viewport checks", async () => {
  const source = await readFile(new URL("./inspection-browser-assertions.js", import.meta.url), "utf8");
  for (const width of [390, 430, 640, 768, 820, 1280, 1440, 1920]) assert.match(source, new RegExp(`width: ${width}`));
  assert.match(source, /role === "mechanic" \? trailerInspectionNumber : inspectionNumber/);
  assert.match(source, /role === "office" && workorderNumber/);
  assert.match(source, /visitSummaryWorkorderAndReturn/);
  assert.match(source, /Back to inspection/);
  assert.match(source, /Follow-up inspection/); assert.match(source, /name: "Correct"/); assert.match(source, /name: "Reinspect"/);
  assert.match(source, /assertInspectionViewport\(page, role, targetNumber\)/);
  assert.match(source, /detail\.getByText\(inspectionNumber, \{ exact: true \}\)/);
  assert.match(source, /openInspectionWorkspace/); assert.match(source, /getByRole\("row"/); assert.match(source, /browser\.newContext/); assert.match(source, /getByRole/); assert.match(source, /getByLabel/); assert.match(source, /scrollWidth/); assert.match(source, /document\.activeElement/);
  assert.match(source, /role === "mechanic"/);
  assert.match(source, /getByRole\("button", \{ name: new RegExp\(`Open workorder Inspection/);
  assert.doesNotMatch(source, /\.focus\(\);\s*assert\.equal\(await page\.getByRole\("button", \{ name: "Inspections" \}\)\.evaluate/);
  assert.doesNotMatch(source, /waitForTimeout/);
});
