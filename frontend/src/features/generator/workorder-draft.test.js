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
  assert.equal(payload.formData.customerAccountId, "");
  assert.equal(payload.formData.customerContactId, "");
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
  assert.equal(Object.hasOwn(payload, "authorizationClassification"), false);
});

test("admin authorization classification and audited exception reason persist with the draft payload", () => {
  const payload = buildWorkorderDraftPayload({
    actor: { role: "admin", companyIds: ["company-1"], locationIds: ["location-1"] },
    form: {
      locationId: "location-1", mechanicConcern: "Fleet service", parts: [],
      authorizationClassification: "internal_fleet", authorizationExceptionReason: "Owned fleet maintenance approval",
    },
  });
  assert.equal(payload.authorizationClassification, "internal_fleet");
  assert.equal(payload.authorizationExceptionReason, "Owned fleet maintenance approval");
  const restored = formValuesFromWorkorderDraft(payload, { parts: [] });
  assert.equal(restored.authorizationClassification, "internal_fleet");
  assert.equal(restored.authorizationExceptionReason, "Owned fleet maintenance approval");
});

test("an explicitly restored legacy classification stays omitted instead of becoming approval-not-required", () => {
  const restored = formValuesFromWorkorderDraft(
    { authorizationClassification: "", formData: { customerCompanyName: "Legacy account" } },
    { authorizationClassification: "approval_not_required", parts: [] },
  );
  assert.equal(restored.authorizationClassification, "");
  const payload = buildWorkorderDraftPayload({
    actor: { role: "office", companyIds: ["company-1"], locationIds: ["location-1"] },
    form: { ...restored, locationId: "location-1", parts: [] },
  });
  assert.equal(Object.hasOwn(payload, "authorizationClassification"), false);
});

test("customer directory identities round-trip inside formData without replacing the display fallback", () => {
  const payload = buildWorkorderDraftPayload({
    actor: { role: "office", companyIds: ["company-1"], locationIds: ["location-1"] },
    form: { locationId: "location-1", customerCompanyName: "Long Haul", customerAccountId: "customer-1", customerContactId: "contact-1", parts: [] },
  });
  assert.deepEqual({ customerAccountId: payload.formData.customerAccountId, customerContactId: payload.formData.customerContactId, customerCompanyName: payload.formData.customerCompanyName }, {
    customerAccountId: "customer-1", customerContactId: "contact-1", customerCompanyName: "Long Haul",
  });
  const restored = formValuesFromWorkorderDraft(payload, { parts: [] });
  assert.equal(restored.customerAccountId, "customer-1");
  assert.equal(restored.customerContactId, "contact-1");
});

test("typed customer details round-trip through formData without directory identities", () => {
  const payload = buildWorkorderDraftPayload({
    actor: { role: "office", companyIds: ["company-1"], locationIds: ["location-1"] },
    form: { locationId: "location-1", customerCompanyName: "New operator", customerAddress: "12 Service Road", customerContactName: "Casey", customerContactEmail: "casey@example.test", parts: [] },
  });
  assert.deepEqual({ customerAccountId: payload.formData.customerAccountId, customerContactId: payload.formData.customerContactId, customerAddress: payload.formData.customerAddress, customerContactName: payload.formData.customerContactName, customerContactEmail: payload.formData.customerContactEmail }, {
    customerAccountId: "", customerContactId: "", customerAddress: "12 Service Road", customerContactName: "Casey", customerContactEmail: "casey@example.test",
  });
  const restored = formValuesFromWorkorderDraft(payload, { parts: [] });
  assert.equal(restored.customerAddress, "12 Service Road");
  assert.equal(restored.customerContactName, "Casey");
  assert.equal(restored.customerContactEmail, "casey@example.test");
  assert.equal(isMeaningfulWorkorderDraft(payload), true);
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

  assert.deepEqual(payload.inventoryUnitSelections, [
    { partIndex: 0, catalogPartId: "11111111-1111-4111-8111-111111111111", unitIds: ["22222222-2222-4222-8222-222222222222"] },
    { partIndex: 1, catalogPartId: "11111111-1111-4111-8111-111111111111", unitIds: ["33333333-3333-4333-8333-333333333333"] },
  ]);
  assert.deepEqual(payload.formData.parts.map((part) => ({ qty: part.qty, serials: part.serializedSerialNumbers })), [
    { qty: "1", serials: ["SER-1"] },
    { qty: "1", serials: ["SER-2"] },
  ]);
  assert.ok(payload.formData.parts.every((part) => part.serializationRequired === true));
  assert.equal(formValuesFromWorkorderDraft(payload, { parts: [] }).parts.length, 2);
});

