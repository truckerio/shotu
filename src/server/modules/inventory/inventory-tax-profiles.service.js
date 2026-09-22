import { createHash } from "node:crypto";
import { z } from "zod";
import { requireCompanyAccess, requirePermission } from "../../auth/authorize.js";
import { PERMISSION } from "../../auth/permissions.js";
import {
  createInventoryTaxProfileRepo,
  findInventoryTaxProfileCompany,
  listInventoryTaxProfilesRepo,
  reviseInventoryTaxProfileRepo,
  setInventoryTaxProfileArchivedRepo,
} from "../../db/repositories/inventory-tax-profiles.repo.js";
import { InventoryError, inventoryNotFound } from "./inventory.errors.js";
import {
  archiveInventoryTaxProfileSchema,
  createInventoryTaxProfileSchema,
  inventoryTaxProfileQuerySchema,
  reviseInventoryTaxProfileSchema,
} from "./inventory.schemas.js";

const idSchema = z.string().uuid();
function digest(value) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function conflict(code, message) { throw new InventoryError(message, { code, statusCode: 409 }); }

function mapMutation(result) {
  if (result.kind === "not_found") throw inventoryNotFound();
  if (result.kind === "stale") conflict("INVENTORY_TAX_PROFILE_STALE", "This tax profile changed. Refresh before saving.");
  if (result.kind === "idempotency_conflict") conflict("INVENTORY_TAX_PROFILE_REPLAY_CONFLICT", "This tax profile request key was already used with different details.");
  return { profile: result.profile, replayed: result.replayed };
}
export async function listInventoryTaxProfiles(searchParams, context, dependencies = {}) {
  requirePermission(context, PERMISSION.INVENTORY_COST_READ);
  const input = inventoryTaxProfileQuerySchema.parse(Object.fromEntries(searchParams));
  requireCompanyAccess(context, input.companyId);
  const profiles = await (dependencies.listTaxProfiles || listInventoryTaxProfilesRepo)(input);
  return { profiles };
}

export async function createInventoryTaxProfile(rawInput, context, dependencies = {}) {
  requirePermission(context, PERMISSION.INVENTORY_PRICE_WRITE);
  const input = createInventoryTaxProfileSchema.parse(rawInput);
  requireCompanyAccess(context, input.companyId);
  const command = { ...input, actorId: context.actor.id };
  const result = await (dependencies.createTaxProfile || createInventoryTaxProfileRepo)({ ...command, requestHash: digest(command) });
  return mapMutation(result);
}

async function scopedProfileCommand(profileId, rawInput, context, dependencies, schema, mutate) {
  requirePermission(context, PERMISSION.INVENTORY_PRICE_WRITE);
  profileId = idSchema.parse(profileId);
  const input = schema.parse(rawInput);
  const companyIds = [...(context.companyIds || [])];
  const companyId = await (dependencies.findTaxProfileCompany || findInventoryTaxProfileCompany)(profileId, companyIds);
  if (!companyId) throw inventoryNotFound();
  const command = { ...input, profileId, companyId, actorId: context.actor.id };
  const result = await mutate({ ...command, requestHash: digest(command) });
  return mapMutation(result);
}

export function reviseInventoryTaxProfile(profileId, rawInput, context, dependencies = {}) {
  return scopedProfileCommand(profileId, rawInput, context, dependencies, reviseInventoryTaxProfileSchema,
    dependencies.reviseTaxProfile || reviseInventoryTaxProfileRepo);
}

export function setInventoryTaxProfileArchived(profileId, rawInput, context, dependencies = {}) {
  return scopedProfileCommand(profileId, rawInput, context, dependencies, archiveInventoryTaxProfileSchema,
    dependencies.archiveTaxProfile || setInventoryTaxProfileArchivedRepo);
}
