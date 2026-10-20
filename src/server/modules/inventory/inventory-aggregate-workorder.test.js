import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { effectiveInventoryScope } from "./inventory-effective-scope.js";
import {
  readMeasuredUsagePickupPositionsForWorkorder,
  releaseOrReverseMeasuredUsageForWorkorder,
  reserveMeasuredUsageForWorkorder,
} from "./inventory-aggregate-workorder.service.js";

const COMPANY_ID = "00000000-0000-4000-8000-000000000001";
const LOCATION_ID = "00000000-0000-4000-8000-000000000002";
const ACTOR_ID = "00000000-0000-4000-8000-000000000003";
const WORKORDER_ID = "00000000-0000-4000-8000-000000000004";
const USAGE_ID = "00000000-0000-4000-8000-000000000005";
const PART_ID = "00000000-0000-4000-8000-000000000006";
const POSITION_ID = "00000000-0000-4000-8000-000000000007";

function context(role = "mechanic") {
  return { actor: { id: ACTOR_ID, role }, companyIds: new Set([COMPANY_ID]), locationIds: new Set([LOCATION_ID]) };
}
const scopeDeps = { resolveResourceScope: (requestContext, _type, _id, options) => effectiveInventoryScope(requestContext, { companyId: COMPANY_ID, locationId: LOCATION_ID, ...options }) };

test("workorder pickup read returns only usable positions in server-owned company and location", async () => {
  let scope;
  const result = await readMeasuredUsagePickupPositionsForWorkorder(WORKORDER_ID, {
    operation: "aggregateUsagePositions", catalogPartId: PART_ID,
  }, context(), {
    authorize: async (_context, _id, request) => {
      assert.deepEqual(request, { moduleKey: "parts", capability: "write", action: "record" });
      return { workorder: { id: WORKORDER_ID, companyId: COMPANY_ID, locationId: LOCATION_ID,
        status: "in_progress", mechanicIds: [ACTOR_ID] } };
    },
    getPartPositions: async (input) => {
      scope = input;
      return { trackingMode: "quantity", uomCode: "ea", units: [{ serialNumber: "private" }], positions: [
        { id: POSITION_ID, path: "Bay / Shelf", isActive: true, canStore: true, isPickable: true, available: 3, version: 7, cost: 10 },
        { id: "empty", path: "Empty", isActive: true, canStore: true, isPickable: true, available: 0 },
        { id: "blocked", path: "Blocked", isActive: false, canStore: true, isPickable: true, available: 4 },
      ] };
    },
  });
  assert.deepEqual(scope, { partId: PART_ID, locationId: LOCATION_ID,
    companyIds: [COMPANY_ID], locationIds: [LOCATION_ID], isAdmin: false });
  assert.deepEqual(result, { positions: [{ id: POSITION_ID, path: "Bay / Shelf",
    isActive: true, canStore: true, isPickable: true, available: 3 }] });
});

test("workorder pickup read rejects policy, assignment, lifecycle, and company failures before inventory lookup", async () => {
  const baseWorkorder = { id: WORKORDER_ID, companyId: COMPANY_ID, locationId: LOCATION_ID,
    status: "in_progress", mechanicIds: [ACTOR_ID] };
  for (const [name, workorder, actorContext] of [
    ["unassigned", { ...baseWorkorder, mechanicIds: [] }, context()],
    ["completed", { ...baseWorkorder, status: "mechanic_done" }, context()],
    ["wrong company", { ...baseWorkorder, companyId: "00000000-0000-4000-8000-000000000009" }, context()],
    ["missing location", { ...baseWorkorder, locationId: null }, context()],
    ["stale company role", baseWorkorder, { ...context(), sessionMode: "standard" }],
  ]) {
    await assert.rejects(readMeasuredUsagePickupPositionsForWorkorder(WORKORDER_ID, {
      catalogPartId: PART_ID,
    }, actorContext, {
      authorize: async () => ({ workorder }),
      getPartPositions: async () => assert.fail(`${name} reached inventory lookup`),
    }));
  }
  await assert.rejects(readMeasuredUsagePickupPositionsForWorkorder(WORKORDER_ID, {
    catalogPartId: PART_ID,
  }, context(), {
    authorize: async () => { throw Object.assign(new Error("Parts Edit denied"), { statusCode: 403 }); },
    getPartPositions: async () => assert.fail("policy denial reached inventory lookup"),
  }), (error) => error.statusCode === 403);
});

