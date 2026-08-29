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
    formData: { workStartDate: "2026-08-08", parts: [], laborHours: "2.5" },
  }).sort(), ["concern", "parts", "schedule", "unit"]);
  assert.deepEqual(workorderInputModules({ concern: "inspect", formData: {} }, { create: true }), ["concern"]);
});

test("parts projection returns persisted labor hours with used parts", () => {
  const projected = projectProtectedWorkorderDetail({
    workorder: {
      id: "wo-1",
      companyId: "company-1",
      serial: "WO-1",
      status: "in_progress",
      formData: {
        laborHours: "2.5",
        laborProduct: { externalId: "91", code: "LAB200", name: "Shop labor", uomCode: "hr" },
        parts: [{ partNo: "P1", qty: "1", uomCode: "ea", repairOrder: "Installed" }],
      },
    },
    installedSerializedParts: [{ catalogPartId: "catalog-1", partNumber: "P2", quantity: 1, uomCode: "ea" }],
  }, {
    parts: { access: "write", source: "default" },
  });

  assert.equal(projected.workorder.formData.laborHours, "2.5");
  assert.equal(projected.modules.parts.data.formData.laborHours, "2.5");
  assert.equal(projected.modules.parts.data.formData.laborProduct.code, "LAB200");
  assert.deepEqual(projected.modules.parts.data.installedSerializedParts, [
    { catalogPartId: "catalog-1", partNumber: "P2", quantity: 1, uomCode: "ea" },
  ]);
});

test("installed serialized summaries stay hidden when Parts is hidden", () => {
  const projected = projectProtectedWorkorderDetail({
    workorder: { id: "wo-1", companyId: "company-1", formData: {} },
    installedSerializedParts: [{ catalogPartId: "catalog-1", partNumber: "SECRET", quantity: 1, uomCode: "ea" }],
  }, {
    parts: { access: "hidden", source: "user" },
    preview: { access: "read", source: "default" },
  });
  assert.equal(JSON.stringify(projected).includes("SECRET"), false);
});

test("mechanic parts projection exposes only local operational availability and safe request fields", () => {
  const projected = projectProtectedWorkorderDetail({
    user: { id: "mechanic-1", role: "mechanic" },
    workorder: {
      id: "wo-1",
      companyId: "company-1",
      locationId: "location-1",
      serial: "WO-1",
      status: "in_progress",
      formData: {},
    },
    partRequests: [{
      id: "request-1",
      workorderId: "wo-1",
      catalogPartId: "catalog-1",
      requestedByUserId: "mechanic-1",
      requestedByName: "Mechanic One",
      rawQuery: "LF9009 oil filter",
      partNumber: "LF9009",
      manufacturer: "Fleetguard",
      description: "Oil filter",
      category: "filter",
      quantity: 1,
      uomCode: "ea",
      repairOrder: "Replace filter",
      approvalStatus: "approved",
      fitmentStatus: "confirmed",
      fitmentNotes: "Confirmed for unit",
      usageStatus: "not_issued",
      approvedByName: "Office One",
      approvedAt: "2026-08-26T20:00:00.000Z",
      decisionReason: "Approved",
      sourceChatMessageId: "chat-1",
      sourceAttachmentId: "attachment-1",
      rawContext: { internalPrompt: "private" },
      allocations: [{
        id: "allocation-1",
        sourceType: "purchase",
        status: "ordered",
        quantity: 1,
        uomCode: "ea",
        locationId: "location-2",
        vendor: "Private Vendor",
        sourceReference: "PO-100",
        unitPrice: 42.5,
        quoteUrl: "https://vendor.example/quote",
      }],
      inventory: [{
        id: "local-item",
        locationId: "location-1",
        locationName: "Workorder Yard",
        quantityOnHand: 8,
        quantityReserved: 3,
        quantityAvailable: 5,
        uomCode: "ea",
        binLocation: "A-12",
        updatedAt: "2026-08-26T19:00:00.000Z",
      }, {
        id: "remote-item",
        locationId: "location-2",
        locationName: "Remote Yard",
        quantityOnHand: 20,
        quantityReserved: 1,
        quantityAvailable: 19,
        uomCode: "ea",
        binLocation: "SECRET-1",
      }],
      createdAt: "2026-08-26T18:00:00.000Z",
      updatedAt: "2026-08-26T20:00:00.000Z",
    }],
  }, {
    parts: { access: "write", source: "default" },
  });

  const request = projected.partRequests[0];
  assert.equal(request.partNumber, "LF9009");
  assert.equal(request.manufacturer, "Fleetguard");
  assert.equal(request.approvalStatus, "approved");
  assert.deepEqual(request.allocations, []);
  assert.deepEqual(request.inventory, [{
    locationId: "location-1",
    locationName: "Workorder Yard",
    quantityAvailable: 5,
    uomCode: "ea",
    updatedAt: "2026-08-26T19:00:00.000Z",
  }]);
  for (const field of [
    "requestedByUserId", "sourceChatMessageId", "sourceAttachmentId", "rawContext",
  ]) assert.equal(field in request, false, `${field} must be absent`);
  const serialized = JSON.stringify(projected.modules.parts.data.partRequests);
  for (const secret of [
    "Remote Yard", "SECRET-1", "quantityOnHand", "quantityReserved", "Private Vendor",
    "PO-100", "unitPrice", "quoteUrl", "sourceType", "internalPrompt", "chat-1", "attachment-1",
  ]) assert.equal(serialized.includes(secret), false, `${secret} must be absent`);
});

test("office and admin parts projections preserve the existing request detail shape", () => {
  const request = {
    id: "request-1",
    rawContext: { officeEvidence: true },
    sourceChatMessageId: "chat-1",
    sourceAttachmentId: "attachment-1",
    allocations: [{ vendor: "Vendor", unitPrice: 12.5, quoteUrl: "https://vendor.example" }],
    inventory: [{ locationId: "remote-location", quantityOnHand: 4, quantityReserved: 1 }],
  };

  for (const role of ["office", "admin"]) {
    const projected = projectProtectedWorkorderDetail({
      user: { id: `${role}-1`, role },
      workorder: { id: "wo-1", companyId: "company-1", locationId: "location-1", formData: {} },
      partRequests: [request],
    }, {
      parts: { access: "write", source: "default" },
    });
    assert.deepEqual(projected.partRequests, [request]);
    assert.deepEqual(projected.modules.parts.data.partRequests, [request]);
  }
});
