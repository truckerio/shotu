import { createHash } from "node:crypto";
import {
  releaseOrReverseAggregateWorkorderUsage,
  reserveAggregateWorkorderUsage,
} from "../../db/repositories/inventory-aggregate-workorder-usage.repo.js";
import { InventoryError, inventoryNotFound } from "./inventory.errors.js";
import { z } from "zod";

const reserveSchema = z.object({
  catalogPartId: z.string().uuid(),
  quantity: z.coerce.number().positive().max(999999.999)
    .refine((value) => Number.isInteger(value * 1000), "Quantity supports at most three decimals."),
  uomCode: z.string().trim().min(1).max(32),
  repairOrder: z.string().trim().max(2000).default(""),
  idempotencyKey: z.string().trim().min(8).max(160),
}).strict();

const lifecycleSchema = z.object({
  usageId: z.string().uuid(),
  action: z.enum(["release", "reverse", "adjust"]),
  targetQuantity: z.coerce.number().positive().max(999999.999)
    .refine((value) => Number.isInteger(value * 1000), "Quantity supports at most three decimals.").optional(),
  reason: z.string().trim().min(2).max(500),
  idempotencyKey: z.string().trim().min(8).max(160),
}).strict();

function scope(context) {
  return {
    companyIds: [...context.companyIds],
    locationIds: [...context.locationIds],
    isAdmin: context.actor.role === "admin",
    actorId: context.actor.id,
  };
}

function hash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function fail(code, message, statusCode = 409) {
  throw new InventoryError(message, { code, statusCode });
}

export async function reserveMeasuredUsageForWorkorder(workorderId, input, context, dependencies = {}) {
  const { operation: _operation, ...payload } = input;
  input = reserveSchema.parse(payload);
  const command = {
    workorderId,
    catalogPartId: input.catalogPartId,
    quantity: Number(input.quantity),
    uomCode: input.uomCode,
    repairOrder: input.repairOrder || "",
    idempotencyKey: input.idempotencyKey,
    ...scope(context),
  };
  const result = await (dependencies.reserveAggregateUsage || reserveAggregateWorkorderUsage)({
    ...command,
    requestHash: hash(command),
  });
  if (result.kind === "not_found") throw inventoryNotFound();
  if (result.kind === "inactive_workorder") fail("AGGREGATE_USAGE_WORKORDER_INACTIVE", "Measured inventory can be reserved only for active accepted work.");
  if (result.kind === "unsupported_uom") fail("AGGREGATE_USAGE_UOM_UNSUPPORTED", "Only liquid volume, mass, gas volume, or length inventory can use aggregate workorder usage.");
  if (result.kind === "insufficient_stock") fail("AGGREGATE_USAGE_INSUFFICIENT_STOCK", "Not enough unreserved measured inventory is available at this workorder location.");
  if (result.kind === "idempotency_conflict") fail("AGGREGATE_USAGE_REPLAY_CONFLICT", "That measured-usage request key was already used with different details.");
  return { usage: result.usage, replayed: result.kind === "replay" };
}

export async function releaseOrReverseMeasuredUsageForWorkorder(workorderId, input, context, dependencies = {}) {
  const { operation: _operation, ...payload } = input;
  input = lifecycleSchema.parse(payload);
  if (["reverse", "adjust"].includes(input.action) && !["office", "admin"].includes(context.actor.role)) {
    fail("AGGREGATE_USAGE_REVERSAL_FORBIDDEN", "Only Office or Admin may adjust approved measured usage.", 403);
  }
  if (input.action === "adjust" && input.targetQuantity === undefined) {
    fail("AGGREGATE_USAGE_ADJUSTMENT_QUANTITY_REQUIRED", "An adjusted target quantity is required.", 400);
  }
  const command = {
    workorderId,
    usageId: input.usageId,
    action: input.action,
    targetQuantity: input.targetQuantity,
    reason: input.reason,
    idempotencyKey: input.idempotencyKey,
    ...scope(context),
  };
  const result = await (dependencies.releaseAggregateUsage || releaseOrReverseAggregateWorkorderUsage)({
    ...command,
    requestHash: hash(command),
  });
  if (result.kind === "not_found") throw inventoryNotFound();
  if (result.kind === "idempotency_conflict") fail("AGGREGATE_USAGE_REPLAY_CONFLICT", "That measured-usage request key was already used with different details.");
  if (result.kind === "insufficient_stock") fail("AGGREGATE_USAGE_INSUFFICIENT_STOCK", "The adjustment would make measured inventory negative.");
  if (result.kind === "terminal") fail("AGGREGATE_USAGE_TERMINAL", "This measured-usage evidence is already released or reversed.");
  return { status: result.kind, replayed: result.kind === "replay" };
}
