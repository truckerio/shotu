import assert from "node:assert/strict";
import test from "node:test";
import { inspectionCanComplete, inspectionProgress, inspectionResponseShouldSave, inspectionResult, inspectionActionForRole, weeklyInspectionTemplate } from "./inspection-model.js";

test("weekly truck and trailer templates have exact distinct approved twelve-check content", () => {
  const truck = weeklyInspectionTemplate("truck"); const trailer = weeklyInspectionTemplate("trailer");
  assert.equal(truck.sections.length, 3); assert.equal(truck.sections.flatMap((section) => section.items).length, 12);
  assert.equal(trailer.sections.length, 3); assert.equal(trailer.sections.flatMap((section) => section.items).length, 12);
  assert.deepEqual(truck.sections.flatMap((section) => section.items).map((item) => item.label), ["Lights and reflectors", "Tires and tire condition/pressure", "Wheels, rims, hubs, and lug nuts", "Mirrors, windshield, and wipers", "Brakes and visible air or hydraulic leaks", "Steering", "Suspension", "Engine fluids and visible leaks", "Belts and hoses", "Fifth wheel and coupling equipment", "Frame and body condition", "Horn and emergency equipment"]);
  assert.deepEqual(trailer.sections.flatMap((section) => section.items).map((item) => item.label), ["Lights and reflectors", "Tires", "Wheels, rims, hubs, and lug nuts", "Body, doors, roof, and floor", "Brakes, air lines, and ABS indication", "Kingpin and coupling condition", "Electrical connection", "Suspension and axles", "Landing gear", "Frame and crossmembers", "Mudflaps and rear-impact guard", "Cargo securement equipment"]);
});

test("inspection result is derived from tri-state issue severities, never supplied by the user", () => {
  const template = weeklyInspectionTemplate();
  const responses = Object.fromEntries(template.sections.flatMap((section) => section.items).map((item) => [item.key, { response: "pass" }]));
  assert.deepEqual(inspectionProgress(template, responses), { total: 12, answered: 12, issues: 0, complete: true });
  assert.equal(inspectionResult(template, responses), "passed");
  responses.outside_1 = { response: "issue", severity: "out_of_service", note: "Broken lamp", disposition: "create_workorder" };
  assert.equal(inspectionResult(template, responses), "out_of_service");
  assert.equal(inspectionCanComplete(template, responses), true);
});

test("issue details and required N/A reasons block completion", () => {
  const template = weeklyInspectionTemplate();
  const responses = Object.fromEntries(template.sections.flatMap((section) => section.items).map((item) => [item.key, { response: "pass" }]));
  responses.outside_1 = { response: "issue", severity: "attention" };
  assert.equal(inspectionCanComplete(template, responses), false);
  template.sections[0].items[1].naReasonRequired = true;
  responses.outside_1 = { response: "pass" }; responses.outside_2 = { response: "na" };
  assert.equal(inspectionCanComplete(template, responses), false);
});

test("partial issue edits stay local until every required finding field is valid", () => {
  const item = weeklyInspectionTemplate().sections[0].items[0];
  assert.equal(inspectionResponseShouldSave(item, { response: "issue" }), false);
  assert.equal(inspectionResponseShouldSave(item, { response: "issue", severity: "attention", note: "Lamp out" }), false);
  assert.equal(inspectionResponseShouldSave(item, { response: "issue", severity: "attention", note: "Lamp out", disposition: "no_workorder" }), false);
  assert.equal(inspectionResponseShouldSave(item, { response: "issue", severity: "attention", note: "Lamp out", disposition: "no_workorder", noWorkorderReason: "Repair scheduled" }), true);
  assert.equal(inspectionResponseShouldSave(item, { response: "issue", severity: "attention", note: "Lamp out", disposition: "office_follow_up" }), true);
  assert.equal(inspectionResponseShouldSave(item, { response: "pass" }), true);
  assert.equal(inspectionResponseShouldSave(item, { response: "pass" }, false), false);
});

test("row action follows role projection without granting read-only mutation", () => {
  assert.equal(inspectionActionForRole({ status: "in_progress" }, "mechanic"), "Continue");
  assert.equal(inspectionActionForRole({ status: "requested" }, "office"), "Assign");
  assert.equal(inspectionActionForRole({ status: "completed" }, "read_only"), "View slip");
  assert.equal(inspectionActionForRole({ status: "in_progress" }, "read_only"), "View status");
});

test("mechanic row actions match the inspection lifecycle", () => {
  assert.equal(inspectionActionForRole({ status: "assigned" }, "mechanic"), "Start");
  assert.equal(inspectionActionForRole({ status: "in_progress" }, "mechanic"), "Continue");
  assert.equal(inspectionActionForRole({ status: "completed" }, "mechanic"), "View slip");
  assert.equal(inspectionActionForRole({ status: "requested" }, "mechanic"), "View status");
});
