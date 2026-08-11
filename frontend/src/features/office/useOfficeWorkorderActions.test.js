import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOfficeWorkorderPatch,
  createOfficeAutosaveQueue,
  loadOfficeWorkorder,
  officeActionValidationMessage,
  patchOfficeWorkorder,
  runOfficeWorkorderAction,
  saveOfficeUsedPartsRequest,
} from "./useOfficeWorkorderActions.js";

function requestRecorder(response = {}) {
  const calls = [];
  return {
    calls,
    request: async (...args) => {
      calls.push(args);
      return response;
    },
  };
}

test("office action validation preserves return, cancel, and assignment requirements", () => {
  assert.equal(officeActionValidationMessage("return", " "), "Add a reason for the mechanic.");
  assert.equal(officeActionValidationMessage("return", "x"), "Add a reason for the mechanic.");
  assert.equal(officeActionValidationMessage("cancel", "x"), "Add a cancellation reason.");
  assert.equal(officeActionValidationMessage("assignment", ""), "Add a reason before changing the mechanic team.");
  assert.equal(officeActionValidationMessage("return", "Needs another photo"), "");
  assert.equal(officeActionValidationMessage("cancel", "Duplicate"), "");
  assert.equal(officeActionValidationMessage("assignment", "Shift handoff"), "");
});

test("autosave queue serializes writes and reruns for queued or newer revisions", () => {
  const queue = createOfficeAutosaveQueue();
  assert.equal(queue.begin(), true);
  assert.equal(queue.begin(), false);
  assert.equal(queue.finish({ currentRevision: 1, savingRevision: 1 }), true);

  assert.equal(queue.begin(), true);
  assert.equal(queue.finish({ currentRevision: 3, savingRevision: 2 }), true);

  assert.equal(queue.begin(), true);
  assert.equal(queue.finish({ currentRevision: 3, savingRevision: 3 }), false);
});

test("office save patch keeps administrative fields and excludes mechanic-owned progress", () => {
  const payload = buildOfficeWorkorderPatch({
    activeWorkorder: {
      workorder: {
        id: "wo-1",
        updatedAt: "2026-08-02T10:00:00.000Z",
        locationId: "location-old",
        asset: { id: "asset-old" },
        formData: {
          customAdministrativeField: "keep",
          diagnosis: "mechanic diagnosis",
          workPerformed: "mechanic repair",
          mechanicName: "Mechanic One",
          startTime: "08:00",
          endTime: "09:00",
          managerName: "Manager One",
        },
      },
    },
    selectedVehicle: { id: "asset-new" },
    form: {
      locationId: "location-new",
      customerCompanyName: "Long Haul",
      headerTitle: "CHINO YARD WORKORDER",
      brandTop: "PRO TEC",
      brandBottom: "REPAIR",
      warrantyText: "Warranty",
      responsibilityText: "Responsibility",
      authorizationText: "Authorization",
      workDate: "2026-08-02",
      workStartDate: "2026-08-02",
      workEndDate: "2026-08-03",
      unitNo: "1018",
      unitType: "Trailer",
      licenseNo: "ABC123",
      mileage: "12000",
      model: "Vanguard",
      vinNo: "VIN1018",
      mechanicConcern: "Inspect brakes",
      officeNotes: "Priority",
      customerSignature: "Customer",
      authorizedBy: "Office",
      parts: [{ partNo: "FILTER", qty: "1", uomCode: "pc", repairOrder: "Replace" }],
    },
  });

  assert.equal(payload.assetId, "asset-new");
  assert.equal(payload.locationId, "location-new");
  assert.equal(payload.concern, "Inspect brakes");
  assert.equal(payload.officeNotes, "Priority");
  assert.equal(payload.expectedUpdatedAt, "2026-08-02T10:00:00.000Z");
  assert.equal(payload.formData.customAdministrativeField, "keep");
  assert.equal(payload.formData.companyName, "Long Haul");
  assert.deepEqual(payload.formData.parts, [{ partNo: "FILTER", qty: "1", uomCode: "pc", repairOrder: "Replace" }]);
  for (const mechanicOwnedField of ["diagnosis", "workPerformed", "mechanicName", "startTime", "endTime", "managerName"]) {
    assert.equal(Object.hasOwn(payload.formData, mechanicOwnedField), false);
  }
  assert.equal(Object.hasOwn(payload, "actorId"), false);
  assert.equal(Object.hasOwn(payload, "userId"), false);
});

test("office PATCH helper preserves endpoint, revision payload, and no browser actor ID", async () => {
  const recorder = requestRecorder({ workorder: { id: "wo-1" } });
  const payload = { concern: "Inspect", expectedUpdatedAt: "revision-1" };
  await patchOfficeWorkorder({ request: recorder.request, workorderId: "wo-1", payload });

  assert.deepEqual(recorder.calls, [[
    "/api/office/workorders/wo-1",
    { method: "PATCH", body: JSON.stringify(payload) },
  ]]);
  assert.equal(recorder.calls[0][1].body.includes("actorId"), false);
});

test("lifecycle and assignment helpers preserve action endpoints and request bodies", async () => {
  const recorder = requestRecorder();
  await runOfficeWorkorderAction({
    request: recorder.request,
    workorderId: "wo-2",
    action: "return",
    body: { reason: "Add photo", categories: ["photos"] },
  });
  await runOfficeWorkorderAction({
    request: recorder.request,
    workorderId: "wo-2",
    action: "assignments",
    body: { mechanicUserIds: ["mechanic-1", "mechanic-2"], reason: "Second shift" },
  });

  assert.deepEqual(recorder.calls, [
    ["/api/office/workorders/wo-2/return", {
      method: "POST",
      body: JSON.stringify({ reason: "Add photo", categories: ["photos"] }),
    }],
    ["/api/office/workorders/wo-2/assignments", {
      method: "POST",
      body: JSON.stringify({ mechanicUserIds: ["mechanic-1", "mechanic-2"], reason: "Second shift" }),
    }],
  ]);
});

test("parts helper saves labor and goods together and detail loader reads canonical office truth", async () => {
  const recorder = requestRecorder({ workorder: { id: "wo-3" } });
  const parts = [{ partNo: "OIL", qty: "2", uomCode: "qt", repairOrder: "Refill" }];
  await saveOfficeUsedPartsRequest({ request: recorder.request, workorderId: "wo-3", parts, laborHours: "2.5" });
  await loadOfficeWorkorder({ request: recorder.request, workorderId: "wo-3" });

  assert.deepEqual(recorder.calls, [
    ["/api/office/workorders/wo-3/used-parts", {
      method: "PATCH",
      body: JSON.stringify({ parts, laborHours: "2.5" }),
    }],
    ["/api/office/workorders/wo-3"],
  ]);
});

test("request helpers reject missing workorder IDs and invalid injected clients", async () => {
  await assert.rejects(
    patchOfficeWorkorder({ request: async () => ({}), workorderId: "", payload: {} }),
    /Workorder ID is required/,
  );
  await assert.rejects(
    loadOfficeWorkorder({ request: null, workorderId: "wo-4" }),
    /request must be a function/,
  );
});