test("workorder pickup read denies foreign parts and excludes non-quantity tracking", async () => {
  const dependencies = {
    authorize: async () => ({ workorder: { id: WORKORDER_ID, companyId: COMPANY_ID,
      locationId: LOCATION_ID, status: "accepted", mechanicIds: [ACTOR_ID] } }),
  };
  for (const state of [null, { trackingMode: "serialized", positions: [] }]) {
    await assert.rejects(readMeasuredUsagePickupPositionsForWorkorder(WORKORDER_ID, {
      catalogPartId: PART_ID,
    }, context(), { ...dependencies, getPartPositions: async () => state }),
    (error) => error.statusCode === 404);
  }
});

test("Office and Admin can read scoped pickup positions without mechanic assignment", async () => {
  for (const role of ["office", "admin"]) {
    let scope;
    await readMeasuredUsagePickupPositionsForWorkorder(WORKORDER_ID, { catalogPartId: PART_ID }, context(role), {
      authorize: async () => ({ workorder: { id: WORKORDER_ID, companyId: COMPANY_ID,
        locationId: LOCATION_ID, status: "open", mechanicIds: [] } }),
      getPartPositions: async (input) => { scope = input; return { trackingMode: "measured_bulk", positions: [] }; },
    });
    assert.deepEqual(scope.companyIds, [COMPANY_ID]);
    assert.deepEqual(scope.locationIds, [LOCATION_ID]);
    assert.equal(scope.isAdmin, role === "admin");
  }
});

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
    catalogPartId: PART_ID, sourcePositionId: POSITION_ID, quantity: "1.125", uomCode: "gal", repairOrder: "Top off coolant",
    idempotencyKey: "aggregate-reserve-1",
  }, context(), { ...scopeDeps, reserveAggregateUsage: async (input) => { command = input; return { kind: "reserved", usage: { id: USAGE_ID } }; } });
  assert.equal(result.replayed, false);
  assert.equal(command.workorderId, WORKORDER_ID);
  assert.equal(command.sourcePositionId, POSITION_ID);
  assert.deepEqual(command.companyIds, [COMPANY_ID]);
  assert.deepEqual(command.locationIds, [LOCATION_ID]);
  await reserveMeasuredUsageForWorkorder(WORKORDER_ID, {
    catalogPartId: PART_ID, sourcePositionId: POSITION_ID, quantity: "1.005", uomCode: "gal", repairOrder: "Tolerance check",
    idempotencyKey: "aggregate-reserve-1005",
  }, context(), { ...scopeDeps, reserveAggregateUsage: async () => ({ kind: "reserved", usage: { id: USAGE_ID } }) });
  await assert.rejects(
    reserveMeasuredUsageForWorkorder(WORKORDER_ID, {
      catalogPartId: PART_ID, sourcePositionId: POSITION_ID, quantity: "1.0009", uomCode: "gal", unexpected: true,
      idempotencyKey: "aggregate-reserve-2",
    }, context(), { reserveAggregateUsage: async () => assert.fail("invalid input reached repository") }),
  );
});

test("reserve explains when the selected pickup position has unresolved batch lineage", async () => {
  await assert.rejects(
    reserveMeasuredUsageForWorkorder(WORKORDER_ID, {
      catalogPartId: PART_ID, sourcePositionId: POSITION_ID, quantity: "1", uomCode: "ea", repairOrder: "Install part",
      idempotencyKey: "aggregate-batch-placement-gap",
    }, context(), { ...scopeDeps, reserveAggregateUsage: async () => ({ kind: "batch_reconciliation_required" }) }),
    (error) => error.code === "INVENTORY_BATCH_PLACEMENT_RECONCILIATION_REQUIRED" && error.statusCode === 409,
  );
});

test("mechanic cannot disguise an approved reversal as release", async () => {
  let called = false;
  await assert.rejects(
    releaseOrReverseMeasuredUsageForWorkorder(WORKORDER_ID, {
      usageId: USAGE_ID, action: "reverse", reason: "Incorrect approved amount",
      idempotencyKey: "aggregate-reverse-1",
    }, context("mechanic"), { ...scopeDeps, releaseAggregateUsage: async () => { called = true; } }),
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
  }, context("office"), { ...scopeDeps, releaseAggregateUsage: async (input) => { command = input; return { kind: "adjusted" }; } });
  assert.equal(command.workorderId, WORKORDER_ID);
  assert.equal(command.targetQuantity, 0.875);
});

