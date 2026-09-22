import { createHash } from "node:crypto";
import { z } from "zod";
import { appendInventoryPartPrice, getInventoryPartCommercial, getInventoryPartPricingSource } from "../../db/repositories/inventory-part-prices.repo.js";
import { readInventoryTaxProfileVersion } from "../../db/repositories/inventory-tax-profiles.repo.js";
import { InventoryError, inventoryNotFound } from "./inventory.errors.js";
import { inventoryPartCommercialQuerySchema, inventoryPricingPreviewSchema, updateInventoryPartPriceSchema } from "./inventory.schemas.js";
import { requirePermission } from "../../auth/authorize.js";
import { PERMISSION } from "../../auth/permissions.js";
import { getUnitDefinition } from "../../../../shared/units-of-measure.js";
import { calculateInventoryPricingPreview, isSupportedInventoryCurrency } from "./inventory-pricing.js";
import { resolveInventoryLocationScope } from "./inventory-effective-scope.js";

const idSchema = z.string().uuid();
const priceKindSchema = z.enum(["internal", "selling"]);

function fail(code, message, statusCode = 409) { throw new InventoryError(message, { code, statusCode }); }

export async function readInventoryPartCommercial(catalogPartId, searchParams, context, dependencies = {}) {
  requirePermission(context, PERMISSION.INVENTORY_COST_READ);
  catalogPartId = idSchema.parse(catalogPartId);
  const query = inventoryPartCommercialQuerySchema.parse(Object.fromEntries(searchParams));
  const resolvedScope = query.locationId
    ? await (dependencies.resolveLocationScope || resolveInventoryLocationScope)(context, query.locationId)
    : {
      companyIds: [...(context.companyIds || [])],
      locationIds: [...(context.locationIds || [])],
      isAdmin: context.actor.role === "admin",
    };
  const result = await (dependencies.read || getInventoryPartCommercial)({
    catalogPartId,
    companyIds: resolvedScope.companyIds,
    locationIds: resolvedScope.locationIds,
    isAdmin: resolvedScope.isAdmin,
    locationId: query.locationId || null,
    historyLimit: query.limit,
  });
  if (!result) throw inventoryNotFound();
  const canWritePrices = context.permissions?.has(PERMISSION.INVENTORY_PRICE_WRITE) === true;
  return { ...result, capabilities: { canReadCost: true, canEditPrices: canWritePrices, canManageTaxProfiles: canWritePrices } };
}

async function writeInventoryPartPrice(catalogPartId, locationId, priceKind, rawInput, context, dependencies = {}) {
  requirePermission(context, PERMISSION.INVENTORY_PRICE_WRITE);
  catalogPartId = idSchema.parse(catalogPartId);
  const kind = priceKindSchema.parse(priceKind);
  const input = updateInventoryPartPriceSchema.parse(rawInput);
  const resolvedScope = locationId
    ? await (dependencies.resolveLocationScope || resolveInventoryLocationScope)(context, idSchema.parse(locationId))
    : {
      companyIds: [...(context.companyIds || [])],
      locationIds: [...(context.locationIds || [])],
      isAdmin: context.actor.role === "admin",
    };
  const command = {
    catalogPartId, ...(locationId ? { locationId } : {}), kind, expectedVersion: input.expectedVersion, amount: input.amount, currency: input.currency,
    ...(input.taxTreatment === undefined ? {} : { taxTreatment: input.taxTreatment }),
    ...(input.taxProfileVersionId === undefined ? {} : { taxProfileVersionId: input.taxProfileVersionId }),
    reason: input.reason,
  };
  const result = await (dependencies.append || appendInventoryPartPrice)({
    ...command,
    locationId,
    companyIds: resolvedScope.companyIds,
    locationIds: resolvedScope.locationIds,
    isAdmin: resolvedScope.isAdmin,
    actorId: context.actor.id,
    idempotencyKey: input.idempotencyKey,
    requestHash: createHash("sha256").update(JSON.stringify(command)).digest("hex"),
  });
  if (result.kind === "not_found") throw inventoryNotFound();
  if (result.kind === "stale") fail("INVENTORY_PART_PRICE_STALE", "This price changed. Refresh before saving.");
  if (result.kind === "idempotency_conflict") fail("INVENTORY_PART_PRICE_REPLAY_CONFLICT", "This price request key was already used with different details.");
  if (result.kind === "tax_required") fail("INVENTORY_PART_PRICE_TAX_REQUIRED", "Select the tax treatment before changing this configured price.", 422);
  if (result.kind === "tax_profile_invalid") fail("INVENTORY_PART_PRICE_TAX_PROFILE_INVALID", "Select the current active tax profile in the same currency.", 422);
  return { price: result.price, replayed: result.replayed };
}

export async function updateInventoryPartPrice(catalogPartId, priceKind, rawInput, context, dependencies = {}) {
  return writeInventoryPartPrice(catalogPartId, null, priceKind, rawInput, context, dependencies);
}

export async function updateInventoryLocationPartPrice(catalogPartId, locationId, priceKind, rawInput, context, dependencies = {}) {
  return writeInventoryPartPrice(catalogPartId, locationId, priceKind, rawInput, context, dependencies);
}

