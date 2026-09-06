import { z } from "zod";
import { saveInventoryStockingPolicy } from "../../db/repositories/inventory-stocking-policy.repo.js";
import { InventoryError, inventoryNotFound } from "./inventory.errors.js";
import { updateInventoryStockRuleSchema } from "./inventory.schemas.js";

export async function updateInventoryStockRule(catalogPartId, input, requestContext, dependencies = {}) {
  if (!["office", "admin"].includes(requestContext.actor.role)) throw new InventoryError("Stock rules can only be changed by Office or Admin.", { code: "INVENTORY_STOCK_RULE_FORBIDDEN", statusCode: 403 });
  if (!z.string().uuid().safeParse(catalogPartId).success) throw inventoryNotFound();
  const parsed = updateInventoryStockRuleSchema.parse(input);
  const result = await (dependencies.save || saveInventoryStockingPolicy)({
    catalogPartId,
    actorId: requestContext.actor.id,
    companyIds: [...(requestContext.companyIds || [])],
    locationIds: [...(requestContext.locationIds || [])],
    isAdmin: requestContext.actor.role === "admin",
    ...parsed,
  });
  if (result.kind === "not_found") throw inventoryNotFound();
  if (result.kind === "stale") throw new InventoryError("This stock rule changed. Refresh before saving.", { code: "INVENTORY_STOCK_RULE_STALE", statusCode: 409 });
  return result;
}
