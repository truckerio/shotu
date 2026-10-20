import { createHash } from "node:crypto";
import { effectiveCompanyContext } from "../../auth/company-role.js";
import { requireWorkorderAccess } from "../../auth/resource-access.js";
import {
  readWorkorderPartConfiguredSources,
  readWorkorderPartPriceCommandReplay,
  readWorkorderPartPricingSource,
  saveWorkorderPartPriceSnapshot,
} from "../../db/repositories/workorder-part-pricing.repo.js";
import { priceCreateAllocations, readCreatePricing } from "../../db/repositories/workorder-create-pricing.repo.js";
import { InventoryError, inventoryNotFound } from "../inventory/inventory.errors.js";

function fail(code, message, statusCode = 409) {
  throw new InventoryError(message, { code, statusCode });
}

function scaledDecimal(value, digits) {
  const match = new RegExp(`^(\\d+)(?:\\.(\\d{1,${digits}}))?$`).exec(String(value));
  if (!match) throw new TypeError("Invalid decimal value.");
  return BigInt(match[1]) * 10n ** BigInt(digits) + BigInt((match[2] || "").padEnd(digits, "0"));
}

const fixedMoney = (value) => `${value / 10000n}.${String(value % 10000n).padStart(4, "0")}`;

function configuredInternalOption(source, quantity, uomCode) {
  if (source?.configured_amount === null || source?.configured_amount === undefined || !source.configured_currency) {
    return { status: "incomplete", price: null, reason: "Configure an internal cost for this item." };
  }
  const unit = scaledDecimal(source.configured_amount, 4);
  const quantityValue = scaledDecimal(quantity, 3);
  const unitPrice = fixedMoney(unit);
  return { status: "known", price: {
    selection: "internal_cost", quantity: String(quantity), uomCode,
    unitPrice, totalPrice: fixedMoney((unit * quantityValue + 500n) / 1000n), currency: source.configured_currency,
    configuredPriceVersionId: source.configured_price_version_id, allocations: [],
  } };
}

function previewFingerprint(workorderId, identity, options) {
  return createHash("sha256").update(JSON.stringify({ workorderId, identity, options })).digest("hex");
}

export function buildCandidatePricingPreview(workorderId, identity, options) {
  return { ...identity, fingerprint: previewFingerprint(workorderId, identity, options), options };
}

export function buildSavedPhysicalPricingPreview(workorderId, usageKind, usageId, source, configured) {
  const part = { catalogPartId: source.catalog_part_id, quantity: String(source.quantity), uomCode: source.uom_code };
  const canonical = {
    usageKind, usageId, noStockLineId: null, catalogPartId: part.catalogPartId,
    partNumber: source.part_number, uomCode: part.uomCode, locationId: source.location_id,
    quantity: part.quantity,
  };
  const policy = configured?.selling_policy_version_id ? {
    id: configured.selling_policy_version_id, method: configured.policy_method,
    value: configured.policy_value, currency: configured.policy_currency,
  } : null;
  const option = (selection) => {
    try {
      const price = priceCreateAllocations(source.allocations, selection, policy, part.quantity);
      if (usageKind === "serialized") {
        price.receiptLineId = source.allocations[0]?.receiptLineId || null;
        price.allocations = [];
      }
      return { status: "known", price };
    } catch (error) { return { status: "incomplete", price: null, reason: error.message }; }
  };
  const options = {
    batch_cost: option("batch_cost"),
    internal_cost: configuredInternalOption(configured, part.quantity, part.uomCode),
    selling_price: option("selling_price"),
  };
  return { ...canonical, fingerprint: previewFingerprint(workorderId, canonical, options), options };
}

function previewInput(workorder, part, details = {}) {
  return {
    companyId: workorder.companyId,
    locationId: workorder.locationId,
    formData: { parts: [{ catalogPartId: part.catalogPartId, qty: part.quantity, uomCode: part.uomCode }], laborHours: 0, laborProduct: null },
    inventoryUnitSelections: details.unitId ? [{ partIndex: 0, unitIds: [details.unitId] }] : [],
    inventoryPositionSelections: details.sourcePositionId ? [{ partIndex: 0, positionId: details.sourcePositionId }] : [],
    pricing: { parts: [] },
  };
}

