import test from "node:test";
import assert from "node:assert/strict";
import {
  createCustomerRepairLink,
  readCustomerRepairPortal,
  respondToCustomerRepairEstimate,
  repairCustomerStatus,
} from "./customer-repair-portal.service.js";
const companyId = "10000000-0000-4000-8000-000000000001";
const locationId = "20000000-0000-4000-8000-000000000001";
const workorderId = "30000000-0000-4000-8000-000000000001";
const revisionId = "40000000-0000-4000-8000-000000000001";
const token = "a".repeat(43);
test("repair portal uses customer-safe status descriptions", () => {
  assert.equal(repairCustomerStatus("parts_requested"), "Waiting for parts");
  assert.equal(repairCustomerStatus("odoo_entered"), "Complete");
  assert.equal(repairCustomerStatus("unknown_internal_state"), "In progress");
});
test("invalid repair capability never reaches repository", async () => {
  await assert.rejects(
    readCustomerRepairPortal(
      "invalid",
      {},
      { read: () => assert.fail("called") },
    ),
    (e) => e.statusCode === 404,
  );
});
test("repair response binds exact displayed revision without accepting scope/capability injection", async () => {
  let captured;
  await respondToCustomerRepairEstimate(
    token,
    {
      revisionId,
      response: "accepted",
      customerName: "Customer",
      idempotencyKey: "response-001",
    },
    { respond: async (c) => ((captured = c), { ok: true }) },
  );
  assert.equal(captured.revisionId, revisionId);
  assert.equal(captured.rawToken, token);
  await assert.rejects(
    respondToCustomerRepairEstimate(token, {
      revisionId,
      response: "accepted",
      customerName: "Customer",
      idempotencyKey: "response-001",
      workorderId,
    }),
  );
});
test("repair grant denies unauthenticated creation before repository", async () => {
  await assert.rejects(
    createCustomerRepairLink(
      { actor: null },
      workorderId,
      {
        companyId,
        locationId,
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        idempotencyKey: "repair-create-001",
      },
      { create: () => assert.fail("called") },
    ),
  );
});
