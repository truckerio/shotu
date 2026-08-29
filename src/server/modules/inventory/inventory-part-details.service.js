import { updateCompanyCatalogPart } from "../../db/repositories/parts-catalog-edit.repo.js";
import { InventoryError, inventoryNotFound } from "./inventory.errors.js";
import { updateInventoryPartSchema } from "./inventory.schemas.js";
import { z } from "zod";

export async function updateInventoryPart(catalogPartId, input, requestContext, dependencies = {}) {
  if (!["office", "admin"].includes(requestContext.actor.role)) {
    throw new InventoryError("Part details can only be changed by Office or Admin.", {
      code: "INVENTORY_PART_FORBIDDEN",
      statusCode: 403,
    });
  }
  if (!z.string().uuid().safeParse(catalogPartId).success) throw inventoryNotFound();
  const parsed = updateInventoryPartSchema.parse(input);
  const result = await (dependencies.updatePart || updateCompanyCatalogPart)({
    catalogPartId, actorId: requestContext.actor.id, companyIds: [...(requestContext.companyIds || [])], ...parsed,
  });
  if (result.kind === "not_found") throw inventoryNotFound();
  if (result.kind === "stale") throw new InventoryError("This part changed. Refresh it before saving.", { code: "INVENTORY_PART_STALE", statusCode: 409 });
  if (result.kind === "identity_conflict") throw new InventoryError("That part or reference number is already used by another part.", { code: "INVENTORY_PART_IDENTITY_CONFLICT", statusCode: 409 });
  if (result.kind === "provider_managed") throw new InventoryError("Odoo-managed part fields must be edited in Odoo.", { code: "INVENTORY_PART_FIELD_PROVIDER_MANAGED", statusCode: 422 });
  return result.part;
}