function scopeFor(context, workorder) {
  return {
    companyIds: [...(context.companyIds || [])],
    locationIds: [...(context.locationIds || [])],
    isAdmin: context.actor.role === "admin",
    workorderId: workorder.id,
  };
}

export async function previewWorkorderPartPricing(workorderId, input, context, dependencies = {}) {
  const workorder = dependencies.authorizedWorkorder
    || await (dependencies.requireAccess || requireWorkorderAccess)(context, workorderId);
  context = effectiveCompanyContext(context, workorder.companyId);
  if (!['office', 'admin'].includes(context.actor.role) || context.sessionMode === 'kiosk') {
    fail("WORKORDER_PART_PRICE_FORBIDDEN", "Only Office or Admin may view part prices.", 403);
  }
  const readPricing = dependencies.readCreatePricing || readCreatePricing;
  const sourceScope = scopeFor(context, workorder);
  const candidate = async (part, details, identity) => {
    const result = await readPricing(previewInput(workorder, part, details), dependencies.transactionClient || null);
    const options = result.parts[0]?.options || {};
    return buildCandidatePricingPreview(workorderId, identity, options);
  };

  if (input.serializedUnitIds?.length) {
    const part = { catalogPartId: input.catalogPartId, quantity: 1, uomCode: input.uomCode || "ea" };
    const serializedUnits = await Promise.all(input.serializedUnitIds.map((unitId) => candidate(
      part, { unitId }, { usageKind: "serialized", unitId, ...part },
    )));
    return { usageKind: "serialized", catalogPartId: part.catalogPartId, serializedUnits };
  }
  if (input.catalogPartId && input.sourcePositionId) {
    const part = { catalogPartId: input.catalogPartId, quantity: input.quantity, uomCode: input.uomCode };
    return candidate(part, { sourcePositionId: input.sourcePositionId }, {
      usageKind: "aggregate", sourcePositionId: input.sourcePositionId, ...part,
    });
  }

  const source = await (dependencies.readPricingSource || readWorkorderPartPricingSource)({
    ...sourceScope,
    usageKind: input.usageKind,
    usageId: input.usageId,
    noStockLineId: input.noStockLineId,
  }, dependencies.transactionClient || null);
  if (!source) throw inventoryNotFound();
  const part = { catalogPartId: source.catalog_part_id, quantity: String(source.quantity), uomCode: source.uom_code };
  const canonical = {
    usageKind: input.usageKind, usageId: input.usageId || null, noStockLineId: input.noStockLineId || null,
    catalogPartId: part.catalogPartId, partNumber: source.part_number, uomCode: part.uomCode,
    locationId: source.location_id, quantity: part.quantity,
  };
  if (input.usageKind === "no_stock") {
    return { ...canonical, ...(await candidate(part, { unitId: source.unit_id }, canonical)) };
  }
  const configured = await (dependencies.readConfiguredSources || readWorkorderPartConfiguredSources)({
    companyId: source.company_id, locationId: source.location_id, catalogPartId: source.catalog_part_id,
  }, dependencies.transactionClient || null);
  return buildSavedPhysicalPricingPreview(workorderId, input.usageKind, input.usageId, source, configured);
}

