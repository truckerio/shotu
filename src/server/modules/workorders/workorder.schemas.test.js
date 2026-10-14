import assert from "node:assert/strict";
import test from "node:test";

import { laborProductSchema, workorderFormDataSchema } from "./workorder.schemas.js";

test("labor product snapshots retain an optional repair-order description", () => {
  const result = laborProductSchema.parse({
    productId: "11111111-1111-4111-8111-111111111111",
    code: "DIAG",
    name: "Diagnostics",
    description: " Diagnose and verify repair. ",
  });
  assert.equal(result.description, "Diagnose and verify repair.");
  assert.throws(() => laborProductSchema.parse({
    name: "Diagnostics",
    description: "x".repeat(2001),
  }));
});

test("workorder form data accepts a current customer-document revision marker or an empty pre-issue marker", () => {
  const revisionId = "22222222-2222-4222-8222-222222222222";
  const incompleteIntent = {
    lineDiscounts: [],
    documentDiscount: { kind: "percentage", value: "", reason: "" },
    overrideReasons: [],
  };
  const saved = workorderFormDataSchema.parse({
    customerDocumentAdjustments: incompleteIntent,
    customerDocumentAdjustmentBaseRevisionId: revisionId,
  });

  assert.deepEqual(saved.customerDocumentAdjustments, incompleteIntent);
  assert.equal(saved.customerDocumentAdjustmentBaseRevisionId, revisionId);
  assert.equal(workorderFormDataSchema.parse({
    customerDocumentAdjustmentBaseRevisionId: "",
  }).customerDocumentAdjustmentBaseRevisionId, "");
  assert.throws(() => workorderFormDataSchema.parse({
    customerDocumentAdjustmentBaseRevisionId: "not-a-revision-id",
  }));
});
