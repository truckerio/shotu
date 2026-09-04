import assert from "node:assert/strict";
import test from "node:test";
import {
  buildWorkorderDraftPayload,
  formValuesFromWorkorderDraft,
  isMeaningfulWorkorderDraft,
} from "./workorder-draft.js";

test("workorder creation draft preserves required form and assignment data", () => {
  const payload = buildWorkorderDraftPayload({
    actor: { companyIds: ["company-1"], locationIds: ["location-1"] },
    form: {
      locationId: "location-1",
      customerCompanyName: "Long Haul",
      mechanicConcern: "Oil leak",
      unitNo: "G2021",
      parts: [],
    },
    mechanicUserIds: ["mechanic-1", "mechanic-1"],
    selectedVehicle: { id: "asset-1" },
  });
  assert.equal(payload.assetId, "asset-1");
  assert.equal(payload.concern, "Oil leak");
  assert.deepEqual(payload.mechanicUserIds, ["mechanic-1"]);
  assert.equal(payload.formData.customerCompanyName, "Long Haul");
  assert.equal(isMeaningfulWorkorderDraft(payload), true);
});

test("mechanic creation leaves assignment ownership to the authenticated server", () => {
  const payload = buildWorkorderDraftPayload({
    actor: {
      role: "mechanic",
      companyIds: ["company-1"],
      locationIds: ["location-1"],
    },
    form: {
      locationId: "location-1",
      customerCompanyName: "Long Haul",
      mechanicConcern: "Inspection",
      mechanicName: "Mechanic One",
      customerSignature: "Customer Signer",
      authorizedBy: "Fleet Manager",
      unitNo: "G2026",
      parts: [],
    },
    mechanicUserIds: ["mechanic-1"],
    selectedVehicle: { id: "asset-1" },
  });

  assert.equal(Object.hasOwn(payload, "mechanicUserIds"), false);
  assert.equal(Object.hasOwn(payload.formData, "mechanicName"), false);
  assert.equal(Object.hasOwn(payload.formData, "customerSignature"), false);
  assert.equal(Object.hasOwn(payload.formData, "authorizedBy"), false);
  assert.equal(payload.formData.unitNo, "G2026");
  assert.equal(payload.concern, "Inspection");
});

test("direct create derives company ownership from the selected repair location", () => {
  const payload = buildWorkorderDraftPayload({
    actor: {
      role: "mechanic",
      companyIds: ["company-a", "company-b"],
      companyMemberships: [{ companyId: "company-a" }, { companyId: "company-b" }],
    },
    form: { locationId: "location-b", mechanicConcern: "Inspect brakes", parts: [] },
    selectedLocation: {
      location: { id: "location-b", company_id: "company-b" },
    },
  });

  assert.equal(payload.companyId, "company-b");
  assert.equal(payload.locationId, "location-b");
});

test("draft values restore into the controlled create form", () => {
  const restored = formValuesFromWorkorderDraft({
    locationId: "location-2",
    concern: "Brake inspection",
    formData: { unitNo: "T110", customerCompanyName: "Customer" },
  }, { locationId: "location-1", unitNo: "", parts: [] });
  assert.equal(restored.locationId, "location-2");
  assert.equal(restored.unitNo, "T110");
  assert.equal(restored.mechanicConcern, "Brake inspection");
});

test("draft quantity serialization preserves units and defaults legacy parts to piece", () => {
  const payload = buildWorkorderDraftPayload({
    actor: { companyIds: ["company-1"], locationIds: ["location-1"] },
    form: {
      locationId: "location-1",
      parts: [
        { catalogPartId: "11111111-1111-4111-8111-111111111111", partNo: "OIL", qty: "2.5", uomCode: "gal", repairOrder: "Refill" },
        { partNo: "FILTER", qty: "1", repairOrder: "Replace" },
      ],
    },
  });

  assert.deepEqual(payload.formData.parts, [
    { catalogPartId: "11111111-1111-4111-8111-111111111111", partNo: "OIL", qty: "2.5", uomCode: "gal", repairOrder: "Refill" },
    { partNo: "FILTER", qty: "1", uomCode: "pc", repairOrder: "Replace" },
  ]);
  assert.equal(formValuesFromWorkorderDraft({
    formData: { parts: [{ partNo: "FILTER", qty: "1" }] },
  }, { parts: [] }).parts[0].uomCode, "pc");
});

