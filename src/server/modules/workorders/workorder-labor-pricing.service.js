import { createHash } from "node:crypto";
import { InventoryError } from "../inventory/inventory.errors.js";
import { validLaborQuantity } from "../../../../shared/labor-product.js";
import {
  appendLaborRateVersion,
  saveWorkorderLaborPriceSnapshot,
} from "../../db/repositories/workorder-labor-pricing.repo.js";

function fail(code, message, statusCode = 409) {
  throw new InventoryError(message, { code, statusCode });
}

function financialActor(context) {
  if (!["office", "admin"].includes(context.actor.role)) {
    fail("WORKORDER_LABOR_PRICE_FORBIDDEN", "Only Office or Admin may manage labor prices.", 403);
  }
}

function digest(command) {
  return createHash("sha256").update(JSON.stringify(command)).digest("hex");
}

export async function reviseWorkorderLaborRate(workorderId, input, context, authorization, dependencies = {}) {
  financialActor(context);
  if (["closed", "odoo_entered", "cancelled"].includes(authorization.workorder?.status)) {
    fail("WORKORDER_LABOR_PRICE_LOCKED", "Labor pricing cannot change after this workorder is closed.");
  }
  if (context.actor.role === "office" && (!input.locationId || !authorization.locationId)) {
    fail("WORKORDER_LABOR_RATE_LOCATION_FORBIDDEN", "Office must configure a rate for this workorder's location.", 403);
  }
  if ((input.amount === null) !== (input.currency === null)) {
    fail("WORKORDER_LABOR_RATE_INVALID", "Amount and currency must both be known or Unknown.", 400);
  }
  if (input.locationId && input.locationId !== authorization.locationId) {
    fail("WORKORDER_LABOR_RATE_LOCATION_FORBIDDEN", "Rate location must match this workorder.", 403);
  }
  const command = {
    workorderId,
    productId: input.productId,
    locationId: input.locationId || null,
    priceKind: input.priceKind,
    expectedVersion: input.expectedVersion,
    amount: input.amount,
    currency: input.currency || null,
    reason: input.reason,
  };
  const result = await (dependencies.appendLaborRate || appendLaborRateVersion)({
    companyId: authorization.companyId,
    ...command,
    actorId: context.actor.id,
    idempotencyKey: input.idempotencyKey,
    requestHash: digest(command),
  });
  if (result.kind === "not_found") fail("WORKORDER_LABOR_PRODUCT_NOT_FOUND", "Active labor product or location was not found.", 404);
  if (result.kind === "version_conflict") fail("WORKORDER_LABOR_RATE_VERSION_CONFLICT", "Labor rate changed. Refresh and try again.");
  if (result.kind === "idempotency_conflict") fail("WORKORDER_LABOR_RATE_REPLAY_CONFLICT", "This request key was used with different rate details.");
  return result;
}

export async function selectWorkorderLaborPrice(workorderId, input, context, dependencies = {}) {
  financialActor(context);
  const command = {
    workorderId,
    selection: input.selection,
    expectedRateVersionId: input.expectedRateVersionId || null,
    reason: input.reason,
  };
  const result = await (dependencies.saveLaborPrice || saveWorkorderLaborPriceSnapshot)({
    ...command,
    actorId: context.actor.id,
    companyIds: [...(context.companyIds || [])],
    locationIds: [...(context.locationIds || [])],
    isAdmin: context.actor.role === "admin",
    idempotencyKey: input.idempotencyKey,
    requestHash: digest(command),
  });
  if (result.kind === "not_found") fail("WORKORDER_LABOR_PRICE_NOT_FOUND", "Workorder was not found.", 404);
  if (result.kind === "locked") fail("WORKORDER_LABOR_PRICE_LOCKED", "Labor price cannot change after this workorder is closed.");
  if (result.kind === "labor_incomplete") fail("WORKORDER_LABOR_INCOMPLETE", "Select a labor product and enter a valid quantity for its unit first.", 422);
  if (result.kind === "rate_unavailable") fail("WORKORDER_LABOR_RATE_UNAVAILABLE", "A known local labor rate and currency are required.", 422);
  if (result.kind === "rate_changed") fail("WORKORDER_LABOR_RATE_CHANGED", "Labor rate changed. Refresh and select it again.");
  if (result.kind === "idempotency_conflict") fail("WORKORDER_LABOR_PRICE_REPLAY_CONFLICT", "This request key was used with different details.");
  return result;
}