export const setInventoryPartPrice = updateInventoryPartPrice;

function validatePreviewQuantity(quantity, part) {
  const [whole, decimals = ""] = quantity.split(".");
  if (BigInt(whole) > 999_999_999n) fail("INVENTORY_PRICE_QUANTITY_INVALID", "Quantity is too large.", 400);
  const unit = getUnitDefinition(part.uomCode);
  const allowedScale = ["quantity", "serialized"].includes(part.trackingMode) ? 0 : Math.min(unit?.decimalScale ?? 0, 3);
  if (decimals.length > allowedScale || (allowedScale === 0 && decimals && /[1-9]/.test(decimals))) {
    fail("INVENTORY_PRICE_QUANTITY_PRECISION", allowedScale === 0 ? "This part requires a whole-number quantity." : `Quantity can have at most ${allowedScale} decimal places.`, 400);
  }
}

function unknownPreview({ source, input, part, price = null }) {
  return {
    source, priceKind: input.priceKind, priceVersionId: price?.id || null, priceVersion: price?.version || null,
    taxTreatment: input.draft?.taxTreatment || price?.taxTreatment || "not_configured", taxProfileVersionId: input.draft?.taxProfileVersionId || price?.taxProfileVersionId || null,
    currency: null, quantity: input.quantity, uomCode: part.uomCode, displayUomCode: part.displayUomCode,
    unitPrice: null, subtotal: null, discountPercent: input.discountPercent, discountAmount: null,
    net: null, components: [], tax: null, total: null, blockers: ["price_unknown"],
  };
}

export async function previewInventoryPartPrice(catalogPartId, rawInput, context, dependencies = {}, locationId = null) {
  requirePermission(context, PERMISSION.INVENTORY_COST_READ);
  catalogPartId = idSchema.parse(catalogPartId);
  locationId = locationId ? idSchema.parse(locationId) : null;
  const input = inventoryPricingPreviewSchema.parse(rawInput);
  const resolvedScope = locationId
    ? await (dependencies.resolveLocationScope || resolveInventoryLocationScope)(context, locationId)
    : {
      companyIds: [...(context.companyIds || [])],
      locationIds: [...(context.locationIds || [])],
      isAdmin: context.actor.role === "admin",
    };
  const sourceResult = await (dependencies.readPricingSource || getInventoryPartPricingSource)({
    catalogPartId,
    companyIds: resolvedScope.companyIds,
    locationIds: resolvedScope.locationIds,
    isAdmin: resolvedScope.isAdmin,
    locationId,
    kind: input.priceKind,
  });
  if (!sourceResult) throw inventoryNotFound();
  validatePreviewQuantity(input.quantity, sourceResult.part);
  const source = input.draft ? "draft" : "saved";
  const selected = input.draft || sourceResult.price;
  if (!selected || selected.amount === null) return unknownPreview({ source, input, part: sourceResult.part, price: sourceResult.price });
  if (!isSupportedInventoryCurrency(selected.currency)) {
    return {
      source, priceKind: input.priceKind, priceVersionId: source === "saved" ? sourceResult.price.id : null,
      priceVersion: source === "saved" ? sourceResult.price.version : null,
      taxTreatment: selected.taxTreatment, taxProfileVersionId: selected.taxProfileVersionId || null,
      currency: selected.currency, quantity: input.quantity, uomCode: sourceResult.part.uomCode, displayUomCode: sourceResult.part.displayUomCode,
      unitPrice: selected.amount, subtotal: null, discountPercent: input.discountPercent, discountAmount: null,
      net: null, components: [], tax: null, total: null, blockers: ["currency_unsupported"],
    };
  }
  let taxProfile = source === "saved" ? sourceResult.price.taxProfile : null;
  if (["inclusive", "exclusive"].includes(selected.taxTreatment)) {
    if (source === "draft") {
      taxProfile = await (dependencies.readTaxProfileVersion || readInventoryTaxProfileVersion)({ companyIds: [sourceResult.part.companyId], taxProfileVersionId: selected.taxProfileVersionId, requireCurrentActive: true });
    }
    if (!taxProfile || taxProfile.currency !== selected.currency) fail("INVENTORY_PART_PRICE_TAX_PROFILE_INVALID", "Select the current active tax profile in the same currency.", 422);
  }
  const calculated = calculateInventoryPricingPreview({
    amount: selected.amount, currency: selected.currency, quantity: input.quantity,
    discountPercent: input.discountPercent, taxTreatment: selected.taxTreatment,
    components: taxProfile?.components || [],
  });
  return {
    source, priceKind: input.priceKind,
    priceVersionId: source === "saved" ? sourceResult.price.id : null,
    priceVersion: source === "saved" ? sourceResult.price.version : null,
    taxTreatment: selected.taxTreatment, taxProfileVersionId: selected.taxProfileVersionId || null,
    uomCode: sourceResult.part.uomCode, displayUomCode: sourceResult.part.displayUomCode,
    ...calculated,
  };
}
