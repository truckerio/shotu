import { z } from "zod";
import {
  createPartSerializedUnits,
  getPartLocationSerialization,
} from "../../db/repositories/inventory-part-serialization.repo.js";
import { getSerializedInventoryUnit } from "../../db/repositories/inventory-receipts.repo.js";
import { InventoryError, inventoryNotFound } from "./inventory.errors.js";
import { assertInventoryQrConfigured } from "./inventory-qr.js";
import { createPartSerializedUnitsSchema } from "./inventory.schemas.js";

const idSchema = z.string().uuid();

function publicError(code, message, statusCode = 422) {
  return new InventoryError(message, { code, statusCode });
}

function companyReadScope(requestContext) {
  return { companyIds: [...(requestContext.companyIds || [])] };
}

function locationWriteScope(requestContext) {
  return {
    companyIds: [...(requestContext.companyIds || [])],
    locationIds: [...(requestContext.locationIds || [])],
    isAdmin: requestContext.actor.role === "admin",
  };
}

export async function readPartLocationSerialization(catalogPartId, locationId, requestContext, dependencies = {}) {
  const partId = idSchema.parse(catalogPartId);
  const shopId = idSchema.parse(locationId);
  const result = await (dependencies.read || getPartLocationSerialization)({
    catalogPartId: partId,
    locationId: shopId,
    ...companyReadScope(requestContext),
  });
  if (!result) throw inventoryNotFound();
  return {
    ...result,
    canCreateAtLocation: requestContext.actor.role === "admin" || requestContext.locationIds?.has(shopId) === true,
  };
}

export async function readSerializedInventoryUnit(unitId, requestContext, dependencies = {}) {
  const id = idSchema.parse(unitId);
  const result = await (dependencies.readUnit || getSerializedInventoryUnit)({
    unitId: id,
    companyIds: [...(requestContext.companyIds || [])],
    locationIds: [...(requestContext.locationIds || [])],
    isAdmin: ["admin", "office"].includes(requestContext.actor.role),
  });
  if (!result) throw inventoryNotFound();
  return result;
}

export async function createSerializedUnitsForPart(catalogPartId, locationId, input, requestContext, dependencies = {}) {
  const partId = idSchema.parse(catalogPartId);
  const shopId = idSchema.parse(locationId);
  const parsed = createPartSerializedUnitsSchema.parse(input);
  assertInventoryQrConfigured(dependencies.qrOptions);
  const result = await (dependencies.create || createPartSerializedUnits)({
    catalogPartId: partId,
    locationId: shopId,
    ...parsed,
    actorId: requestContext.actor.id,
    ...locationWriteScope(requestContext),
  });
  if (result.kind === "not_found") throw inventoryNotFound();
  if (result.kind === "replay_conflict") {
    throw publicError("INVENTORY_SERIALIZATION_REPLAY_CONFLICT", "This serialization request key was already used with different values.", 409);
  }
  if (result.kind === "unsupported_unit") {
    throw publicError("INVENTORY_SERIALIZATION_UNIT_UNSUPPORTED", "Only whole count or package quantities can create one serialized QR per physical unit.");
  }
  return result;
}
