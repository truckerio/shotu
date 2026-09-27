import { createHash } from "node:crypto";
import { z } from "zod";
import { appendInventoryBatchCostRevision } from "../../db/repositories/inventory-batch-costs.repo.js";
import { requirePermission } from "../../auth/authorize.js";
import { PERMISSION } from "../../auth/permissions.js";
import { InventoryError, inventoryNotFound } from "./inventory.errors.js";
import { isSupportedInventoryCurrency } from "./inventory-pricing.js";

const id = z.string().uuid();
const inputSchema = z.object({
  expectedVersion: z.number().int().min(0),
  unitCost: z.string().trim().regex(/^\d{1,10}(?:\.\d{1,4})?$/),
  currency: z.string().trim().toUpperCase().length(3),
  reason: z.string().trim().min(2).max(500),
  idempotencyKey: z.string().trim().min(8).max(120),
}).strict().superRefine((value, context) => {
  if (!isSupportedInventoryCurrency(value.currency)) {
    context.addIssue({ code: "custom", path: ["currency"], message: "Select a supported ISO currency." });
  }
});

function fail(code, message, statusCode = 409) {
  throw new InventoryError(message, { code, statusCode });
}

export async function correctInventoryBatchCost(costLayerId, raw, context, dependencies = {}) {
  requirePermission(context, PERMISSION.INVENTORY_PRICE_WRITE);
  const parsedId = id.parse(costLayerId);
  const input = inputSchema.parse(raw);
  const command = {
    costLayerId: parsedId,
    expectedVersion: input.expectedVersion,
    unitCost: input.unitCost,
    currency: input.currency,
    reason: input.reason,
  };
  const result = await (dependencies.append || appendInventoryBatchCostRevision)({
    ...command,
    companyIds: [...(context.companyIds || [])],
    locationIds: [...(context.locationIds || [])],
    isAdmin: context.actor.role === "admin",
    actorId: context.actor.id,
    idempotencyKey: input.idempotencyKey,
    requestHash: createHash("sha256").update(JSON.stringify(command)).digest("hex"),
  });
  if (result.kind === "not_found") throw inventoryNotFound();
  if (result.kind === "stale") fail("INVENTORY_BATCH_COST_STALE", "Batch cost changed. Refresh before saving.");
  if (result.kind === "idempotency_conflict") fail("INVENTORY_BATCH_COST_REPLAY_CONFLICT", "This request key was used with different details.");
  return { revision: result.revision, replayed: result.replayed };
}
