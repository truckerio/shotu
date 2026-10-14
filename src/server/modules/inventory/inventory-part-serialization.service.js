import { z } from "zod";
import {
  createPartSerializedUnits,
  getPartLocationSerialization,
} from "../../db/repositories/inventory-part-serialization.repo.js";
import {
  getSerializedInventoryUnit,
  getSerializedInventoryUnitInvoiceSource,
} from "../../db/repositories/inventory-receipts.repo.js";
import { InventoryError, inventoryNotFound } from "./inventory.errors.js";
import { assertInventoryQrConfigured } from "./inventory-qr.js";
import { createPartSerializedUnitsSchema } from "./inventory.schemas.js";
import { resolveInventoryLocationScope, resolveInventoryReadLocationScope, resolveInventoryResourceScope } from "./inventory-effective-scope.js";

const idSchema = z.string().uuid();

function publicError(code, message, statusCode = 422) {
  return new InventoryError(message, { code, statusCode });
}

export async function readPartLocationSerialization(catalogPartId, locationId, requestContext, dependencies = {}) {
  const partId = idSchema.parse(catalogPartId);
  const shopId = idSchema.parse(locationId);
  const readScope = await (dependencies.resolveReadLocationScope || resolveInventoryReadLocationScope)(requestContext, shopId, {
    allowedRoles: ["admin", "office", "mechanic"], loadLocation: dependencies.loadLocation,
  });
  const result = await (dependencies.read || getPartLocationSerialization)({
    catalogPartId: partId,
    locationId: shopId,
    companyIds: readScope.companyIds,
  });
  if (!result) throw inventoryNotFound();
  const canWriteLocation = readScope.canManageLocation;
  const canManageInventory = ["admin", "office"].includes(readScope.effectiveRole);
  return {
    ...result,
    part: { ...result.part, canonicalUomCode: result.part.canonicalUomCode || result.part.uomCode },
    canCreateAtLocation: canManageInventory && canWriteLocation,
    canReceiveStock: canManageInventory && canWriteLocation
      && ["quantity", "measured_bulk"].includes(result.part.trackingMode),
  };
}

export async function readSerializedInventoryUnit(unitId, requestContext, dependencies = {}) {
  const id = idSchema.parse(unitId);
  const resolved = await (dependencies.resolveResourceScope || resolveInventoryResourceScope)(requestContext, "serializedUnit", id, {
    allowedRoles: ["admin", "office", "mechanic"],
    companyWideRoles: ["admin", "office"],
  });
  const scope = {
    unitId: id,
    companyIds: resolved.companyIds,
    locationIds: resolved.locationIds,
    isAdmin: ["admin", "office"].includes(resolved.effectiveRole),
  };
  const result = await (dependencies.readUnit || getSerializedInventoryUnit)(scope);
  if (!result) throw inventoryNotFound();
  if (result.source?.type === "invoice") {
    const invoice = await (dependencies.readInvoiceSource || getSerializedInventoryUnitInvoiceSource)(scope);
    if (invoice) return { ...result, source: { type: "invoice", ...invoice } };
  }
  return result;
}

export async function createSerializedUnitsForPart(catalogPartId, locationId, input, requestContext, dependencies = {}) {
  const partId = idSchema.parse(catalogPartId);
  const shopId = idSchema.parse(locationId);
  const parsed = createPartSerializedUnitsSchema.parse(input);
  assertInventoryQrConfigured(dependencies.qrOptions);
  const scope = await (dependencies.resolveLocationScope || resolveInventoryLocationScope)(requestContext, shopId, {
    allowedRoles: ["admin", "office"], loadLocation: dependencies.loadLocation,
  });
  const result = await (dependencies.create || createPartSerializedUnits)({
    catalogPartId: partId,
    locationId: shopId,
    ...parsed,
    workorderId: dependencies.workorderId || null,
    actorId: requestContext.actor.id,
    companyIds: scope.companyIds,
    locationIds: scope.locationIds,
    isAdmin: scope.isAdmin,
  });
  if (result.kind === "not_found") throw inventoryNotFound();
  if (result.kind === "replay_conflict") {
    throw publicError("INVENTORY_SERIALIZATION_REPLAY_CONFLICT", "This serialization request key was already used with different values.", 409);
  }
  if (result.kind === "unsupported_unit") {
    throw publicError("INVENTORY_SERIALIZATION_UNIT_UNSUPPORTED", "Only whole count or package quantities can create one serialized QR per physical unit.");
  }
  if (result.kind === "tracking_policy") {
    throw publicError("INVENTORY_SERIALIZATION_TRACKING_POLICY", "This part uses quantity tracking. Change its reviewed tracking policy before creating exact units.");
  }
  if (result.kind === "workorder_state") {
    throw publicError("WORKORDER_INVENTORY_NOT_ACTIVE", "Physical units can only be added while this workorder is open or active.", 409);
  }
  if (result.kind === "authority_conflict") {
    throw publicError("INVENTORY_AUTHORITY_CONFLICT", "Legacy provider inventory still has an active reservation. Inventory review is required.", 409);
  }
  if (result.kind === "authority_unmatched") {
    throw publicError("INVENTORY_AUTHORITY_IDENTITY_UNMATCHED", "Provider inventory identity does not match this catalog part. Inventory review is required.", 409);
  }
  return result;
}
