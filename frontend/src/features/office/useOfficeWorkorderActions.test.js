import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOfficeWorkorderPatch,
  createOfficeAutosaveQueue,
  createOfficeWorkorderIdentityTracker,
  loadOfficeWorkorder,
  officeActionValidationMessage,
  patchOfficeWorkorder,
  persistOfficeWorkorderSave,
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
  assert.equal(queue.schedule(0), false);
  assert.equal(queue.schedule(1), true);
  assert.equal(queue.schedule(1), false);
  assert.equal(queue.schedule(2), true);
  assert.equal(queue.begin(), true);
  assert.equal(queue.begin(), false);
  assert.equal(queue.finish({ currentRevision: 1, savingRevision: 1 }), true);

  assert.equal(queue.begin(), true);
  assert.equal(queue.finish({ currentRevision: 3, savingRevision: 2 }), true);

  assert.equal(queue.begin(), true);
  assert.equal(queue.finish({ currentRevision: 3, savingRevision: 3 }), false);
});

test("an autosave revision is consumed once even when a detail reload changes hook dependencies", () => {
  const queue = createOfficeAutosaveQueue();
  assert.equal(queue.schedule(7), true);
  assert.equal(queue.schedule(7), false);
  assert.equal(queue.schedule(7), false);
  assert.equal(queue.schedule(8), true);
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
      laborProduct: { productId: "11111111-1111-4111-8111-111111111111", name: "Shop labor", code: "LAB", uomCode: "hr" },
      parts: [{ partNo: "FILTER", qty: "1", uomCode: "pc", repairOrder: "Replace" }],
      customerDocumentAdjustments: {
        lineDiscounts: [],
        documentDiscount: { kind: "percentage", value: "", reason: "" },
        overrideReasons: [],
      },
      customerDocumentAdjustmentBaseRevisionId: "22222222-2222-4222-8222-222222222222",
    },
  });

  assert.equal(payload.assetId, "asset-new");
  assert.equal(payload.locationId, "location-new");
  assert.equal(payload.concern, "Inspect brakes");
  assert.equal(payload.officeNotes, "Priority");
  assert.equal(payload.expectedUpdatedAt, "2026-08-02T10:00:00.000Z");
  assert.equal(payload.formData.customAdministrativeField, "keep");
  assert.equal(payload.formData.companyName, "Long Haul");
  assert.deepEqual(payload.formData.laborProduct, { productId: "11111111-1111-4111-8111-111111111111", name: "Shop labor", code: "LAB", uomCode: "hr" });
  assert.deepEqual(payload.formData.parts, [{ partNo: "FILTER", qty: "1", uomCode: "pc", repairOrder: "Replace" }]);
  assert.deepEqual(payload.formData.customerDocumentAdjustments, {
    lineDiscounts: [],
    documentDiscount: { kind: "percentage", value: "", reason: "" },
    overrideReasons: [],
  });
  assert.equal(payload.formData.customerDocumentAdjustmentBaseRevisionId, "22222222-2222-4222-8222-222222222222");
  for (const mechanicOwnedField of ["diagnosis", "workPerformed", "mechanicName", "startTime", "endTime", "managerName"]) {
    assert.equal(Object.hasOwn(payload.formData, mechanicOwnedField), false);
  }
  assert.equal(Object.hasOwn(payload, "actorId"), false);
  assert.equal(Object.hasOwn(payload, "userId"), false);
});

test("an unrelated Office save omits unchanged customer-document intent", () => {
  const adjustments = {
    lineDiscounts: [],
    documentDiscount: { kind: "fixed", value: "25", reason: "Service recovery" },
    overrideReasons: [],
  };
  const revisionId = "22222222-2222-4222-8222-222222222222";
  const payload = buildOfficeWorkorderPatch({
    activeWorkorder: {
      workorder: {
        id: "wo-readonly",
        updatedAt: "revision-1",
        formData: {
          workStartDate: "2026-08-02",
          customerDocumentAdjustments: adjustments,
          customerDocumentAdjustmentBaseRevisionId: revisionId,
        },
      },
    },
    selectedVehicle: null,
    form: {
      workStartDate: "2026-08-03",
      parts: [],
      customerDocumentAdjustments: {
        overrideReasons: [],
        documentDiscount: { reason: "Service recovery", value: "25", kind: "fixed" },
        lineDiscounts: [],
      },
      customerDocumentAdjustmentBaseRevisionId: revisionId,
    },
  });

  assert.equal(Object.hasOwn(payload.formData, "customerDocumentAdjustments"), false);
  assert.equal(Object.hasOwn(payload.formData, "customerDocumentAdjustmentBaseRevisionId"), false);
  assert.equal(payload.formData.workStartDate, "2026-08-03");
});

