import assert from "node:assert/strict";
import test from "node:test";
import {
  CREATE_WORKORDER_FIELD_IDS,
  createWorkorderSummaryErrors,
  validateCreateWorkorder,
} from "./create-workorder-validation.js";

test("create validation reports every required workorder field", () => {
  assert.deepEqual(Object.keys(validateCreateWorkorder({})), [
    "locationId",
    "unitNo",
    "customerCompanyName",
    "mechanicConcern",
  ]);
});

test("create validation accepts trimmed required values", () => {
  assert.deepEqual(validateCreateWorkorder({
    locationId: "location-1",
    unitNo: " G2021 ",
    customerCompanyName: " Long Haul ",
    mechanicConcern: " Inspect brakes ",
  }), {});
});

test("create validation rejects invalid part quantities and accepts measured units", () => {
  const required = {
    locationId: "location-1",
    unitNo: "G2021",
    customerCompanyName: "Long Haul",
    mechanicConcern: "Inspect brakes",
  };
  assert.match(validateCreateWorkorder({
    ...required,
    parts: [{ partNo: "FILTER", qty: "1.5", uomCode: "ea" }],
  }).parts, /valid quantity and unit/i);
  assert.equal(validateCreateWorkorder({
    ...required,
    parts: [{ partNo: "OIL", qty: "1.5", uomCode: "gal" }],
  }).parts, undefined);
});

test("create validation summary targets the rendered controls", () => {
  const errors = validateCreateWorkorder({});
  const summary = createWorkorderSummaryErrors(errors);

  assert.deepEqual(
    Object.fromEntries(summary.map((error) => [error.key, error.id])),
    Object.fromEntries(Object.keys(errors).map((key) => [key, CREATE_WORKORDER_FIELD_IDS[key]])),
  );
});
