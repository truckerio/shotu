import { createHash } from "node:crypto";
import { effectiveCompanyContext } from "../../auth/company-role.js";
import { requireWorkorderAccess } from "../../auth/resource-access.js";
import { saveWorkorderPartPriceSnapshot } from "../../db/repositories/workorder-part-pricing.repo.js";
import { InventoryError, inventoryNotFound } from "../inventory/inventory.errors.js";

function fail(code, message, statusCode = 409) {
  throw new InventoryError(message, { code, statusCode });
}

export async function selectWorkorderPartPrice(workorderId, input, context, dependencies = {}) {
  const workorder = dependencies.authorizedWorkorder
    || await (dependencies.requireAccess || requireWorkorderAccess)(context, workorderId);
  context = effectiveCompanyContext(context, workorder.companyId);
  if (!["office", "admin"].includes(context.actor.role)) {
    fail("WORKORDER_PART_PRICE_FORBIDDEN", "Only Office or Admin may select part prices.", 403);
  }
  const noStock = input.usageKind === "no_stock";
  if ((noStock && (!input.noStockLineId || input.usageId))
    || (!noStock && (!input.usageId || input.noStockLineId))) {
    fail("WORKORDER_PART_PRICE_IDENTITY_INVALID", "Choose one canonical Workorder part line to price.", 422);
  }
  if (noStock && input.selection !== "selling_price") {
    fail("WORKORDER_BATCH_COST_UNAVAILABLE", "No-stock items have no receipt batch cost. Use the configured selling price.", 422);
  }
  const command = {
    workorderId,
    usageKind: input.usageKind,
    ...(noStock ? { noStockLineId: input.noStockLineId } : { usageId: input.usageId }),
    selection: input.selection,
    reason: input.reason,
  };
  const result = await (dependencies.savePartPrice || saveWorkorderPartPriceSnapshot)({
    ...command,
    actorId: context.actor.id,
    companyIds: [...(context.companyIds || [])],
    locationIds: [...(context.locationIds || [])],
    isAdmin: context.actor.role === "admin",
    idempotencyKey: input.idempotencyKey,
    requestHash: createHash("sha256").update(JSON.stringify(command)).digest("hex"),
  });
  if (result.kind === "not_found") throw inventoryNotFound();
  if (result.kind === "locked") {
    fail("WORKORDER_PART_PRICE_LOCKED", "Part prices cannot change after the workorder is closed.");
  }
  if (result.kind === "batch_cost_unavailable") {
    fail(
      "WORKORDER_BATCH_COST_UNAVAILABLE",
      "Exact batch cost is unavailable for this part. No latest or average cost was substituted.",
      422,
    );
  }
  if (result.kind === "selling_policy_unavailable") {
    fail("WORKORDER_SELLING_POLICY_UNAVAILABLE", "Configure a selling policy for this part first.", 422);
  }
  if (result.kind === "currency_unavailable") {
    fail("WORKORDER_PART_PRICE_CURRENCY_UNAVAILABLE", "Price currency is unavailable.", 422);
  }
  if (result.kind === "idempotency_conflict") {
    fail("WORKORDER_PART_PRICE_REPLAY_CONFLICT", "This price request key was used with different details.");
  }
  return result;
}
