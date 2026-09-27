import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { permissionsForRole } from "../../auth/permissions.js";
import { readSellingPolicy, writeSellingPolicy } from "./inventory-selling-policy.service.js";

const companyId = randomUUID();
const assignedLocationId = randomUUID();
const otherLocationId = randomUUID();
const partId = randomUUID();
const context = {
  actor: { id: randomUUID(), role: "office" },
  permissions: permissionsForRole("office"),
  companyIds: new Set([companyId]),
  locationIds: new Set([assignedLocationId]),
};

test("Office can read another location's batches and selling policy without edit capabilities", async () => {
  let received;
  const result = await readSellingPolicy(partId, otherLocationId, context, {
    resolveReadLocationScope: async () => ({
      companyIds: [companyId], locationIds: [otherLocationId], isAdmin: false, canManageLocation: false,
    }),
    read: async (input) => {
      received = input;
      return { policy: null, writeVersion: 0, availableBatches: [{ locationId: otherLocationId }] };
    },
  });
  assert.deepEqual(received.locationIds, [otherLocationId]);
  assert.equal(result.availableBatches.length, 1);
  assert.deepEqual(result.capabilities, { canEdit: false, canEditBatchCost: false });
});

test("Office cannot write another location's selling policy even with price permission", async () => {
  await assert.rejects(writeSellingPolicy(partId, otherLocationId, {
    expectedVersion: 0,
    method: "markup_percent",
    value: "10",
    currency: null,
    reason: "Not authorized here",
    idempotencyKey: "other-location-policy",
  }, context, {
    resolveLocationScope: async () => {
      const error = new Error("Not found");
      error.code = "inventory_not_found";
      throw error;
    },
    append: async () => assert.fail("other-location write reached persistence"),
  }), (error) => error.code === "inventory_not_found");
});

test("company selling policy is readable by Office but writable only by Admin", async () => {
  const read = await readSellingPolicy(partId, null, context, {
    read: async () => ({ policy: null, writeVersion: 0, availableBatches: [] }),
  });
  assert.deepEqual(read.capabilities, { canEdit: false, canEditBatchCost: false });
  const input = {
    expectedVersion: 0,
    method: "markup_percent",
    value: "12",
    currency: null,
    reason: "Company markup",
    idempotencyKey: "company-policy-write",
  };
  await assert.rejects(
    () => writeSellingPolicy(partId, null, input, context, { append: async () => assert.fail("Office company policy write reached persistence") }),
    (error) => error.code === "INVENTORY_COMPANY_WRITE_FORBIDDEN" && error.statusCode === 403,
  );
  const adminContext = { ...context, actor: { ...context.actor, role: "admin" }, permissions: permissionsForRole("admin") };
  const saved = await writeSellingPolicy(partId, null, input, adminContext, {
    append: async () => ({ kind: "saved", policy: { version: 1 }, replayed: false }),
  });
  assert.equal(saved.policy.version, 1);
});
