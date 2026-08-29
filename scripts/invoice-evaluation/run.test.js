import assert from "node:assert/strict";
import test from "node:test";
import { runInvoiceEvaluation } from "./run.js";

test("CLI requires sealed inputs before it can evaluate", async () => {
  await assert.rejects(runInvoiceEvaluation({}), /required/);
});
