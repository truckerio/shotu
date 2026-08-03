import assert from "node:assert/strict";
import test from "node:test";
import {
  createMechanicPartRequestDraft,
  mechanicPartsActionState,
  mechanicPartRequestErrorFields,
  validateMechanicPartRequest,
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
