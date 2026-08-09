import assert from "node:assert/strict";
import test from "node:test";
import { projectProtectedWorkorderDetail, workorderInputModules } from "./workorder-module-projection.js";

test("hidden module data is absent from both compatibility and module payloads", () => {
  const projected = projectProtectedWorkorderDetail({
    workorder: {
      id: "wo-1", companyId: "company-1", serial: "WO-1", status: "open",
      concern: "secret concern", diagnosis: "secret diagnosis", asset: { unitNo: "T1" },
      formData: { unitNo: "T1", mechanicConcern: "secret concern", parts: [{ partNo: "P1" }] },
      odooStatus: "not_entered",
    },
    messages: [{ id: "m1", body: "secret chat" }],
    timeline: [{ id: "t1" }],
    partRequests: [{ id: "p1" }],
    allowedActions: { sendMessage: true, saveNotes: true, update: true },
    activeAttention: [{ reason: "office_help", details: { note: "secret" } }, { reason: "overdue" }],
  }, {
    unit: { access: "read", source: "default" },
    concern: { access: "hidden", source: "user" },
    diagnosisRepair: { access: "hidden", source: "user" },
    parts: { access: "hidden", source: "user" },
    chat: { access: "hidden", source: "user" },
    activity: { access: "read", source: "default" },
    odoo: { access: "hidden", source: "default" },
  });

  assert.equal(projected.workorder.asset.unitNo, "T1");
  assert.equal(projected.workorder.formData.unitNo, "T1");
  assert.equal("concern" in projected.workorder, false);
  assert.equal("diagnosis" in projected.workorder, false);
  assert.equal("parts" in projected.workorder.formData, false);
  assert.equal("messages" in projected, false);
  assert.equal("partRequests" in projected, false);
  assert.equal("odooStatus" in projected.workorder, false);
  assert.equal("concern" in projected.modules, false);
  assert.deepEqual(projected.timeline, [{ id: "t1" }]);
  assert.deepEqual(projected.allowedActions, { sendMessage: false, saveNotes: false, update: false });
  assert.deepEqual(projected.activeAttention, [{ reason: "overdue" }]);
});

test("input ownership decomposes broad updates into touched modules", () => {
  assert.deepEqual(workorderInputModules({
    assetId: null,
    officeNotes: "call customer",
    formData: { workStartDate: "2026-08-08", parts: [] },
  }).sort(), ["concern", "parts", "schedule", "unit"]);
  assert.deepEqual(workorderInputModules({ concern: "inspect", formData: {} }, { create: true }), ["concern"]);
});
