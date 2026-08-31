import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  releaseOrReverseMeasuredUsageForWorkorder,
  reserveMeasuredUsageForWorkorder,
} from "./inventory-aggregate-workorder.service.js";

const COMPANY_ID = "00000000-0000-4000-8000-000000000001";
const LOCATION_ID = "00000000-0000-4000-8000-000000000002";
const ACTOR_ID = "00000000-0000-4000-8000-000000000003";
const WORKORDER_ID = "00000000-0000-4000-8000-000000000004";
const USAGE_ID = "00000000-0000-4000-8000-000000000005";
const PART_ID = "00000000-0000-4000-8000-000000000006";

function context(role = "mechanic") {
  return { actor: { id: ACTOR_ID, role }, companyIds: new Set([COMPANY_ID]), locationIds: new Set([LOCATION_ID]) };
}

test("aggregate migration uses repository auth owners and non-null actor idempotency", async () => {
  const sql = await readFile(new URL("../../db/migrations/093_workorder_aggregate_inventory_usage.sql", import.meta.url), "utf8");
  assert.doesNotMatch(sql, /references\s+users\s*\(/i);
  assert.equal((sql.match(/references user_profiles\(id\)/g) || []).length, 3);
  assert.match(sql, /created_by_user_id uuid not null references user_profiles/i);
  assert.match(sql, /quantity \+ adjustment_total >= 0/i);
});

test("reserve validates precision strictly and forwards tenant, location, and workorder scope", async () => {
  let command;
  const result = await reserveMeasuredUsageForWorkorder(WORKORDER_ID, {
    operation: "aggregateUsageReserve",
    catalogPartId: PART_ID, quantity: "1.125", uomCode: "gal", repairOrder: "Top off coolant",
    idempotencyKey: "aggregate-reserve-1",
  }, context(), { reserveAggregateUsage: async (input) => { command = input; return { kind: "reserved", usage: { id: USAGE_ID } }; } });
  assert.equal(result.replayed, false);
  assert.equal(command.workorderId, WORKORDER_ID);
  assert.deepEqual(command.companyIds, [COMPANY_ID]);
  assert.deepEqual(command.locationIds, [LOCATION_ID]);
  await assert.rejects(
    reserveMeasuredUsageForWorkorder(WORKORDER_ID, {
      catalogPartId: PART_ID, quantity: "1.0009", uomCode: "gal", unexpected: true,
      idempotencyKey: "aggregate-reserve-2",
    }, context(), { reserveAggregateUsage: async () => assert.fail("invalid input reached repository") }),
  );
});

test("mechanic cannot disguise an approved reversal as release", async () => {
  let called = false;
  await assert.rejects(
    releaseOrReverseMeasuredUsageForWorkorder(WORKORDER_ID, {
      usageId: USAGE_ID, action: "reverse", reason: "Incorrect approved amount",
      idempotencyKey: "aggregate-reverse-1",
    }, context("mechanic"), { releaseAggregateUsage: async () => { called = true; } }),
    (error) => error.code === "AGGREGATE_USAGE_REVERSAL_FORBIDDEN" && error.statusCode === 403,
  );
  assert.equal(called, false);
});

test("lifecycle command binds exact workorder and adjustment target", async () => {
  let command;
  await releaseOrReverseMeasuredUsageForWorkorder(WORKORDER_ID, {
    operation: "aggregateUsageLifecycle",
    usageId: USAGE_ID, action: "adjust", targetQuantity: "0.875", reason: "Verified actual amount",
    idempotencyKey: "aggregate-adjust-1",
  }, context("office"), { releaseAggregateUsage: async (input) => { command = input; return { kind: "adjusted" }; } });
  assert.equal(command.workorderId, WORKORDER_ID);
  assert.equal(command.targetQuantity, 0.875);
});

test("adjustment rejects zero target and maps negative-stock protection to 409", async () => {
  await assert.rejects(
    releaseOrReverseMeasuredUsageForWorkorder(WORKORDER_ID, {
      usageId: USAGE_ID, action: "adjust", targetQuantity: 0, reason: "Use full reversal",
      idempotencyKey: "aggregate-adjust-zero",
    }, context("office"), { releaseAggregateUsage: async () => assert.fail("zero target reached repository") }),
  );
  await assert.rejects(
    releaseOrReverseMeasuredUsageForWorkorder(WORKORDER_ID, {
      usageId: USAGE_ID, action: "adjust", targetQuantity: 99, reason: "Corrected quantity",
      idempotencyKey: "aggregate-adjust-stock",
    }, context("office"), { releaseAggregateUsage: async () => ({ kind: "insufficient_stock" }) }),
    (error) => error.code === "AGGREGATE_USAGE_INSUFFICIENT_STOCK" && error.statusCode === 409,
  );
});

test("repository contract locks workorder identity and keeps event/movement deltas aligned", async () => {
  const source = await readFile(new URL("../../db/repositories/inventory-aggregate-workorder-usage.repo.js", import.meta.url), "utf8");
  assert.match(source, /usage\.workorder_id=\$5/i);
  assert.match(source, /usage\.status === "consumed" && input\.action === "reverse"/);
  assert.match(source, /usage\.status === "consumed" && input\.action === "adjust"/);
  assert.match(source, /movementDelta = effectiveQuantity; eventDelta = movementDelta/);
  assert.match(source, /movementDelta = -consumptionDelta; eventDelta = movementDelta/);
  assert.match(source, /`aggregate-\$\{eventType\}:\$\{usage\.id\}/);
  assert.doesNotMatch(source, /`aggregate-reversal:\$\{usage\.id\}/);
  assert.match(source, /usage\.company_id=\$1 and usage\.workorder_id=\$2 and usage\.location_id=\$3/);
  assert.match(source, /Math\.max\(1, Math\.min\(Number\(limit\) \|\| 200, 200\)\)/);
  const listProjection = source.slice(source.indexOf("export async function listAggregateWorkorderUsages"), source.indexOf("function publicUsage"));
  assert.doesNotMatch(listProjection, /provider|external_id|receipt_id|invoice/i);
});