function sameHours(left, right) {
  const a = Number(left);
  const b = Number(right);
  return Number.isFinite(a) && Number.isFinite(b) && a === b;
}

function amount(value) {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,4})?$/.test(String(value))) return null;
  const [whole, fraction = ""] = String(value).split(".");
  return BigInt(whole) * 10000n + BigInt(fraction.padEnd(4, "0"));
}

function formatted(value) {
  return `${value / 10000n}.${(value % 10000n).toString().padStart(4, "0")}`;
}

export function workorderPricingSummary({
  workorder,
  installedSerializedParts = [],
  aggregatePartUsages = [],
  laborPrice = null,
  pricingRowsTruncated = false,
}) {
  const form = workorder?.formData || {};
  const manual = (Array.isArray(form.parts) ? form.parts : []).filter((part) => Number(part?.qty) > 0);
  const aggregate = aggregatePartUsages.filter((usage) => !["released", "reversed"].includes(usage.status));
  const laborExpected = Number(form.laborHours) > 0;
  const laborQuantityValid = validLaborQuantity(form.laborHours, form.laborProduct?.uomCode || "hr");
  const laborCurrent = laborExpected && laborPrice
    && laborQuantityValid
    && laborPrice.productId === form.laborProduct?.productId
    && (laborPrice.uomCode || "hr") === (form.laborProduct?.uomCode || "hr")
    && sameHours(laborPrice.hours, form.laborHours);
  const rows = [
    ...installedSerializedParts.map((part) => ({ kind: "part", price: part.price, quantity: 1, requiresQuantity: false })),
    ...aggregate.map((part) => ({ kind: "part", price: part.price, quantity: part.effectiveQuantity, requiresQuantity: true })),
  ];
  if (laborExpected) rows.push({ kind: "labor", price: laborCurrent ? laborPrice : null, quantity: form.laborHours });
  let missingCount = manual.length + (pricingRowsTruncated ? 1 : 0);
  const currencies = new Set();
  const bases = new Set();
  let partsTotal = 0n;
  let laborTotal = 0n;
  for (const row of rows) {
    const price = row.price;
    const quantityRecorded = row.requiresQuantity ? price?.quantity : price?.quantity ?? price?.hours ?? row.quantity;
    const total = price && sameHours(quantityRecorded, row.quantity)
      ? amount(price.totalPrice)
      : null;
    if (total === null || !price.currency) {
      missingCount += 1;
      continue;
    }
    currencies.add(price.currency);
    bases.add(price.selection === "batch_cost" || price.selection === "internal_cost" ? "internal" : "selling");
    if (row.kind === "labor") laborTotal += total;
    else partsTotal += total;
  }
  const mixedCurrency = currencies.size > 1;
  const rowCount = rows.length + manual.length + (pricingRowsTruncated ? 1 : 0);
  const complete = rowCount > 0 && missingCount === 0 && !mixedCurrency && bases.size <= 1;
  const currency = currencies.size === 1 ? [...currencies][0] : null;
  return {
    status: mixedCurrency ? "mixed_currency" : complete ? "complete" : "incomplete",
    currency,
    partsTotal: complete ? formatted(partsTotal) : null,
    laborTotal: complete ? formatted(laborTotal) : null,
    grandTotal: complete ? formatted(partsTotal + laborTotal) : null,
    missingCount,
    rowCount,
    ...(bases.size > 1 ? { reason: "mixed_price_basis" } : {}),
  };
}