test("Office save patch preserves explicit customer-document clears and marker changes", () => {
  const payload = buildOfficeWorkorderPatch({
    activeWorkorder: {
      workorder: {
        id: "wo-write",
        updatedAt: "revision-1",
        formData: {
          customerDocumentAdjustments: {
            lineDiscounts: [],
            documentDiscount: { kind: "fixed", value: "25", reason: "Service recovery" },
            overrideReasons: [],
          },
          customerDocumentAdjustmentBaseRevisionId: "22222222-2222-4222-8222-222222222222",
        },
      },
    },
    selectedVehicle: null,
    form: {
      parts: [],
      customerDocumentAdjustments: null,
      customerDocumentAdjustmentBaseRevisionId: "",
    },
  });

  assert.equal(payload.formData.customerDocumentAdjustments, null);
  assert.equal(payload.formData.customerDocumentAdjustmentBaseRevisionId, "");
});

test("discount autosave omits saved labor hours from the administrative payload", () => {
  const payload = buildOfficeWorkorderPatch({
    activeWorkorder: {
      workorder: {
        id: "wo-discount",
        updatedAt: "revision-1",
        formData: {
          laborHours: "2",
          customerDocumentAdjustments: null,
          customerDocumentAdjustmentBaseRevisionId: "",
        },
      },
    },
    selectedVehicle: null,
    form: {
      laborHours: "2",
      parts: [],
      customerDocumentAdjustments: {
        lineDiscounts: [],
        documentDiscount: { kind: "fixed", value: "5", reason: "Fleet discount" },
        overrideReasons: [],
      },
      customerDocumentAdjustmentBaseRevisionId: "",
    },
  });

  assert.equal(Object.hasOwn(payload.formData, "laborHours"), false);
  assert.equal(payload.formData.customerDocumentAdjustments.documentDiscount.value, "5");
});

test("an explicit Office labor-hours edit remains in the save payload", () => {
  const payload = buildOfficeWorkorderPatch({
    activeWorkorder: {
      workorder: {
        id: "wo-labor",
        updatedAt: "revision-1",
        formData: { laborHours: "2" },
      },
    },
    selectedVehicle: null,
    form: { laborHours: "3.5", parts: [] },
  });

  assert.equal(payload.formData.laborHours, "3.5");
});

test("office save patch explicitly clears a previously selected labor product", () => {
  const payload = buildOfficeWorkorderPatch({
    activeWorkorder: {
      workorder: {
        id: "wo-1",
        updatedAt: "2026-08-02T10:00:00.000Z",
        formData: { laborProduct: { productId: "old", name: "Old labor", uomCode: "hr" } },
      },
    },
    selectedVehicle: null,
    form: { laborProduct: null, parts: [] },
  });

  assert.equal(payload.formData.laborProduct, null);
});

test("office save patch does not serialize an ID-less labor placeholder", () => {
  const unsavedPlaceholder = buildOfficeWorkorderPatch({
    activeWorkorder: {
      workorder: { id: "wo-1", updatedAt: "revision-1", formData: { laborProduct: null } },
    },
    selectedVehicle: null,
    form: { laborProduct: { code: "PTR001", name: "Default labor" }, parts: [] },
  });
  assert.equal(unsavedPlaceholder.formData.laborProduct, null);

  const savedProduct = { productId: "11111111-1111-4111-8111-111111111111", code: "LAB", name: "Shop labor" };
  const hydratedPlaceholder = buildOfficeWorkorderPatch({
    activeWorkorder: {
      workorder: { id: "wo-1", updatedAt: "revision-1", formData: { laborProduct: savedProduct } },
    },
    selectedVehicle: null,
    form: { laborProduct: { code: "PTR001", name: "Default labor" }, parts: [] },
  });
  assert.deepEqual(hydratedPlaceholder.formData.laborProduct, savedProduct);
});

