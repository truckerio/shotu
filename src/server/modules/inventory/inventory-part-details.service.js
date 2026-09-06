import { createCompanyCatalogPart, updateCompanyCatalogPart } from "../../db/repositories/parts-catalog-edit.repo.js";
import { findAuthorizedInventoryLocation } from "../../db/repositories/inventory-count-imports.repo.js";
import { InventoryError, inventoryNotFound } from "./inventory.errors.js";
import { createInventoryPartSchema, updateInventoryPartSchema } from "./inventory.schemas.js";
import { z } from "zod";

export async function createInventoryPart(input, requestContext, dependencies = {}) {
  if (!["office", "admin"].includes(requestContext.actor.role)) {
    throw new InventoryError("Parts can only be created by Office or Admin.", { code: "INVENTORY_PART_FORBIDDEN", statusCode: 403 });
  }
  const parsed = createInventoryPartSchema.parse(input);
  const location = await (dependencies.findLocation || findAuthorizedInventoryLocation)({
    locationId: parsed.locationId,
    companyIds: [...(requestContext.companyIds || [])],
    locationIds: [...(requestContext.locationIds || [])],
    isAdmin: requestContext.actor.role === "admin",
  });
  if (!location) throw inventoryNotFound();
  const result = await (dependencies.createPart || createCompanyCatalogPart)({
    ...parsed, companyId: location.company_id, actorId: requestContext.actor.id,
  });
  if (result.kind === "identity_conflict") throw new InventoryError("That part, barcode, or reference number is already used.", { code: "INVENTORY_PART_IDENTITY_CONFLICT", statusCode: 409 });
  if (result.kind === "uom_invalid") throw new InventoryError("Choose an active inventory unit.", { code: "INVENTORY_PART_UOM_INVALID", statusCode: 422 });
  return result.part;
}

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
  if (result.kind === "uom_locked") throw new InventoryError("Unit is locked after inventory activity.", { code: "INVENTORY_PART_UOM_LOCKED", statusCode: 422 });
  if (result.kind === "uom_incompatible") throw new InventoryError("Choose a unit with the same quantity value as the current inventory unit.", { code: "INVENTORY_PART_UOM_INCOMPATIBLE", statusCode: 422 });
  if (result.kind === "tracking_locked") throw new InventoryError("Tracking cannot be changed after inventory activity. Start a reviewed conversion instead.", { code: "INVENTORY_PART_TRACKING_LOCKED", statusCode: 422 });
  if (result.kind === "tracking_history_conflict") throw new InventoryError("This part already has serialized history. Keep it Serialized or start a reviewed conversion.", { code: "INVENTORY_PART_TRACKING_HISTORY_CONFLICT", statusCode: 422 });
  return result.part;
}
