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

test("create validation summary targets the rendered controls", () => {
  const errors = validateCreateWorkorder({});
  const summary = createWorkorderSummaryErrors(errors);

  assert.deepEqual(
    Object.fromEntries(summary.map((error) => [error.key, error.id])),
    CREATE_WORKORDER_FIELD_IDS,
  );
});
