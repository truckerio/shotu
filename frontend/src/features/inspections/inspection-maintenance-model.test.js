import test from "node:test";
import assert from "node:assert/strict";
import { deferralIsComplete, deferralPayload, emptyDeferral, maintenanceEndpoint, maintenanceTriggerLabel } from "./inspection-maintenance-model.js";
import { responseIsComplete } from "./inspection-model.js";
import { inspectionFromApi, openInspectionFollowUps, responsePayload } from "./inspection-api-model.js";

test("deferral requires reason and concrete trigger without marking issue passed", () => {
  const deferral = { ...emptyDeferral(), reason: "Minor wear; reassess on return" };
  const issue = { response: "issue", severity: "attention", note: "Cover worn", disposition: "defer", deferral };
  assert.equal(responseIsComplete({}, issue), true);
  assert.equal(responseIsComplete({}, { ...issue, severity: "out_of_service" }), false);
  assert.equal(responseIsComplete({}, { ...issue, severity: "repair_required" }), false);
  assert.equal(deferralIsComplete({ ...deferral, reason: "" }), false);
  assert.equal(deferralIsComplete({ ...deferral, nextVisit: false }), false);
});

test("additional mileage needs finite baseline and positive interval; trailers cannot use mileage", () => {
  const deferral = { ...emptyDeferral(), reason: "Review seal", nextVisit: false, additionalMiles: "2000", baselineMiles: "248000" };
  assert.equal(deferralIsComplete(deferral), true);
  assert.equal(deferralIsComplete({ ...deferral, baselineMiles: null }), false);
  assert.equal(deferralIsComplete({ ...deferral, additionalMiles: 0 }), false);
  assert.equal(deferralIsComplete({ ...deferral, additionalMiles: Infinity }), false);
  assert.equal(deferralIsComplete(deferral, "Trailer"), false);
  assert.equal(deferralIsComplete({ ...emptyDeferral(), reason: "Review at visit" }, "Trailer"), true);
  assert.equal(deferralIsComplete({ ...emptyDeferral(), reason: "Review", earlyMiles: -1 }), false);
});

test("API round trip retains deferral policy and numeric fields", () => {
  const finding = { id: "f", responseId: "r", severity: "attention", note: "Review seal", disposition: "defer", deferral: { ...emptyDeferral(), reason: "At service", dueMiles: "250000", earlyMiles: "150" } };
  const record = inspectionFromApi({ responses: [{ id: "r", itemKey: "seal", response: "issue" }], findings: [finding] });
  assert.equal(record.responses.seal.deferral.reason, "At service");
  const payload = responsePayload("seal", record.responses.seal);
  assert.equal(payload.response, "issue");
  assert.equal(payload.finding.deferral.dueMiles, 250000);
  assert.equal(payload.finding.deferral.earlyMiles, 150);
  assert.equal(deferralPayload(emptyDeferral()).dueMiles, null);
});

test("reminder targets existing record endpoints and explains earliest trigger", () => {
  assert.equal(maintenanceEndpoint("inspection", "a/b"), "/api/inspections/a%2Fb/maintenance");
  assert.equal(maintenanceEndpoint("workorder", "w"), "/api/inspections/workorders/w/maintenance");
  assert.equal(maintenanceEndpoint("unit", "u"), "/api/vehicles/u/maintenance");
  assert.equal(maintenanceEndpoint("unknown", "u"), "");
  assert.match(maintenanceTriggerLabel({ nextVisit: true, dueMiles: 250000, dueDate: "2026-11-01" }), /whichever comes first/);
});


test("deferred obligations do not also render legacy No-workorder-needed follow-up controls", () => {
  const followUps = [{ id: "deferred", findingId: "a", status: "open", version: 1, deferral: emptyDeferral() }, { id: "office", findingId: "b", status: "open", version: 1 }];
  assert.deepEqual(openInspectionFollowUps({ followUps }).map(item => item.id), ["office"]);
});


test("selected mileage trigger stays incomplete while mechanic fills its fields", () => {
  const base = { ...emptyDeferral(), reason: "Review at service" };
  assert.equal(deferralIsComplete({ ...base, dueMiles: "" }), false);
  assert.equal(deferralIsComplete({ ...base, additionalMiles: "", baselineMiles: "9870" }), false);
  assert.equal(deferralIsComplete({ ...base, additionalMiles: "2130", baselineMiles: "" }), false);
  assert.equal(deferralIsComplete({ ...base, additionalMiles: "2130", baselineMiles: "9870" }), true);
});


test("editing an additional-mile deferral recalculates its previously persisted target", () => {
  const existing = { ...emptyDeferral(), reason: "Reviewed again at service", baselineMiles: 9800, additionalMiles: 200, dueMiles: 10000 };
  assert.equal(deferralPayload({ ...existing, baselineMiles: "9870" }).dueMiles, 10070);
  assert.equal(deferralPayload({ ...existing, additionalMiles: "300" }).dueMiles, 10100);
  assert.equal(deferralPayload({ ...existing, baselineMiles: null, additionalMiles: null, dueMiles: 12000 }).dueMiles, 12000);
});
