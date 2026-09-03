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
