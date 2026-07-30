import assert from "node:assert/strict";
import test from "node:test";
import { resolveProofreadingConfig } from "../modules/proofreading/proofreading.config.js";
import { proofreadingRequestSchema } from "../modules/proofreading/proofreading.schemas.js";

test("proofreading input is bounded and defaults to US English", () => {
  assert.deepEqual(proofreadingRequestSchema.parse({ text: "brke pad" }), {
    language: "en-US",
    text: "brke pad",
  });
  assert.throws(() => proofreadingRequestSchema.parse({ text: "ok" }));
  assert.throws(() => proofreadingRequestSchema.parse({ text: "x".repeat(5_001) }));
  assert.throws(() => proofreadingRequestSchema.parse({ text: "brke", extra: true }));
});

test("validation preserves whitespace so provider offsets still match the field", () => {
  assert.equal(proofreadingRequestSchema.parse({ text: "  brke pad" }).text, "  brke pad");
});

test("WProofreader credentials stay isolated in proofreading configuration", () => {
  assert.deepEqual(resolveProofreadingConfig({
    PROOFREADING_PROVIDER: "WProofreader",
    WPROOFREADER_SERVICE_ID: " service-id ",
  }), {
    provider: "wproofreader",
    timeoutMs: 3_000,
    wproofreaderServiceId: "service-id",
  });
});