test("create draft preserves aggregate pickup position and command selection", () => {
  const payload = buildWorkorderDraftPayload({
    actor: { companyIds: ["company-1"], locationIds: ["location-1"] },
    form: {
      locationId: "location-1",
      parts: [{
        catalogPartId: "11111111-1111-4111-8111-111111111111",
        partNo: "Filter",
        qty: "2",
        uomCode: "ea",
        repairOrder: "Replace filter",
        trackingMode: "quantity",
        sourcePositionId: "22222222-2222-4222-8222-222222222222",
        sourcePositionPath: "Aisle 1 / Shelf 2 / Bin 3",
      }],
    },
  });

  assert.deepEqual(payload.inventoryPositionSelections, [{
    partIndex: 0,
    catalogPartId: "11111111-1111-4111-8111-111111111111",
    positionId: "22222222-2222-4222-8222-222222222222",
  }]);
  assert.equal(payload.formData.parts[0].sourcePositionPath, "Aisle 1 / Shelf 2 / Bin 3");
  assert.equal(formValuesFromWorkorderDraft(payload, { parts: [] }).parts[0].sourcePositionId, "22222222-2222-4222-8222-222222222222");
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

test("office draft pricing follows normalized serialized part indexes and preserves explicit Workorder overrides", () => {
  const payload = buildWorkorderDraftPayload({
    actor: { role: "office", companyIds: ["company-1"], locationIds: ["location-1"] },
    form: {
      locationId: "location-1",
      laborPriceSelection: "internal_cost",
      laborCustomUnitPrice: "42.50",
      parts: [{
        catalogPartId: "11111111-1111-4111-8111-111111111111",
        partNo: "TIRE",
        qty: "2",
        uomCode: "ea",
        repairOrder: "Replace",
        serializationRequired: true,
        serializedUnitIds: ["22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333"],
        serializedSerialNumbers: ["SER-1", "SER-2"],
        priceSelection: "batch_cost",
        customUnitPrice: "125.75",
        unitPrice: "999.00",
      }],
    },
  });

  assert.deepEqual(payload.pricing, {
    parts: [
      { partIndex: 0, selection: "batch_cost", customUnitPrice: "125.75" },
      { partIndex: 1, selection: "batch_cost", customUnitPrice: "125.75" },
    ],
    labor: { selection: "internal_cost", customUnitPrice: "42.50" },
  });
  assert.equal(payload.formData.parts.length, 2);
  assert.ok(payload.formData.parts.every((part) => !Object.hasOwn(part, "priceSelection") && !Object.hasOwn(part, "unitPrice")));
  const restored = formValuesFromWorkorderDraft(payload, { parts: [] });
  assert.deepEqual(restored.parts.map((part) => part.priceSelection), ["batch_cost", "batch_cost"]);
  assert.deepEqual(restored.parts.map((part) => part.customUnitPrice), ["125.75", "125.75"]);
  assert.equal(restored.laborPriceSelection, "internal_cost");
  assert.equal(restored.laborCustomUnitPrice, "42.50");
});

test("mechanic create payload strips financial pricing preferences", () => {
  const payload = buildWorkorderDraftPayload({
    actor: { role: "mechanic", companyIds: ["company-1"], locationIds: ["location-1"] },
    form: {
      locationId: "location-1",
      laborPriceSelection: "selling_price",
      parts: [{ catalogPartId: "11111111-1111-4111-8111-111111111111", partNo: "FILTER", qty: "1", priceSelection: "selling_price" }],
    },
  });
  assert.equal(Object.hasOwn(payload, "pricing"), false);
  assert.equal(Object.hasOwn(payload.formData.parts[0], "priceSelection"), false);
});

test("manual, requested, and inventory parts without exact source stay unpriced", () => {
  const payload = buildWorkorderDraftPayload({
    actor: { role: "office", companyIds: ["company-1"], locationIds: ["location-1"] },
    form: {
      locationId: "location-1",
      parts: [
        { partNo: "MANUAL", qty: "1", priceSelection: "selling_price" },
        { catalogPartId: "11111111-1111-4111-8111-111111111111", partNo: "REQUEST", qty: "1", trackingMode: "quantity", sourcePositionId: "position-1", purchaseRequested: true, priceSelection: "batch_cost" },
        { catalogPartId: "22222222-2222-4222-8222-222222222222", partNo: "NO-SOURCE", qty: "1", trackingMode: "quantity", priceSelection: "batch_cost" },
      ],
    },
  });
  assert.equal(Object.hasOwn(payload, "pricing"), false);
});
