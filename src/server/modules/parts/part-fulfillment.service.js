import { createHash } from "node:crypto";
import { getUnitDefinition } from "../../../../shared/units-of-measure.js";
import { requireCompanyAccess, requireLocationAccess } from "../../auth/authorize.js";
import { InventoryError, inventoryNotFound } from "../inventory/inventory.errors.js";
import { createPartFulfillmentSchema, approvePartFulfillmentSchema } from "./part-fulfillment.schemas.js";
import { createPartFulfillment, approvePartFulfillment, getPartFulfillment, findFulfillmentAvailability, findFulfillmentCatalogPart } from "../../db/repositories/part-fulfillment.repo.js";
import { getOperationalWorkorderById } from "../../db/repositories/operational-workorders.repo.js";
import { authorizeWorkorderModule } from "../workorders/workorder-module-access.service.js";

function failure(code, message, statusCode = 422) { return new InventoryError(message, { code, statusCode }); }
function hash(value) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function scope(context) { return { companyIds: [...(context.companyIds || [])], locationIds: [...(context.locationIds || [])], isAdmin: context.actor.role === "admin" }; }

function assertUsableQuantity(input) {
  const unit = getUnitDefinition(input.uomCode);
  if (!unit) throw failure("PART_FULFILLMENT_UOM_INVALID", "Use a supported inventory unit.");
  const scale = 10 ** unit.decimalScale;
  if (Math.round(input.quantity * scale) / scale !== input.quantity) throw failure("PART_FULFILLMENT_QUANTITY_INVALID", `Quantity is not valid for ${input.uomCode}.`);
}

function assertActiveWorkorder(workorder) {
  if (!["open", "accepted", "in_progress", "mechanic_done"].includes(workorder.status)) {
    throw failure("PART_FULFILLMENT_WORKORDER_INACTIVE", "This workorder can no longer create or approve a parts recommendation.", 409);
  }
}

function recommendation(input, availability) {
  const destination = availability.filter((row) => row.locationId === input.destinationLocationId && row.uomCode === input.uomCode)[0];
  const destinationAvailable = Number(destination?.quantityAvailable || 0);
  if (destinationAvailable >= input.quantity) return [{ routeType: "destination_stock", quantity: input.quantity, state: "proposed", inventoryItemId: destination.id, sourceLocationId: null }];
  const source = availability
    .filter((row) => row.locationId !== input.destinationLocationId && row.uomCode === input.uomCode && Number(row.quantityAvailable || 0) > 0)
    .sort((left, right) => Number(right.quantityAvailable) - Number(left.quantityAvailable) || String(left.locationId).localeCompare(String(right.locationId)))[0];
  if (!source) return [{ routeType: "internal_transfer", quantity: input.quantity, state: "backordered", inventoryItemId: null, sourceLocationId: null }];
  const transferQuantity = Math.min(input.quantity, Number(source.quantityAvailable));
  const legs = [{ routeType: "internal_transfer", quantity: transferQuantity, state: "ready_for_transfer", inventoryItemId: source.id, sourceLocationId: source.locationId }];
  if (transferQuantity < input.quantity) legs.push({ routeType: "internal_transfer", quantity: input.quantity - transferQuantity, state: "backordered", inventoryItemId: null, sourceLocationId: source.locationId });
  return legs;
}

