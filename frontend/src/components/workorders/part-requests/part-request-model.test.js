import assert from "node:assert/strict";
import test from "node:test";
import {
  createEmptyPartDraft,
  createOfficeReviewState,
  officeQueueText,
  purchasingLocation,
  requestUomCode,
  vehicleInput,
} from "./part-request-model.js";

test("request units normalize through the shared catalog", () => {
  assert.equal(requestUomCode({ uomCode: "pcs" }), "pc");
  assert.equal(createEmptyPartDraft().uomCode, "pc");
});

test("office review defaults to matching available inventory", () => {
  const state = createOfficeReviewState({
    catalogPartId: "catalog-part-1",
    partNumber: "FILTER-1",
    manufacturer: "Fleet",
    description: "Filter",
    category: "filter",
    quantity: 3,
    uomCode: "pc",
    repairOrder: "Replace",
    fitmentStatus: "confirmed",
    fitmentNotes: "VIN checked",
    inventory: [
      { id: "wrong-unit", locationId: "yard", uomCode: "gal", quantityAvailable: 9 },
      { id: "stock", locationId: "yard", uomCode: "pc", quantityAvailable: 2 },
    ],
  });

  assert.equal(state.form.uomCode, "pc");
  assert.equal(state.form.catalogPartId, "catalog-part-1");
  assert.deepEqual(state.allocations, [{
    sourceType: "inventory",
    status: "reserved",
    quantity: 2,
    uomCode: "pc",
    inventoryItemId: "stock",
    locationId: "yard",
    vendor: "",
  }]);
});

test("office review falls back to an undecided allocation", () => {
  const state = createOfficeReviewState({
    partNumber: "",
    manufacturer: "",
    description: "Coolant",
    category: "fluid",
    quantity: 4,
    uomCode: "gal",
    repairOrder: "",
    fitmentStatus: "unknown",
    fitmentNotes: "",
    inventory: [],
  });

  assert.equal(state.allocations[0].sourceType, "unknown");
  assert.equal(state.allocations[0].quantity, 4);
  assert.equal(state.allocations[0].uomCode, "gal");
});

test("office review never auto-reserves inventory from another workorder location", () => {
  const state = createOfficeReviewState({
    partNumber: "LF9009",
    manufacturer: "Fleetguard",
    description: "Oil filter",
    category: "filter",
    quantity: 1,
    uomCode: "pc",
    repairOrder: "Replace filter",
    fitmentStatus: "confirmed",
    fitmentNotes: "",
    inventory: [{
      id: "remote-stock",
      locationId: "remote-yard",
      quantityAvailable: 4,
      uomCode: "pc",
    }],
  }, "workorder-yard");

  assert.equal(state.allocations[0].sourceType, "unknown");
  assert.equal(state.allocations[0].inventoryItemId, undefined);
});

test("office queue summary distinguishes review and mechanic clarification", () => {
  assert.equal(officeQueueText([]), "No pending part requests");
  assert.equal(officeQueueText([
    { approvalStatus: "submitted" },
    { approvalStatus: "submitted" },
    { approvalStatus: "needs_info" },
    { approvalStatus: "approved" },
  ]), "2 requests need review · 1 waiting for mechanic");
});

test("provider helper inputs retain the existing vehicle and purchasing defaults", () => {
  const detail = {
    workorder: {
      assetId: "asset-1",
      asset: { name: "T-10", vin: "VIN10", make: "Ford", year: 2024 },
      formData: { model: "F-150", engine: "V8", engineSerial: "E10" },
      location: { name: "Chino Yard" },
    },
  };

  assert.deepEqual(vehicleInput(detail), {
    assetId: "asset-1",
    unitNo: "T-10",
    vin: "VIN10",
    make: "Ford",
    model: "F-150",
    year: 2024,
    engine: "V8",
    engineSerial: "E10",
  });
  assert.deepEqual(purchasingLocation(detail), {
    country: "US",
    city: "Chino",
    region: "CA",
    timezone: "America/Los_Angeles",
  });
});