export async function selectWorkorderPartPrice(workorderId, input, context, dependencies = {}) {
  const workorder = dependencies.authorizedWorkorder
    || await (dependencies.requireAccess || requireWorkorderAccess)(context, workorderId);
  context = effectiveCompanyContext(context, workorder.companyId);
  if (!["office", "admin"].includes(context.actor.role) || context.sessionMode === "kiosk") {
    fail("WORKORDER_PART_PRICE_FORBIDDEN", "Only Office or Admin may select part prices.", 403);
  }
  const noStock = input.usageKind === "no_stock";
  if ((noStock && (!input.noStockLineId || input.usageId))
    || (!noStock && (!input.usageId || input.noStockLineId))) {
    fail("WORKORDER_PART_PRICE_IDENTITY_INVALID", "Choose one canonical Workorder part line to price.", 422);
  }
  if (noStock && input.selection === "batch_cost") {
    fail("WORKORDER_BATCH_COST_UNAVAILABLE", "No-stock items have no receipt batch cost. Select a configured price.", 422);
  }
  if (!input.expectedFingerprint) {
    fail("WORKORDER_PRICING_PREVIEW_REQUIRED", "Refresh the pricing preview before selecting this price.");
  }
  const command = {
    workorderId,
    usageKind: input.usageKind,
    ...(noStock ? { noStockLineId: input.noStockLineId } : { usageId: input.usageId }),
    selection: input.selection,
    ...(input.customUnitPrice !== undefined ? { customUnitPrice: input.customUnitPrice } : {}),
    expectedFingerprint: input.expectedFingerprint,
    reason: input.reason,
  };
  const requestHash = createHash("sha256").update(JSON.stringify(command)).digest("hex");
  const replay = await (dependencies.readPriceReplay || readWorkorderPartPriceCommandReplay)({
    companyIds: [...(context.companyIds || [])], actorId: context.actor.id,
    idempotencyKey: input.idempotencyKey, requestHash,
  });
  if (replay?.kind === "saved") return replay;
  if (replay?.kind === "idempotency_conflict") {
    fail("WORKORDER_PART_PRICE_REPLAY_CONFLICT", "This price request key was used with different details.");
  }
  const preview = await (dependencies.previewPricing || previewWorkorderPartPricing)(workorderId, {
    usageKind: input.usageKind,
    usageId: input.usageId,
    noStockLineId: input.noStockLineId,
  }, context, { ...dependencies, authorizedWorkorder: workorder });
  if (preview.fingerprint !== input.expectedFingerprint
    || preview.options?.[input.selection]?.status !== "known") {
    fail("WORKORDER_PRICING_CHANGED", "Part pricing changed. Refresh the preview and try again.");
  }
  const result = await (dependencies.savePartPrice || saveWorkorderPartPriceSnapshot)({
    ...command,
    actorId: context.actor.id,
    companyIds: [...(context.companyIds || [])],
    locationIds: [...(context.locationIds || [])],
    isAdmin: context.actor.role === "admin",
    idempotencyKey: input.idempotencyKey,
    requestHash,
    // The repository calls this after locking the exact usage/workorder, in its
    // snapshot transaction. No newer rate or quantity can replace the preview.
    revalidatePreview: async (transactionClient) => {
      const current = await (dependencies.previewPricing || previewWorkorderPartPricing)(workorderId, {
        usageKind: input.usageKind, usageId: input.usageId, noStockLineId: input.noStockLineId,
      }, context, { ...dependencies, authorizedWorkorder: workorder, transactionClient });
      return current.fingerprint === input.expectedFingerprint && current.options?.[input.selection]?.status === "known";
    },
  });
  if (result.kind === "pricing_changed") fail("WORKORDER_PRICING_CHANGED", "Part pricing changed. Refresh the preview and try again.");
  if (result.kind === "not_found") throw inventoryNotFound();
  if (result.kind === "locked") {
    fail("WORKORDER_PART_PRICE_LOCKED", "Part prices cannot change after the workorder is closed.");
  }
  if (result.kind === "batch_cost_unavailable") {
    fail(
      "WORKORDER_BATCH_COST_UNAVAILABLE",
      "Exact batch cost is unavailable for this part. No latest or average cost was substituted.",
      422,
    );
  }
  if (result.kind === "selling_policy_unavailable") {
    fail("WORKORDER_SELLING_POLICY_UNAVAILABLE", "Configure a selling policy for this part first.", 422);
  }
  if (result.kind === "configured_price_unavailable") {
    fail("WORKORDER_CONFIGURED_COST_UNAVAILABLE", "Configure an internal cost for this no-stock item first.", 422);
  }
  if (result.kind === "currency_unavailable") {
    fail("WORKORDER_PART_PRICE_CURRENCY_UNAVAILABLE", "Price currency is unavailable.", 422);
  }
  if (result.kind === "idempotency_conflict") {
    fail("WORKORDER_PART_PRICE_REPLAY_CONFLICT", "This price request key was used with different details.");
  }
  return result;
}
