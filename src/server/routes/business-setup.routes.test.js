import test from "node:test";
import assert from "node:assert/strict";
import { handleBusinessSetupApi } from "./business-setup.routes.js";
const companyId = "00000000-0000-0000-0000-000000000001";
const body = { companyId, expectedVersion: 0, idempotencyKey: "key-1234", operatingMode: "fleet_only", shopIdentity: { legalName: "", address: "", phone: "", email: "" }, step: 1, status: "draft" };
test("accepts blank drafts and returns HTTP 400 for invalid input", async () => {
  let current = body, sent, writes = 0;
  const helpers = { readBody: async () => current, sendJson: (_res, status, result) => { sent = { status, result }; }, requestContext: {} };
  const run = () => handleBusinessSetupApi({ method: "PUT" }, {}, new URL("http://localhost/api/admin/business-setup"), helpers, { writeBusinessSetup: async (_ctx, input) => { writes++; return input; } });
  await run(); assert.equal(sent.status, 200); assert.equal(sent.result.status, "draft");
  for (const invalid of [null, { ...body, status: "completed" }, { ...body, completedAt: "forged" }, { ...body, billing: { ready: true } },
    { ...body, idempotencyKey: "short" }, { ...body, shopIdentity: { ...body.shopIdentity, email: "bad-email" } },
    { ...body, shopIdentity: { ...body.shopIdentity, legalName: "x".repeat(301) } },
    { ...body, shopIdentity: { ...body.shopIdentity, address: "x".repeat(1001) } }]) {
    current = invalid; sent = null; assert.equal(await run(), true); assert.equal(sent.status, 400); assert.equal(sent.result.code, "validation_error");
  }
  assert.equal(writes, 1);
});
test("returns HTTP 400 for malformed GET scope", async () => {
  let sent; const helpers = { sendJson: (_res, status, result) => { sent = { status, result }; }, requestContext: {} };
  assert.equal(await handleBusinessSetupApi({ method: "GET" }, {}, new URL("http://localhost/api/admin/business-setup?companyId=bad"), helpers), true);
  assert.equal(sent.status, 400); assert.equal(sent.result.code, "validation_error");
});