test("quantity install uses the guarded aggregate lifecycle and maps physical-state failures", async () => {
  let command;
  const result = await releaseOrReverseMeasuredUsageForWorkorder(WORKORDER_ID, {
    operation: "aggregateUsageLifecycle",
    usageId: USAGE_ID, action: "install", reason: "Marked installed in Workorder",
    idempotencyKey: "aggregate-install-1",
  }, context(), { ...scopeDeps, releaseAggregateUsage: async (input) => {
    command = input;
    return { kind: "installed_pending_approval" };
  } });
  assert.equal(result.status, "installed_pending_approval");
  assert.equal(command.workorderId, WORKORDER_ID);
  assert.equal(command.action, "install");
  assert.equal(command.reason, "Marked installed in Workorder");

  for (const [kind, code] of [
    ["unsupported_tracking", "AGGREGATE_USAGE_INSTALL_UNSUPPORTED"],
    ["physical_return_required", "AGGREGATE_USAGE_PHYSICAL_RETURN_REQUIRED"],
  ]) {
    await assert.rejects(
      releaseOrReverseMeasuredUsageForWorkorder(WORKORDER_ID, {
        usageId: USAGE_ID, action: kind === "unsupported_tracking" ? "install" : "release",
        reason: "Lifecycle guard", idempotencyKey: `aggregate-${kind}`,
      }, context(), { ...scopeDeps, releaseAggregateUsage: async () => ({ kind }) }),
      (error) => error.code === code && error.statusCode === 409,
    );
  }
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
    }, context("office"), { ...scopeDeps, releaseAggregateUsage: async () => ({ kind: "insufficient_stock" }) }),
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
  assert.match(source, /Math\.max\(1, Math\.min\(Number\(limit\) \|\| 200, 201\)\)/);
  const listProjection = source.slice(source.indexOf("export async function listAggregateWorkorderUsages"), source.indexOf("function publicUsage"));
  assert.match(listProjection, /usage\.tracking_mode/);
  assert.match(listProjection, /trackingMode: row\.tracking_mode/);
  assert.match(listProjection, /receiptReference/);
  assert.doesNotMatch(listProjection, /external_id|invoiceRunId/);
  assert.match(source, /catalog\.tracking_mode/);
  assert.match(source, /QUANTITY_CATEGORIES/);
  assert.match(source, /Number\.isInteger\(input\.quantity\)/);
  assert.match(source, /supportsLegacyMeasured/);
  assert.match(source, /input\.action === "install" && usage\.tracking_mode !== "quantity"/);
  assert.match(source, /pickAggregateInventoryPositions[\s\S]*pickAggregateCostLayers/);
  assert.match(source, /tracking_mode='measured_bulk' or tracking_mode is null/);
});

test("workorder completion and cancellation guard quantity physical state", async () => {
  const source = await readFile(new URL("../../db/repositories/operational-workorders.repo.js", import.meta.url), "utf8");
  assert.match(source, /WORKORDER_QUANTITY_PARTS_PENDING/);
  assert.match(source, /\["reserved"\][\s\S]*Mark every quantity-tracked part installed/);
  assert.match(source, /WORKORDER_INSTALLED_QUANTITY_PARTS_PENDING/);
  assert.match(source, /\["installed_pending_approval"\][\s\S]*physical removal or return/);
});

test("quantity aggregate persistence stores policy and enforces whole-number adjustments", async () => {
  const sql = await readFile(new URL("../../db/migrations/130_inventory_manual_stock_intake.sql", import.meta.url), "utf8");
  assert.match(sql, /workorder_aggregate_usage_quantity_scale_check/i);
  assert.match(sql, /quantity=trunc\(quantity\)/i);
  await assert.rejects(
    releaseOrReverseMeasuredUsageForWorkorder(WORKORDER_ID, {
      usageId: USAGE_ID, action: "adjust", targetQuantity: 1.5, reason: "Count correction",
      idempotencyKey: "aggregate-count-adjust",
    }, context("office"), { ...scopeDeps, releaseAggregateUsage: async () => ({ kind: "unsupported_uom" }) }),
    (error) => error.code === "AGGREGATE_USAGE_UOM_UNSUPPORTED",
  );
});
