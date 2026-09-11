import assert from "node:assert/strict";
import test from "node:test";

import { laborProductSchema } from "./workorder.schemas.js";

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
