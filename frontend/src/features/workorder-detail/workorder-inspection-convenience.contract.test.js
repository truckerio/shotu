import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("./WorkorderDetailPage.jsx", import.meta.url), "utf8");
const experience = readFileSync(new URL("../inspections/InspectionExperience.jsx", import.meta.url), "utf8");
const detail = readFileSync(new URL("../inspections/InspectionDetail.jsx", import.meta.url), "utf8");

test("closed workorders expose only source-owned inspection actions", () => {
  assert.match(page, /detailStatus !== "closed"/);
  assert.match(page, /InspectionSourceReferences/);
  assert.match(page, /View inspection/);
  assert.match(page, /Reinspect/);
  assert.match(page, /sources\.length === 1/);
  assert.match(page, /Choose source inspection/);
  assert.match(page, /blockerMessage/);
  assert.match(page, /inspectionContextUnavailable/);
});

test("reinspect navigation opens the selected inspection form before explicit start", () => {
  assert.match(experience, /initialReinspection/);
  assert.match(experience, /initialReinspection=\{initialReinspection\}/);
  assert.match(detail, /initialReinspection/);
  assert.match(detail, /setLineageMode\(initialReinspection && inspection\.reinspectionEligible \? "reinspect" : ""\)/);
  assert.match(detail, /Create reinspection/);
});
