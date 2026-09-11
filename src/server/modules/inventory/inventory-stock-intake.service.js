import { createAggregateStockIntakeSchema } from "./inventory.schemas.js";
import { postAggregateStockIntake } from "../../db/repositories/inventory-stock-intake.repo.js";
import { InventoryError, inventoryNotFound } from "./inventory.errors.js";
import { z } from "zod";

const fail = (code, message, statusCode = 409) => { throw new InventoryError(message, { code, statusCode }); };
const idSchema = z.string().uuid();

export async function createAggregateStockIntake(catalogPartId, locationId, rawInput, context, dependencies = {}) {
  catalogPartId = idSchema.parse(catalogPartId);
  locationId = idSchema.parse(locationId);
  const input = createAggregateStockIntakeSchema.parse(rawInput);
  if (!["office", "admin"].includes(context.actor.role)) fail("INVENTORY_CREATE_FORBIDDEN", "Only Office or Admin can add physical inventory.", 403);
  if (context.actor.role !== "admin" && !context.locationIds?.has(locationId)) throw inventoryNotFound();
  const result = await (dependencies.postIntake || postAggregateStockIntake)({ ...input, catalogPartId, locationId,
    actorId: context.actor.id, companyIds: [...context.companyIds], locationIds: [...context.locationIds], isAdmin: context.actor.role === "admin" });
  if (result.kind === "not_found") throw inventoryNotFound();
  if (result.kind === "idempotency_conflict") fail("INVENTORY_INTAKE_REPLAY_CONFLICT", "This intake request key was already used with different details.");
  if (result.kind === "tracking_policy") fail("INVENTORY_INTAKE_TRACKING_POLICY", "The saved tracking method changed. Refresh this part before adding stock.");
  if (result.kind === "uom_mismatch") fail("INVENTORY_INTAKE_UOM_MISMATCH", "Stock must be added in the part's canonical unit.");
  if (result.kind === "unsupported_uom") fail("INVENTORY_INTAKE_UOM_UNSUPPORTED", "This tracking method is not valid for the part's canonical unit.", 422);
  if (result.kind === "authority_conflict") fail("INVENTORY_AUTHORITY_CONFLICT", "Legacy provider inventory still has an active reservation. Inventory review is required.");
  if (result.kind === "authority_unmatched") fail("INVENTORY_AUTHORITY_IDENTITY_UNMATCHED", "Provider inventory identity does not match this catalog part. Inventory review is required.");
  return { receiptId: result.receiptId, quantity: result.quantity, trackingMode: input.trackingMode, uomCode: input.uomCode, replayed: result.kind === "replay" };
}
