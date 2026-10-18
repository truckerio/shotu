import assert from "node:assert/strict";
import test from "node:test";
import {
  createMechanicPartRequestDraft,
  clearCompanyCatalogSelection,
  mechanicPartsActionState,
  mechanicPartRequestErrorFields,
  mechanicPartRequestErrorMessage,
  workorderPartErrorMessage,
  validateMechanicPartRequest,
  withManufacturerPartNumber,
} from "./mechanic-part-request-model.js";

test("mechanic part request starts with one piece", () => {
  assert.deepEqual(createMechanicPartRequestDraft(), {
    query: "",
    catalogPartId: "",
    partNumber: "",
    quantity: "1",
    uomCode: "pc",
  });
});

test("maps direct workorder part conflicts to actionable messages", () => {
  assert.equal(workorderPartErrorMessage({ code: "WORKORDER_MECHANIC_ASSIGNMENT_REQUIRED" }),
    "You are not assigned to this workorder. Accept or join it before adding or requesting parts.");
  assert.equal(workorderPartErrorMessage({ code: "PART_CATALOG_UOM_MISMATCH" }),
    "The unit does not match the selected inventory part. Select the catalog part again.");
});

test("explains that a mechanic assignment is required before requesting a part", () => {
  assert.equal(mechanicPartRequestErrorMessage({
    code: "WORKORDER_MECHANIC_ASSIGNMENT_REQUIRED",
  }), "You are not assigned to this workorder. Accept or join it before adding or requesting parts.");
});

test("preserves explicitly selected company catalog identity", () => {
  assert.deepEqual(validateMechanicPartRequest({
    query: "Oil filter",
    catalogPartId: "5ecb7756-fdb4-4f46-8de7-c0fb92812e42",
    partNumber: "LF14000NN",
    quantity: "1",
    uomCode: "pc",
  }).payload, {
    catalogPartId: "5ecb7756-fdb4-4f46-8de7-c0fb92812e42",
    query: "Oil filter",
    description: "Oil filter",
    partNumber: "LF14000NN",
    quantity: 1,
    uomCode: "pc",
  });
});

test("keeps an exact external number on the existing unlinked request route", () => {
  assert.deepEqual(validateMechanicPartRequest({
    query: "Coolant hose",
    partNumber: "  A06-12345-000  ",
    catalogPartId: "",
    quantity: "1",
    uomCode: "pc",
  }).payload, {
    query: "Coolant hose",
    description: "Coolant hose",
    partNumber: "A06-12345-000",
    quantity: 1,
    uomCode: "pc",
  });
});

test("editing a manufacturer number removes a conflicting company selection", () => {
  const draft = withManufacturerPartNumber({
    query: "Coolant hose", catalogPartId: "company-part", partNumber: "COMPANY-1", quantity: "2", uomCode: "pc",
  }, "A06-12345-000");
  assert.equal(draft.catalogPartId, "");
  assert.equal(draft.partNumber, "A06-12345-000");
  assert.equal(draft.query, "Coolant hose");
  assert.equal(draft.uomCode, "pc");
  assert.equal(validateMechanicPartRequest(draft).payload.catalogPartId, undefined);
});

test("company search edits preserve a manual number but invalidate a selected company's number", () => {
  const manual = clearCompanyCatalogSelection({
    query: "Coolant hose", catalogPartId: "", partNumber: "A06-12345-000", quantity: "1", uomCode: "pc",
  });
  assert.equal(manual.partNumber, "A06-12345-000");
  assert.equal(validateMechanicPartRequest(manual).payload.partNumber, "A06-12345-000");
  const selected = clearCompanyCatalogSelection({ ...manual, catalogPartId: "company-part", partNumber: "COMPANY-1" });
  assert.equal(selected.catalogPartId, "");
  assert.equal(selected.partNumber, "");
});

test("offers both mechanic part workflows only when the server permits them", () => {
  assert.deepEqual(mechanicPartsActionState({ requestParts: true, recordUsedParts: true }), {
    canRecordUsedPart: true,
    canRequestPart: true,
    available: ["used", "request"],
  });
  assert.deepEqual(mechanicPartsActionState({ requestParts: true, recordUsedParts: false }), {
    canRecordUsedPart: false,
    canRequestPart: true,
    available: ["request"],
  });
  assert.deepEqual(mechanicPartsActionState({ requestParts: false, recordUsedParts: false }), {
    canRecordUsedPart: false,
    canRequestPart: false,
    available: [],
  });
});

test("validates description and quantity against the shared unit catalog", () => {
  assert.deepEqual(validateMechanicPartRequest({ query: "x", quantity: "0", uomCode: "pc" }).errors, {
    query: "Describe the part using at least 2 characters.",
    quantity: "Enter a quantity greater than 0.",
  });
  assert.equal(
    validateMechanicPartRequest({ query: "Brake pads", quantity: "1.5", uomCode: "pc" }).errors.quantity,
    "Use a whole number for this unit.",
  );
  assert.equal(
    validateMechanicPartRequest({ query: "Brake fluid", quantity: "1.5", uomCode: "qt" }).payload.quantity,
    1.5,
  );
});

test("builds the existing mechanic endpoint payload without actor identity", () => {
  assert.deepEqual(validateMechanicPartRequest({
    query: "  Front brake pads  ",
    quantity: "2",
    uomCode: "pc",
  }), {
    errors: {},
    payload: {
      query: "Front brake pads",
      description: "Front brake pads",
      quantity: 2,
      uomCode: "pc",
    },
  });
});

test("maps serialized API validation issues back to local fields", () => {
  const error = new Error(JSON.stringify([
    { path: ["query"], message: "String must contain at least 2 character(s)" },
    { path: ["quantity"], message: "Enter a valid quantity for the selected unit." },
  ]));

  assert.deepEqual(mechanicPartRequestErrorFields(error), {
    query: "String must contain at least 2 character(s)",
    quantity: "Enter a valid quantity for the selected unit.",
  });
});