test("in-flight office save writes its captured ID but discards completion after navigation", async () => {
  const tracker = createOfficeWorkorderIdentityTracker("wo-old");
  const savingIdentity = tracker.update("wo-old");
  let resolvePatch;
  const patchPending = new Promise((resolve) => { resolvePatch = resolve; });
  const calls = [];
  const applied = [];
  const request = async (path, options) => {
    calls.push([path, options]);
    if (options?.method === "PATCH") return patchPending;
    throw new Error("A stale save must not reload its former detail.");
  };

  const saving = persistOfficeWorkorderSave({
    applyDetail: (...args) => applied.push(args),
    automatic: true,
    isCurrent: () => tracker.isCurrent(savingIdentity),
    payload: { expectedUpdatedAt: "revision-old" },
    request,
    workorderId: "wo-old",
  });

  tracker.update("wo-new");
  resolvePatch({ workorder: { id: "wo-old" } });
  assert.deepEqual(await saving, { saved: true, stale: true, detail: null });
  assert.deepEqual(calls, [[
    "/api/office/workorders/wo-old",
    { method: "PATCH", body: JSON.stringify({ expectedUpdatedAt: "revision-old" }) },
  ]]);
  assert.deepEqual(applied, []);
});

test("in-flight office reload cannot apply its former detail after navigation", async () => {
  const tracker = createOfficeWorkorderIdentityTracker("wo-old");
  const savingIdentity = tracker.update("wo-old");
  let resolveReload;
  const reloadPending = new Promise((resolve) => { resolveReload = resolve; });
  const applied = [];
  const request = async (_path, options) => options?.method === "PATCH"
    ? { workorder: { id: "wo-old" } }
    : reloadPending;

  const saving = persistOfficeWorkorderSave({
    applyDetail: (...args) => applied.push(args),
    automatic: false,
    isCurrent: () => tracker.isCurrent(savingIdentity),
    payload: { expectedUpdatedAt: "revision-old" },
    request,
    workorderId: "wo-old",
  });

  await Promise.resolve();
  tracker.update("wo-new");
  resolveReload({ workorder: { id: "wo-old", status: "open" } });
  assert.deepEqual(await saving, { saved: true, stale: true, detail: null });
  assert.deepEqual(applied, []);
});

test("office save identity generations reject stale completion after navigating away and back", () => {
  const tracker = createOfficeWorkorderIdentityTracker("wo-1");
  const firstVisit = tracker.update("wo-1");
  tracker.update("wo-2");
  const secondVisit = tracker.update("wo-1");
  assert.equal(tracker.isCurrent(firstVisit), false);
  assert.equal(tracker.isCurrent(secondVisit), true);
});

test("manual Unit replacement detaches the previously selected asset", () => {
  const payload = buildOfficeWorkorderPatch({
    activeWorkorder: {
      workorder: {
        id: "wo-1",
        updatedAt: "2026-08-02T10:00:00.000Z",
        asset: { id: "asset-old", unitNo: "G2020" },
        formData: { unitNo: "G2020" },
      },
    },
    selectedVehicle: null,
    form: { unitNo: "MANUAL-1", parts: [] },
  });

  assert.equal(payload.assetId, null);
  assert.equal(payload.formData.unitNo, "MANUAL-1");
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

test("actual-parts persistence cannot write labor through the Parts endpoint", async () => {
  const recorder = requestRecorder({ workorder: { id: "wo-3" } });
  const parts = [{ partNo: "OIL", qty: "2", uomCode: "qt", repairOrder: "Refill" }];
  await saveOfficeUsedPartsRequest({ request: recorder.request, workorderId: "wo-3", parts, laborHours: "2.5" });
  await loadOfficeWorkorder({ request: recorder.request, workorderId: "wo-3" });

  assert.deepEqual(recorder.calls, [
    ["/api/office/workorders/wo-3/used-parts", {
      method: "PATCH",
      body: JSON.stringify({ parts }),
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
