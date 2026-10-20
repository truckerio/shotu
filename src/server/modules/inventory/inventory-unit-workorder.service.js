import { createHash } from "node:crypto";
import { isApplicationOwnedInventoryProvider } from "../../../../shared/inventory-provider.js";
import { requireLocationAccess } from "../../auth/authorize.js";
import { effectiveCompanyRole } from "../../auth/company-role.js";
import { authorizeWorkorderModule } from "../workorders/workorder-module-access.service.js";
import {
  finalizeSerializedUnitUsage,
  issueSerializedUnitToWorkorder,
  listWorkorderSerializedUnitUsages,
  listAvailableSerializedUnitsForWorkorder,
  listAvailableSerializedUnitsForCreate,
  resolveWorkorderSerializedUnit,
  updateSerializedUsageRepairOrder,
} from "../../db/repositories/inventory-unit-workorder-usage.repo.js";
import { getWorkorderMechanicPartsPolicy } from "../../db/repositories/workorder-policies.repo.js";
import { InventoryError, inventoryNotFound } from "./inventory.errors.js";
import { inventoryTokenFromCode, readInventoryQrToken } from "./inventory-qr.js";
import {
  finalizeWorkorderInventoryUnitSchema,
  inventoryWorkorderEntityIdSchema,
  issueWorkorderInventoryUnitSchema,
  createWorkorderInventoryUnitsSchema,
  listCreateInventoryUnitsSchema,
  listWorkorderInventoryUnitsSchema,
  resolveWorkorderInventoryUnitSchema,
  updateSerializedUsageRepairOrderSchema,
} from "./inventory-unit-workorder.schemas.js";
import { getLocationById } from "../../db/repositories/locations.repo.js";
import { authorizeWorkorderCreate } from "../workorders/workorder-module-access.service.js";
import { createSerializedUnitsForPart } from "./inventory-part-serialization.service.js";
import { issueSerializedUnitWithPrice } from "../../db/repositories/workorder-part-selection.repo.js";
import { readCreatePricing } from "../../db/repositories/workorder-create-pricing.repo.js";

const ISSUE_STATUSES = new Set(["accepted", "in_progress"]);

function failure(code, message, statusCode = 409, retryable = false) {
  return new InventoryError(message, { code, statusCode, retryable });
}

function hash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function repositoryScope(context, authorization) {
  requireLocationAccess(context, authorization.locationId, authorization.companyId);
  const actorRole = effectiveCompanyRole(context, authorization.companyId);
  if (!actorRole) throw inventoryNotFound();
  return {
    companyId: authorization.companyId,
    locationId: authorization.locationId,
    actorRole,
  };
}

async function authorizeScanning(workorderId, context, dependencies, capability, action = null) {
  const authorize = dependencies.authorize || authorizeWorkorderModule;
  const authorization = await authorize(context, workorderId, {
    moduleKey: "partsScanning",
    capability,
    action,
  });
  return { authorization, scope: repositoryScope(context, authorization) };
}

function unitIdFromCode(code, dependencies) {
  const token = (dependencies.tokenFromCode || inventoryTokenFromCode)(code);
  const unitId = (dependencies.readToken || readInventoryQrToken)(token, dependencies.qrOptions);
  if (!unitId) throw inventoryNotFound();
  return unitId;
}

function workorderSummary(workorder) {
  return {
    id: workorder.id,
    serial: workorder.serial || "",
    assetId: workorder.assetId || null,
    asset: workorder.asset ? {
      id: workorder.asset.id,
      unitNo: workorder.asset.unitNo || "",
      name: workorder.asset.name || "",
    } : null,
    locationId: workorder.locationId || null,
    status: workorder.status,
  };
}

