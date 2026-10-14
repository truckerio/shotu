import { z } from "zod";
import { saveInventoryStockingPolicy } from "../../db/repositories/inventory-stocking-policy.repo.js";
import { InventoryError, inventoryNotFound } from "./inventory.errors.js";
import { updateInventoryStockRuleSchema } from "./inventory.schemas.js";
import { resolveInventoryLocationScope } from "./inventory-effective-scope.js";

export async function updateInventoryStockRule(catalogPartId, input, requestContext, dependencies = {}) {
  if (!z.string().uuid().safeParse(catalogPartId).success) throw inventoryNotFound();
  const parsed = updateInventoryStockRuleSchema.parse(input);
  const scope = await (dependencies.resolveLocationScope || resolveInventoryLocationScope)(requestContext, parsed.locationId, {
    code: "INVENTORY_STOCK_RULE_FORBIDDEN",
    message: "Stock rules can only be changed by Office or Admin.",
  });
  const result = await (dependencies.save || saveInventoryStockingPolicy)({
    catalogPartId,
    actorId: requestContext.actor.id,
    companyIds: scope.companyIds,
    locationIds: scope.locationIds,
    isAdmin: scope.isAdmin,
    ...parsed,
  });
  if (result.kind === "not_found") throw inventoryNotFound();
  if (result.kind === "stale") throw new InventoryError("This stock rule changed. Refresh before saving.", { code: "INVENTORY_STOCK_RULE_STALE", statusCode: 409 });
  return result;
}
