import { createHash } from "node:crypto";
import { isApplicationOwnedInventoryProvider } from "../../../../shared/inventory-provider.js";
import { requireLocationAccess } from "../../auth/authorize.js";
import { authorizeWorkorderModule } from "../workorders/workorder-module-access.service.js";
import {
  finalizeSerializedUnitUsage,
  issueSerializedUnitToWorkorder,
  listWorkorderSerializedUnitUsages,
  resolveWorkorderSerializedUnit,
} from "../../db/repositories/inventory-unit-workorder-usage.repo.js";
import { InventoryError, inventoryNotFound } from "./inventory.errors.js";
import { inventoryTokenFromCode, readInventoryQrToken } from "./inventory-qr.js";
import {
  finalizeWorkorderInventoryUnitSchema,
  inventoryWorkorderEntityIdSchema,
  issueWorkorderInventoryUnitSchema,
  resolveWorkorderInventoryUnitSchema,
} from "./inventory-unit-workorder.schemas.js";

const ISSUE_STATUSES = new Set(["accepted", "in_progress"]);

function failure(code, message, statusCode = 409, retryable = false) {
  return new InventoryError(message, { code, statusCode, retryable });
}

function hash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function repositoryScope(context, authorization) {
  requireLocationAccess(context, authorization.locationId);
  return {
    companyId: authorization.companyId,
    locationId: authorization.locationId,
    actorRole: context.actor.role,
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
  if (kind === "missing") throw inventoryNotFound();
  if (kind === "idempotency_conflict") throw failure("INVENTORY_UNIT_REPLAY_CONFLICT", "This request key was already used for a different serialized-part action.");
  if (kind === "workorder_state") throw failure("WORKORDER_INVENTORY_NOT_ACTIVE", "Serialized parts can only be changed while this workorder is active.");
  if (kind === "asset_required") throw failure("WORKORDER_ASSET_REQUIRED", "Link an exact unit to this workorder before using a serialized part.");
  if (kind === "provider_not_local") throw failure("INVENTORY_UNIT_PROVIDER_NOT_LOCAL", "This label is managed by an external inventory provider and cannot be issued here.");
  if (kind === "unit_state") throw failure("INVENTORY_UNIT_NOT_AVAILABLE", "This serialized part changed or is no longer available for this action.");
  if (kind === "stock_mismatch") throw failure("INVENTORY_SERIAL_BALANCE_MISMATCH", "The serialized identity and local stock balance do not match. Inventory review is required.");
}

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
  const unitId = unitIdFromCode(input.code, dependencies);
  const requestHash = hash({ action: "issue", workorderId, unitId });
  const result = await (dependencies.issueUnit || issueSerializedUnitToWorkorder)({
    workorderId,
    unitId,
    actorId: context.actor.id,
    idempotencyKey: input.idempotencyKey,
    requestHash,
    ...scope,
  });
  mapMutationFailure(result.kind);
  return { usage: result.usage, replayed: result.kind === "replay" };
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
  return { usages };
}