function eligibility({ workorder, unit }) {
  if (!workorder.assetId) return { canIssue: false, code: "WORKORDER_ASSET_REQUIRED", message: "Link an exact unit to this workorder before using a serialized part." };
  if (!ISSUE_STATUSES.has(workorder.status)) return { canIssue: false, code: "WORKORDER_INVENTORY_NOT_ACTIVE", message: "Serialized parts can only be issued to active work." };
  if (!isApplicationOwnedInventoryProvider(unit.provider)) return { canIssue: false, code: "INVENTORY_UNIT_PROVIDER_NOT_LOCAL", message: "This label is managed by an external inventory provider and cannot be issued here." };
  if (unit.status !== "in_stock") return { canIssue: false, code: "INVENTORY_UNIT_NOT_AVAILABLE", message: "This serialized part is no longer available to issue." };
  return { canIssue: true, code: "", message: "Ready to use on this workorder." };
}

function mapMutationFailure(kind) {
  if (kind === "custody_required") throw failure("INVENTORY_REUSE_CUSTODY_REQUIRED", "Physically installed parts require removal, handoff, and inspection through Units → Removed parts.");
  if (kind === "missing") throw inventoryNotFound();
  if (kind === "idempotency_conflict") throw failure("INVENTORY_UNIT_REPLAY_CONFLICT", "This request key was already used for a different serialized-part action.");
  if (kind === "workorder_state") throw failure("WORKORDER_INVENTORY_NOT_ACTIVE", "Serialized parts can only be changed while this workorder is active.");
  if (kind === "asset_required") throw failure("WORKORDER_ASSET_REQUIRED", "Link an exact unit to this workorder before using a serialized part.");
  if (kind === "provider_not_local") throw failure("INVENTORY_UNIT_PROVIDER_NOT_LOCAL", "This label is managed by an external inventory provider and cannot be issued here.");
  if (kind === "unit_state") throw failure("INVENTORY_UNIT_NOT_AVAILABLE", "This serialized part changed or is no longer available for this action.");
  if (kind === "stock_mismatch") throw failure("INVENTORY_SERIAL_BALANCE_MISMATCH", "The serialized identity and local stock balance do not match. Inventory review is required.");
  if (kind === "usage_state") throw failure("SERIALIZED_PART_REPAIR_ORDER_LOCKED", "The repair order can only be changed while this serialized part is installed on the workorder.");
}

const OFFICE_PARTS_EDIT_STATUSES = new Set(["open", "accepted", "in_progress", "mechanic_done"]);
const MECHANIC_PARTS_EDIT_STATUSES = new Set(["accepted", "in_progress"]);

export async function resolveSerializedUnitForWorkorder(workorderId, rawInput, context, dependencies = {}) {
  workorderId = inventoryWorkorderEntityIdSchema.parse(workorderId);
  const input = resolveWorkorderInventoryUnitSchema.parse(rawInput);
  const { authorization, scope } = await authorizeScanning(workorderId, context, dependencies, "write", "resolve");
  const unitId = unitIdFromCode(input.code, dependencies);
  const unit = await (dependencies.resolveUnit || resolveWorkorderSerializedUnit)({
    workorderId,
    unitId,
    actorId: context.actor.id,
    ...scope,
  });
  if (!unit) throw inventoryNotFound();
  return {
    workorder: workorderSummary(authorization.workorder),
    unit,
    eligibility: eligibility({ workorder: authorization.workorder, unit }),
  };
}

export async function issueSerializedUnitForWorkorder(workorderId, rawInput, context, dependencies = {}) {
  workorderId = inventoryWorkorderEntityIdSchema.parse(workorderId);
  const input = issueWorkorderInventoryUnitSchema.parse(rawInput);
  const { scope } = await authorizeScanning(workorderId, context, dependencies, "write", "issue");
  const unitId = input.unitId || unitIdFromCode(input.code, dependencies);
  if (input.pricing && !["office", "admin"].includes(scope.actorRole)) {
    throw failure("WORKORDER_PART_PRICE_FORBIDDEN", "Only Office or Admin may select part prices.", 403);
  }
  const requestHash = hash({ action: "issue", workorderId, unitId });
  const usageCommand = {
    workorderId,
    unitId,
    actorId: context.actor.id,
    idempotencyKey: input.idempotencyKey,
    requestHash,
    ...scope,
  };
  const result = input.pricing
    ? await (dependencies.issueUnitWithPrice || issueSerializedUnitWithPrice)({ usage: usageCommand, pricing: input.pricing })
    : await (dependencies.issueUnit || issueSerializedUnitToWorkorder)(usageCommand);
  mapMutationFailure(result.kind);
  if (result.kind === "pricing_changed") throw failure("WORKORDER_PRICING_CHANGED", "Part pricing changed. Refresh the preview and try again.");
  return { usage: result.usage, price: result.price || null, replayed: result.kind === "replay" };
}

