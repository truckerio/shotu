import test from "node:test";
import assert from "node:assert/strict";
import {
  INSPECTION_TEMPLATE_FAMILY,
  WEEKLY_INSPECTION_PRESETS,
  inspectionItemCount,
  renderInspectionSlip,
  weeklyInspectionPreset,
} from "./inspection-template.js";

test("V1 exposes only weekly truck and trailer presets with three sections and twelve checks", () => {
  assert.deepEqual(Object.keys(WEEKLY_INSPECTION_PRESETS), ["Truck", "Trailer"]);
  for (const type of ["Truck", "Trailer"]) {
    const definition = weeklyInspectionPreset(type);
    assert.equal(definition.sections.length, 3);
    assert.equal(inspectionItemCount(definition), 12);
    assert.doesNotMatch(JSON.stringify(definition), /annual|fmcsa|periodic/i);
  }
  assert.deepEqual(INSPECTION_TEMPLATE_FAMILY.supportedAssetTypes, ["Truck", "Trailer"]);
});

test("inspection slip escapes data and renders explicit tri-state boxes", () => {
  const html = renderInspectionSlip({
    status: "in_progress", inspectionNumber: "INS-1<script>", templateLabel: "Weekly Truck Inspection",
    unit: { unitNo: "T&1" }, templateSnapshot: weeklyInspectionPreset("Truck"),
    responses: [{ itemKey: "outside-1", response: "pass" }], result: "",
  });
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /INS-1&lt;script&gt;/);
  assert.match(html, /T&amp;1/);
  assert.match(html, /IN PROGRESS/);
  assert.match(html, /Pass.*Issue.*N\/A/);
});

test("correction slip visibly identifies revision lineage without workorder identity", () => {
  const html=renderInspectionSlip({status:"completed",inspectionNumber:"INS-2",templateLabel:"Weekly Truck Inspection",unit:{unitNo:"T-1"},templateSnapshot:weeklyInspectionPreset("Truck"),responses:[],result:"repair_required",lineageKind:"correction",revisionNumber:2,revisionReason:"Corrected notes",predecessorInspectionNumber:"INS-1",workordersLinked:true});
  assert.match(html,/CORRECTION — REVISION 2/);
  assert.match(html,/Reason: Corrected notes/);
  assert.match(html,/Corrects inspection: INS-1/);
  assert.match(html,/Workorder linked/);
  assert.doesNotMatch(html,/WO-|workorderId|workorderSerial/);
});

test("reinspection slip visibly identifies its source lineage", () => {
  const html=renderInspectionSlip({status:"completed",inspectionNumber:"INS-3",templateLabel:"Weekly Truck Inspection",unit:{unitNo:"T-1"},templateSnapshot:weeklyInspectionPreset("Truck"),responses:[],result:"passed",lineageKind:"reinspection",revisionReason:"Verify repair",predecessorInspectionNumber:"INS-2"});
  assert.match(html,/REINSPECTION/);
  assert.match(html,/Reason: Verify repair/);
  assert.match(html,/Source inspection: INS-2/);
});

test("truck slip includes immutable start evidence", () => {
  const html=renderInspectionSlip({status:"completed",inspectionNumber:"INS-3",templateLabel:"Weekly Truck Inspection",unit:{unitNo:"T-3"},templateSnapshot:weeklyInspectionPreset("Truck"),responses:[],result:"pass",startEvidence:{odometerMiles:120003.4,engineHours:8321.2,previousReportReviewed:true},previousReportAvailable:true});
  assert.match(html,/Odometer:<\/strong> 120003\.4 mi/);
  assert.match(html,/Engine hours:<\/strong> 8321\.2/);
  assert.match(html,/Previous report:<\/strong> Reviewed/);
});
