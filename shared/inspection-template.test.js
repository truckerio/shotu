import test from "node:test";
import assert from "node:assert/strict";
import {
  INSPECTION_TEMPLATE_FAMILY,
  INSPECTION_TYPES, INSPECTION_PRESETS, inspectionPreset,
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

test("inspection slip escapes data and distinguishes answered and pending checks", () => {
  const html = renderInspectionSlip({
    status: "in_progress", inspectionNumber: "INS-1<script>", templateLabel: "Weekly Truck Inspection",
    unit: { unitNo: "T&1" }, templateSnapshot: weeklyInspectionPreset("Truck"),
    responses: [{ itemKey: "outside-1", response: "pass" }], result: "",
  });
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /INS-1&lt;script&gt;/);
  assert.match(html, /T&amp;1/);
  assert.match(html, /IN PROGRESS/);
  assert.equal((html.match(/class="check"/g) || []).length, 12);
  assert.equal((html.match(/class="outcome">Pass</g) || []).length, 1);
  assert.equal((html.match(/class="outcome">Pending</g) || []).length, 11);
  assert.doesNotMatch(html, /class="notes"|<strong>VIN:|<strong>Plate:/);
});

test("concise trailer slip retains checks, issues, N/A reasons, notes, and signature", () => {
  const template = weeklyInspectionPreset("Trailer");
  const html = renderInspectionSlip({ status: "completed", templateSnapshot: template, unit: { vin: "VIN1" },
    responses: [{ id: "r1", itemKey: "outside-1", response: "issue" }, { itemKey: "outside-2", response: "na", naReason: "Not fitted <unsafe>" }],
    findings: [{ responseId: "r1", severity: "minor", note: "Replace lamp & bracket" }], finalNotes: "Follow up\nTomorrow", result: "issues_found" });
  assert.equal((html.match(/class="check"/g) || []).length, 12);
  for (const item of template.sections.flatMap(section => section.items)) assert.ok(html.includes(item.label));
  assert.match(html, /class="outcome">Issue</);
  assert.match(html, /class="outcome">N\/A</);
  assert.match(html, /minor - Replace lamp &amp; bracket/);
  assert.match(html, /Not fitted &lt;unsafe&gt;/);
  assert.match(html, /Notes:<\/strong> Follow up\nTomorrow/);
  assert.match(html, /Result:<\/strong> Issues found/);
  assert.match(html, /VIN1/);
  assert.match(html, /Mechanic signature:/);
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


test("new deferred finding slips retain target and rationale and escape policy text", () => {
  const html = renderInspectionSlip({ status: "completed", result: "issues_found", templateSnapshot: weeklyInspectionPreset("Truck"),
    responses: [{ id: "response", itemKey: "outside-1", response: "issue" }],
    findings: [{ responseId: "response", severity: "attention", note: "Review cover", disposition: "defer", deferral: { reason: "Review <cover> later", nextVisit: true, dueDate: "2026-11-01", dueMiles: 250000, earlyMiles: 200 } }] });
  assert.match(html, /Deferred: Review &lt;cover&gt; later/);
  assert.match(html, /Next shop visit; By 2026-11-01; At 250000 mi; whichever comes first/);
  assert.match(html, /Early notice: 200 mi/);
  assert.match(html, /Result:<\/strong> Issues found/);
});


test("each inspection type has a distinct truck and trailer starter with stable checklist identity", () => {
  assert.deepEqual(INSPECTION_TYPES.map(type => type.key), ["weekly", "annual", "pre_trip", "post_trip", "custom"]);
  assert.equal(INSPECTION_PRESETS.length, 10);
  for (const { key } of INSPECTION_TYPES) {
    for (const unitType of ["Truck", "Trailer"]) {
      const definition = inspectionPreset(unitType, key);
      assert.equal(definition.inspectionType, key);
      assert.equal(definition.assetType, unitType);
      assert.ok(inspectionItemCount(definition) > 0);
      const keys = definition.sections.flatMap(section => [section.key, ...section.items.map(item => item.key)]);
      assert.equal(new Set(keys).size, keys.length);
      if (key !== "weekly") assert.notEqual(definition.presetKey, weeklyInspectionPreset(unitType).presetKey);
    }
  }
  assert.equal(inspectionPreset("Truck"), weeklyInspectionPreset("Truck"));
  assert.equal(inspectionPreset("Truck", "invalid"), null);
});
