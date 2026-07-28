import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCreateWorkorderSections,
  createSectionForErrors,
  isCreateErrorSectionReady,
} from "./create-workorder-sections.js";

test("create workorder phone sections follow the shared detail navigation shape", () => {
  assert.deepEqual(
    buildCreateWorkorderSections().map(({ id }) => id),
    ["work", "unit", "assignment", "parts", "preview"],
  );
  assert.deepEqual(
    buildCreateWorkorderSections({ canAssign: false }).map(({ id }) => id),
    ["work", "unit", "parts", "preview"],
  );
});

test("create validation waits until the invalid phone section is active", () => {
  const errors = { unitNo: "Required" };
  assert.equal(isCreateErrorSectionReady({ activeSection: "work", errors }), false);
  assert.equal(isCreateErrorSectionReady({ activeSection: "unit", errors }), true);
  assert.equal(isCreateErrorSectionReady({ activeSection: "work", errors: {} }), true);
});

test("create validation selects the page containing the first relevant error group", () => {
  assert.equal(createSectionForErrors({ mechanicConcern: "Required", unitNo: "Required" }), "work");
  assert.equal(createSectionForErrors({ unitNo: "Required" }), "unit");
  assert.equal(createSectionForErrors({ parts: "Invalid quantity" }), "parts");
  assert.equal(createSectionForErrors({ mechanicUserIds: "Invalid mechanic" }), "assignment");
  assert.equal(createSectionForErrors({}), "");
});