test("create draft carries exact unit selections outside printable form rows", () => {
  const payload = buildWorkorderDraftPayload({
    actor: { companyIds: ["company-1"], locationIds: ["location-1"] },
    form: {
      locationId: "location-1",
      parts: [{
        catalogPartId: "11111111-1111-4111-8111-111111111111",
        partNo: "Tire",
        qty: "2",
        uomCode: "ea",
        repairOrder: "Replace tires",
        serializationRequired: true,
        serializedUnitIds: [
          "22222222-2222-4222-8222-222222222222",
          "33333333-3333-4333-8333-333333333333",
        ],
        serializedSerialNumbers: ["SER-1", "SER-2"],
      }],
    },
  });

  assert.deepEqual(payload.inventoryUnitSelections, [{
    partIndex: 0,
    catalogPartId: "11111111-1111-4111-8111-111111111111",
    unitIds: [
      "22222222-2222-4222-8222-222222222222",
      "33333333-3333-4333-8333-333333333333",
    ],
  }]);
  assert.deepEqual(payload.formData.parts[0].serializedSerialNumbers, ["SER-1", "SER-2"]);
  assert.equal(payload.formData.parts[0].serializationRequired, true);
  assert.equal(formValuesFromWorkorderDraft(payload, { parts: [] }).parts[0].serializationRequired, true);
});

test("location and template changes make create drafts meaningful after baseline", () => {
  const actor = { companyIds: ["company-1"], locationIds: ["location-1"] };
  const form = {
    locationId: "location-2",
    headerTitle: "TEXAS YARD WORKORDER",
    brandTop: "PRO TEC",
    brandBottom: "REPAIR",
    warrantyText: "Warranty",
    responsibilityText: "Responsibility",
    authorizationText: "Authorization",
    parts: [],
  };
  const baseline = {
    locationId: "location-1",
    formData: {
      headerTitle: "CHINO YARD WORKORDER",
      brandTop: "PRO TEC",
      brandBottom: "REPAIR",
      warrantyText: "Warranty",
      responsibilityText: "Responsibility",
      authorizationText: "Authorization",
    },
  };

  assert.equal(isMeaningfulWorkorderDraft(buildWorkorderDraftPayload({ actor, form }), baseline), true);
  assert.equal(
    isMeaningfulWorkorderDraft(
      buildWorkorderDraftPayload({ actor, form: { ...form, locationId: "location-1", headerTitle: "CHINO YARD WORKORDER" } }),
      baseline,
    ),
    false,
  );
});

test("create autosave round-trips every editable workorder field", () => {
  const form = {
    locationId: "location-2",
    customerCompanyName: "Customer Two",
    headerTitle: "CUSTOM WORKORDER",
    brandTop: "TOP",
    brandBottom: "BOTTOM",
    warrantyText: "Warranty text",
    responsibilityText: "Responsibility text",
    authorizationText: "Authorization text",
    workDate: "2026-07-30",
    workStartDate: "2026-07-30",
    workEndDate: "2026-07-31",
    unitNo: "TRUCK-42",
    unitType: "Tractor",
    licenseNo: "8ABC123",
    mileage: "123456",
    model: "579",
    vinNo: "1XKWDB0X0XR123456",
    mechanicConcern: "Clutch slips under load",
    laborHours: "2.5",
    workPerformed: "Replace clutch assembly and road test",
    mechanicName: "Mechanic One",
    startTime: "09:15",
    endTime: "11:45",
    managerName: "Manager One",
    officeNotes: "Priority customer",
    customerSignature: "Customer Signer",
    authorizedBy: "Fleet Manager",
    parts: [{ partNo: "11011", qty: "3", uomCode: "pc", repairOrder: "Replace clutch assembly" }],
  };
  const payload = buildWorkorderDraftPayload({
    actor: { companyIds: ["company-1"], locationIds: ["location-1"] },
    form,
    mechanicUserIds: ["mechanic-1", "mechanic-2"],
    selectedVehicle: { id: "asset-42" },
  });
  const restored = formValuesFromWorkorderDraft(payload, { parts: [] });

  assert.equal(payload.locationId, form.locationId);
  assert.equal(payload.assetId, "asset-42");
  assert.equal(payload.concern, form.mechanicConcern);
  assert.equal(payload.officeNotes, form.officeNotes);
  assert.deepEqual(payload.mechanicUserIds, ["mechanic-1", "mechanic-2"]);
  for (const [field, value] of Object.entries(form)) {
    if (field === "locationId" || field === "officeNotes") continue;
    assert.deepEqual(restored[field], value, `${field} should survive draft restore`);
  }
  assert.equal(restored.locationId, form.locationId);
  assert.equal(restored.officeNotes, form.officeNotes);
  assert.equal(isMeaningfulWorkorderDraft(payload), true);
});

test("labor repair order is meaningful and survives create draft restore", () => {
  const actor = { companyIds: ["company-1"], locationIds: ["location-1"] };
  const payload = buildWorkorderDraftPayload({
    actor,
    form: {
      locationId: "location-1",
      workPerformed: "Inspect and adjust brakes",
      parts: [],
    },
  });

  assert.equal(payload.formData.workPerformed, "Inspect and adjust brakes");
  assert.equal(formValuesFromWorkorderDraft(payload, { workPerformed: "", parts: [] }).workPerformed, "Inspect and adjust brakes");
  assert.equal(isMeaningfulWorkorderDraft(payload), true);
});