export async function readAvailableSerializedUnitsForWorkorder(workorderId, rawInput, context, dependencies = {}) {
  workorderId = inventoryWorkorderEntityIdSchema.parse(workorderId);
  const input = listWorkorderInventoryUnitsSchema.parse(rawInput);
  const { scope } = await authorizeScanning(workorderId, context, dependencies, "read");
  const result = await (dependencies.listAvailableUnits || listAvailableSerializedUnitsForWorkorder)({
    workorderId,
    catalogPartId: input.catalogPartId,
    queryText: input.q,
    after: input.after,
    limit: input.limit,
    ...scope,
  });
  if (result.kind === "missing") throw inventoryNotFound();
  return {
    part: result.part,
    location: result.location,
    canCreateSerializedUnits: result.canCreateSerializedUnits
      && ["admin", "office"].includes(scope.actorRole),
    units: result.units,
    nextCursor: result.nextCursor,
  };
}

export async function readAvailableSerializedUnitsForCreate(rawInput, context, dependencies = {}) {
  const input = listCreateInventoryUnitsSchema.parse(rawInput);
  const loadLocation = dependencies.getLocation || getLocationById;
  const location = await loadLocation(input.locationId, [...(context.companyIds || [])]);
  if (!location) throw inventoryNotFound();
  requireLocationAccess(context, input.locationId, location.company_id);
  const authorizeCreate = dependencies.authorizeCreate || authorizeWorkorderCreate;
  await authorizeCreate(context, {
    companyId: location.company_id,
    locationId: location.id,
    moduleKeys: ["parts"],
    enforceRequired: false,
  });
  const result = await (dependencies.listAvailableUnits || listAvailableSerializedUnitsForCreate)({
    companyId: location.company_id,
    locationId: location.id,
    catalogPartId: input.catalogPartId,
    queryText: input.q,
    after: input.after,
    limit: input.limit,
  });
  if (result.kind === "missing" || result.serialRequired !== true) throw inventoryNotFound();
  const role = effectiveCompanyRole(context, location.company_id);
  if (["office", "admin"].includes(role) && context.sessionMode !== "kiosk" && result.part?.uomCode) {
    result.units = await Promise.all(result.units.map(async (unit) => {
      const pricing = await (dependencies.readCreatePricing || readCreatePricing)({
        companyId: location.company_id,
        locationId: location.id,
        formData: { parts: [{ catalogPartId: input.catalogPartId, qty: 1, uomCode: result.part.uomCode }], laborHours: 0, laborProduct: null },
        inventoryUnitSelections: [{ partIndex: 0, unitIds: [unit.id] }],
        inventoryPositionSelections: [],
        pricing: { parts: [] },
      });
      return { ...unit, pricing: { fingerprint: pricing.fingerprint, options: pricing.parts[0]?.options || {} } };
    }));
  }
  return result;
}

