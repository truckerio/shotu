import test from "node:test";
import assert from "node:assert/strict";
import { templateRepositoryInternals } from "./template-definitions.repo.js";

test("publish repository rejects inspection assignment unit-type mismatches in both directions", () => {
  for (const [definitionType, assignmentType] of [["Truck", "Trailer"], ["Trailer", "Truck"]]) {
    assert.throws(
      () => templateRepositoryInternals.assertInspectionAssignmentMatchesDefinition({ familyKey:"inspection", applicabilityKey:assignmentType }, { assetType:definitionType }),
      (error) => error.code === "TEMPLATE_ASSIGNMENT_UNIT_MISMATCH" && error.statusCode === 400,
    );
  }
});