export async function recommendPartFulfillment(rawInput, context, dependencies = {}) {
  const input = createPartFulfillmentSchema.parse(rawInput); assertUsableQuantity(input);
  requireLocationAccess(context, input.destinationLocationId);
  const workorder = await (dependencies.loadWorkorder || getOperationalWorkorderById)(input.workorderId);
  if (!workorder || !context.companyIds?.has(workorder.companyId)) throw inventoryNotFound();
  assertActiveWorkorder(workorder);
  requireCompanyAccess(context, workorder.companyId);
  if (workorder.locationId !== input.destinationLocationId) throw failure("PART_FULFILLMENT_DESTINATION_MISMATCH", "Destination must match the workorder location.", 409);
  requireLocationAccess(context, workorder.locationId);
  await (dependencies.authorizeModule || authorizeWorkorderModule)(context, input.workorderId, {
    moduleKey: "parts",
    capability: "write",
    action: "allocate",
  });
  const catalog = await (dependencies.loadCatalogPart || findFulfillmentCatalogPart)({ companyId: workorder.companyId, catalogPartId: input.catalogPartId });
  if (!catalog || catalog.uomCode !== input.uomCode) throw failure("PART_FULFILLMENT_PART_INVALID", "Part identity or unit is unavailable for this company.", 409);
  const availability = await (dependencies.findAvailability || findFulfillmentAvailability)({ companyId: workorder.companyId, catalogPartId: input.catalogPartId, uomCode: input.uomCode, limit: 20 });
  const visibleAvailability = context.actor.role === "admin"
    ? availability
    : availability.filter((row) => context.locationIds?.has(row.locationId));
  const legs = recommendation(input, visibleAvailability);
  const requestShape = { workorderId: input.workorderId, catalogPartId: input.catalogPartId, destinationLocationId: input.destinationLocationId, quantity: input.quantity, uomCode: input.uomCode, neededBy: input.neededBy, legs };
  const result = await (dependencies.createFulfillment || createPartFulfillment)({ ...input, companyId: workorder.companyId, actorId: context.actor.id, requestHash: hash(requestShape), legs, ...scope(context) });
  if (result.kind === "inactive") throw failure("PART_FULFILLMENT_WORKORDER_INACTIVE", "This workorder can no longer create or approve a parts recommendation.", 409);
  if (result.kind === "conflict") throw failure("PART_FULFILLMENT_REPLAY_CONFLICT", "This request key was already used with different part, quantity, or destination.", 409);
  return { fulfillment: result.fulfillment, replayed: result.kind === "replay" };
}

export async function approveRecommendedFulfillment(fulfillmentId, rawInput, context, dependencies = {}) {
  const input = approvePartFulfillmentSchema.parse(rawInput);
  const existing = await (dependencies.getFulfillment || getPartFulfillment)({ fulfillmentId, ...scope(context) });
  if (!existing) throw inventoryNotFound();
  requireCompanyAccess(context, existing.companyId); requireLocationAccess(context, existing.destinationLocationId);
  await (dependencies.authorizeModule || authorizeWorkorderModule)(context, existing.workorderId, {
    moduleKey: "parts",
    capability: "write",
    action: "allocate",
  });
  const workorder = await (dependencies.loadWorkorder || getOperationalWorkorderById)(existing.workorderId);
  if (!workorder || workorder.companyId !== existing.companyId || workorder.locationId !== existing.destinationLocationId) {
    throw inventoryNotFound();
  }
  assertActiveWorkorder(workorder);
  if (existing.recommendationVersion !== input.recommendationVersion) throw failure("PART_FULFILLMENT_RECOMMENDATION_STALE", "Refresh the current recommendation before approving.", 409);
  if (!["recommended", "approved"].includes(existing.state)) throw failure("PART_FULFILLMENT_NOT_APPROVABLE", "This fulfillment is no longer awaiting approval.", 409);
  const approvalRequestHash = hash({ fulfillmentId, recommendationVersion: input.recommendationVersion });
  const result = await (dependencies.approveFulfillment || approvePartFulfillment)({ fulfillmentId, companyId: existing.companyId, actorId: context.actor.id, idempotencyKey: input.idempotencyKey, requestHash: approvalRequestHash, recommendationVersion: input.recommendationVersion });
  if (result.kind === "inactive") throw failure("PART_FULFILLMENT_WORKORDER_INACTIVE", "This workorder can no longer create or approve a parts recommendation.", 409);
  if (result.kind === "stale") throw failure("PART_FULFILLMENT_RECOMMENDATION_STALE", "Refresh the current recommendation before approving.", 409);
  if (result.kind === "conflict") throw failure("PART_FULFILLMENT_APPROVAL_REPLAY_CONFLICT", "This approval key was already used for a different request.", 409);
  return { fulfillment: result.fulfillment, replayed: result.kind === "replay" };
}