export async function createSerializedUnitsForWorkorder(workorderId, rawInput, context, dependencies = {}) {
  workorderId = inventoryWorkorderEntityIdSchema.parse(workorderId);
  const input = createWorkorderInventoryUnitsSchema.parse(rawInput);
  const { authorization, scope } = await authorizeScanning(workorderId, context, dependencies, "write");
  if (!["admin", "office"].includes(scope.actorRole)) {
    throw failure("INVENTORY_CREATE_FORBIDDEN", "Only Office or Admin can add physical inventory.", 403);
  }
  if (!["open", "accepted", "in_progress"].includes(authorization.workorder.status)) {
    throw failure("WORKORDER_INVENTORY_NOT_ACTIVE", "Physical units can only be added while this workorder is open or active.");
  }
  const create = dependencies.createUnits || createSerializedUnitsForPart;
  return create(input.catalogPartId, authorization.locationId, {
    quantity: input.quantity,
    confirmation: input.confirmation,
    conditionCode: input.conditionCode,
    conditionEvidence: input.conditionEvidence,
    idempotencyKey: input.idempotencyKey,
  }, context, { ...(dependencies.serializationDependencies || {}), workorderId });
}

export async function finalizeSerializedUnitForWorkorder(workorderId, usageId, rawInput, context, dependencies = {}) {
  workorderId = inventoryWorkorderEntityIdSchema.parse(workorderId);
  usageId = inventoryWorkorderEntityIdSchema.parse(usageId);
  const input = finalizeWorkorderInventoryUnitSchema.parse(rawInput);
  const { scope } = await authorizeScanning(workorderId, context, dependencies, "write", "finalize");
  const requestHash = hash({ action: "finalize", workorderId, usageId, disposition: input.disposition });
  const result = await (dependencies.finalizeUnit || finalizeSerializedUnitUsage)({
    workorderId,
    usageId,
    disposition: input.disposition,
    actorId: context.actor.id,
    idempotencyKey: input.idempotencyKey,
    requestHash,
    ...scope,
  });
  mapMutationFailure(result.kind);
  return { usage: result.usage, replayed: result.kind === "replay" };
}

export async function readSerializedUnitUsagesForWorkorder(workorderId, context, dependencies = {}) {
  workorderId = inventoryWorkorderEntityIdSchema.parse(workorderId);
  const { scope } = await authorizeScanning(workorderId, context, dependencies, "read");
  const usages = await (dependencies.listUsages || listWorkorderSerializedUnitUsages)({
    workorderId,
    actorId: context.actor.id,
    ...scope,
    limit: 100,
  });
  const canReadFinancials = ["admin", "office"].includes(scope.actorRole)
    && context.sessionMode !== "kiosk";
  return {
    usages: canReadFinancials
      ? usages
      : usages.map(({ price: _price, costAllocations: _costAllocations, ...usage }) => usage),
  };
}

export async function updateSerializedUsageRepairOrderForWorkorder(workorderId, rawInput, context, dependencies = {}) {
  workorderId = inventoryWorkorderEntityIdSchema.parse(workorderId);
  const input = updateSerializedUsageRepairOrderSchema.parse(rawInput);
  const authorize = dependencies.authorization ? null : (dependencies.authorizeParts || authorizeWorkorderModule);
  const authorization = dependencies.authorization || await authorize(context, workorderId, {
    moduleKey: "parts", capability: "write", action: "record",
  });
  const scope = repositoryScope(context, authorization);
  if (scope.actorRole === "mechanic") {
    const policy = await (dependencies.getMechanicPartsPolicy || getWorkorderMechanicPartsPolicy)(workorderId);
    if (!policy?.mechanicCanRecordParts) {
      throw failure("MECHANIC_PARTS_ENTRY_DISABLED", "Mechanics cannot record used parts at this location. Send a part request to the office instead.", 403);
    }
  }
  const allowedWorkorderStatuses = scope.actorRole === "mechanic"
    ? [...MECHANIC_PARTS_EDIT_STATUSES]
    : [...OFFICE_PARTS_EDIT_STATUSES];
  const result = await (dependencies.updateRepairOrder || updateSerializedUsageRepairOrder)({
    workorderId,
    usageId: input.usageId,
    repairOrder: input.repairOrder,
    actorId: context.actor.id,
    allowedWorkorderStatuses,
    ...scope,
  });
  mapMutationFailure(result.kind);
  return { usage: result.usage, unchanged: result.kind === "unchanged" };
}
