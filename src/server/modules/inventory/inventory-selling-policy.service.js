import { createHash } from "node:crypto";
import { z } from "zod";
import {
  appendInventorySellingPolicy,
  getInventorySellingPolicy,
} from "../../db/repositories/inventory-selling-policies.repo.js";
import { requirePermission } from "../../auth/authorize.js";
import { PERMISSION } from "../../auth/permissions.js";
import { InventoryError, inventoryNotFound } from "./inventory.errors.js";
import { isSupportedInventoryCurrency } from "./inventory-pricing.js";
import { canManageInventoryCompanyScope, inventoryCompanyManageScope, inventoryCompanyReadScope, resolveInventoryLocationScope, resolveInventoryReadLocationScope } from "./inventory-effective-scope.js";

const id = z.string().uuid();
const inputSchema = z.object({
  expectedVersion: z.number().int().min(0),
  method: z.enum(["fixed", "markup_percent", "markup_amount"]),
  value: z.string().trim().regex(/^\d{1,10}(?:\.\d{1,4})?$/),
  currency: z.string().trim().toUpperCase().length(3).nullable(),
  reason: z.string().trim().min(2).max(500),
  idempotencyKey: z.string().trim().min(8).max(120),
}).strict().superRefine((value, context) => {
  const needsCurrency = value.method !== "markup_percent";
  if (needsCurrency && !value.currency) {
    context.addIssue({ code: "custom", path: ["currency"], message: "Currency is required for this selling method." });
  }
  if (!needsCurrency && value.currency) {
    context.addIssue({ code: "custom", path: ["currency"], message: "Percent markup uses the receipt batch currency." });
  }
  if (value.currency && !isSupportedInventoryCurrency(value.currency)) {
    context.addIssue({ code: "custom", path: ["currency"], message: "Select a supported ISO currency." });
  }
});

function fail(code, message, statusCode = 409) {
  throw new InventoryError(message, { code, statusCode });
}

async function effectiveScope(context, locationId, dependencies) {
  return locationId
    ? (dependencies.resolveLocationScope || resolveInventoryLocationScope)(context, locationId)
    : (dependencies.companyManageScope || inventoryCompanyManageScope)(context);
}

async function effectiveReadScope(context, locationId, dependencies) {
  return locationId
    ? (dependencies.resolveReadLocationScope || resolveInventoryReadLocationScope)(context, locationId)
    : inventoryCompanyReadScope(context);
}

export async function readSellingPolicy(catalogPartId, locationId, context, dependencies = {}) {
  requirePermission(context, PERMISSION.INVENTORY_COST_READ);
  const parsedPartId = id.parse(catalogPartId);
  const parsedLocationId = locationId ? id.parse(locationId) : null;
  const resolved = await effectiveReadScope(context, parsedLocationId, dependencies);
  const result = await (dependencies.read || getInventorySellingPolicy)({
    catalogPartId: parsedPartId,
    locationId: parsedLocationId,
    ...resolved,
  });
  if (!result) throw inventoryNotFound();
  return {
    policy: result.policy,
    writeVersion: result.writeVersion,
    availableBatches: result.availableBatches || [],
    capabilities: {
      canEdit: context.permissions?.has(PERMISSION.INVENTORY_PRICE_WRITE) === true
        && (parsedLocationId ? resolved.canManageLocation !== false : canManageInventoryCompanyScope(context, resolved.companyIds)),
      canEditBatchCost: context.permissions?.has(PERMISSION.INVENTORY_PRICE_WRITE) === true
        && (parsedLocationId ? resolved.canManageLocation !== false : canManageInventoryCompanyScope(context, resolved.companyIds)),
    },
  };
}

export async function writeSellingPolicy(catalogPartId, locationId, raw, context, dependencies = {}) {
  requirePermission(context, PERMISSION.INVENTORY_PRICE_WRITE);
  const parsedPartId = id.parse(catalogPartId);
  const parsedLocationId = locationId ? id.parse(locationId) : null;
  const input = inputSchema.parse(raw);
  const resolved = await effectiveScope(context, parsedLocationId, dependencies);
  const command = {
    catalogPartId: parsedPartId,
    locationId: parsedLocationId,
    expectedVersion: input.expectedVersion,
    method: input.method,
    value: input.value,
    currency: input.currency,
    reason: input.reason,
  };
  const result = await (dependencies.append || appendInventorySellingPolicy)({
    ...command,
    ...resolved,
    actorId: context.actor.id,
    idempotencyKey: input.idempotencyKey,
    requestHash: createHash("sha256").update(JSON.stringify(command)).digest("hex"),
  });
  if (result.kind === "not_found") throw inventoryNotFound();
  if (result.kind === "stale") {
    fail("INVENTORY_SELLING_POLICY_STALE", "Selling policy changed. Refresh before saving.");
  }
  if (result.kind === "idempotency_conflict") {
    fail("INVENTORY_SELLING_POLICY_REPLAY_CONFLICT", "This request key was used with different details.");
  }
  return { policy: result.policy, replayed: result.replayed };
}
