import { AuthError, permissionDenied, resourceNotFound } from "../../auth/errors.js";
import { requireActor, requireLocationAccess } from "../../auth/authorize.js";
import { companyRoleScope, effectiveCompanyContext, effectiveCompanyRole } from "../../auth/company-role.js";
import { z } from "zod";
import { localLaborProductSnapshot } from "../../../../shared/labor-product.js";
import { getConfiguredLaborProduct, resolveLegacyLocalLaborProduct } from "../../db/repositories/labor-product.repo.js";
import { findAuthorizedInventoryLocation } from "../../db/repositories/inventory-count-imports.repo.js";
import {
  createLocalLaborProduct,
  findActiveLocalLaborProduct,
  listLocalLaborProducts,
  setLocalLaborProductPinned,
} from "../../db/repositories/local-labor-products.repo.js";
import {
  createLaborProductSchema,
  laborProductListSchema,
  pinLaborProductSchema,
  laborProductRatesSchema,
  laborProductRateRevisionSchema,
} from "./labor-products.schemas.js";
import { appendLaborRateVersion } from "../../db/repositories/workorder-labor-pricing.repo.js";
import { readEffectiveLaborPriceSources } from "../../db/repositories/workorder-labor-price-sources.repo.js";
import { createHash } from "node:crypto";

function capabilities(context, role = context?.actor?.role) {
  requireActor(context);
  return {
    canCreate: ["office", "admin"].includes(role),
    canPin: role === "admin",
  };
}

async function authorizedLocation(context, locationId, dependencies) {
  requireActor(context);
  const findLocation = dependencies.findLocation || findAuthorizedInventoryLocation;
  const location = await findLocation({
    locationId,
    companyIds: [...(context.companyIds || [])],
    locationIds: [...(context.locationIds || [])],
    isAdmin: context.actor.role === "admin",
  });
  if (!location) throw resourceNotFound("Location");
  const effectiveContext = effectiveCompanyContext(context, location.company_id);
  requireLocationAccess(effectiveContext, location.id, location.company_id);
  return { location, effectiveContext, role: effectiveCompanyRole(context, location.company_id) };
}

export async function readLaborProducts(searchParams, context, dependencies = {}) {
  requireActor(context);
  const input = laborProductListSchema.parse(Object.fromEntries(searchParams));
  const { location, role } = await authorizedLocation(context, input.locationId, dependencies);
  const list = dependencies.listProducts || listLocalLaborProducts;
  const products = await list({ companyId: location.company_id, locationId: location.id, q: input.q });
  const canReadCommercial = ["office", "admin"].includes(role);
  return {
    items: canReadCommercial ? products : products.map(({ odooPricing: _pricing, source: _source, ...product }) => product),
    ...capabilities(context, role),
  };
}

export async function addLaborProduct(input, context, dependencies = {}) {
  requireActor(context);
  if (!companyRoleScope(context, ["office", "admin"]).companyIds.length) throw permissionDenied();
  const parsed = createLaborProductSchema.parse(input);
  const { location, role } = await authorizedLocation(context, parsed.locationId, dependencies);
  if (!["office", "admin"].includes(role)) throw permissionDenied();
  const create = dependencies.createProduct || createLocalLaborProduct;
  const result = await create({
    companyId: location.company_id,
    name: parsed.name,
    code: parsed.code,
    description: parsed.description,
    uomCode: parsed.uomCode,
    actorId: context.actor.id,
  });
  if (result.kind === "duplicate") {
    throw new AuthError(409, "LABOR_PRODUCT_DUPLICATE", "That labor name or code already exists.");
  }
  return result.product;
}

export async function changeLaborProductPin(productId, input, context, dependencies = {}) {
  requireActor(context);
  if (!companyRoleScope(context, ["admin"]).companyIds.length) throw permissionDenied();
  const parsedProductId = z.string().uuid().safeParse(productId);
  if (!parsedProductId.success) throw resourceNotFound("Labor product");
  const parsed = pinLaborProductSchema.parse(input);
  const { location, role } = await authorizedLocation(context, parsed.locationId, dependencies);
  if (role !== "admin") throw permissionDenied();
  const setPinned = dependencies.setPinned || setLocalLaborProductPinned;
  const product = await setPinned({
    companyId: location.company_id,
    locationId: location.id,
    productId: parsedProductId.data,
    pinned: parsed.pinned,
    actorId: context.actor.id,
  });
  if (!product) throw resourceNotFound("Labor product");
  return product;
}

function publicRate(row) {
  return {
    id: row.id,
    productId: row.labor_product_id,
    locationId: row.location_id || null,
    priceKind: row.price_kind,
    version: Number(row.version),
    status: row.amount === null ? "unknown" : "known",
    amount: row.amount === null ? null : String(row.amount),
    currency: row.currency || null,
    sellingPolicyVersionId: row.selling_policy_version_id || null,
    configuredPriceVersionId: row.configured_price_version_id || null,
  };
}

export async function readLaborProductRates(productId, rawInput, context, dependencies = {}) {
  const id = z.string().uuid().parse(productId);
  const input = laborProductRatesSchema.parse(rawInput);
  const { location, role } = await authorizedLocation(context, input.locationId, dependencies);
  if (!["office", "admin"].includes(role) || context.sessionMode === "kiosk") throw permissionDenied();
  const product = await (dependencies.findProduct || findActiveLocalLaborProduct)({
    companyId: location.company_id, locationId: location.id, productId: id,
  });
  if (!product) throw resourceNotFound("Labor product");
  const rows = await (dependencies.readRates || readEffectiveLaborPriceSources)({
    companyId: location.company_id, locationId: location.id, productId: id,
  });
  return { productId: id, locationId: location.id,
    currentRates: Object.fromEntries(rows.map((row) => [row.price_kind, publicRate(row)])) };
}

export async function reviseLaborProductRate(productId, rawInput, context, dependencies = {}) {
  const id = z.string().uuid().parse(productId);
  const input = laborProductRateRevisionSchema.parse(rawInput);
  const { location, role } = await authorizedLocation(context, input.locationId, dependencies);
  if (!["office", "admin"].includes(role) || context.sessionMode === "kiosk") throw permissionDenied();
  if ((input.amount === null) !== (input.currency === null)) {
    throw new AuthError(400, "LABOR_RATE_INVALID", "Amount and currency must both be known or Unknown.");
  }
  const command = {
    companyId: location.company_id, productId: id, locationId: location.id,
    priceKind: input.priceKind, expectedVersion: input.expectedVersion,
    amount: input.amount, currency: input.currency, reason: input.reason,
    actorId: context.actor.id, idempotencyKey: input.idempotencyKey,
  };
  const result = await (dependencies.appendRate || appendLaborRateVersion)({
    ...command,
    requestHash: createHash("sha256").update(JSON.stringify(command)).digest("hex"),
  });
  if (result.kind === "not_found") throw resourceNotFound("Labor product");
  if (result.kind === "version_conflict") throw new AuthError(409, "LABOR_RATE_VERSION_CONFLICT", "Labor rate changed. Refresh and try again.");
  if (result.kind === "idempotency_conflict") throw new AuthError(409, "LABOR_RATE_REPLAY_CONFLICT", "This request key was used with different rate details.");
  return result;
}

export async function trustedLocalLaborProduct({ productId, companyId, locationId }, context, dependencies = {}) {
  requireActor(context);
  if (!productId) return null;
  if (!locationId) throw new AuthError(400, "LABOR_PRODUCT_LOCATION_REQUIRED", "Select a workorder location before choosing labor.");
  const { location } = await authorizedLocation(context, locationId, dependencies);
  if (location.company_id !== companyId) throw permissionDenied();
  const findProduct = dependencies.findProduct || findActiveLocalLaborProduct;
  const product = await findProduct({ companyId, locationId, productId });
  if (!product) throw resourceNotFound("Labor product");
  return localLaborProductSnapshot(product);
}

export async function resolveSubmittedLaborProduct({ companyId, locationId, selection }, context, dependencies = {}) {
  if (selection == null) {
    return (dependencies.loadDefault || getConfiguredLaborProduct)(companyId);
  }
  if (selection.productId) {
    return (dependencies.resolveLocal || trustedLocalLaborProduct)({
      companyId, locationId, productId: selection.productId,
    }, context);
  }
  if (selection.externalId) {
    const product = await (dependencies.resolveLegacy || resolveLegacyLocalLaborProduct)({
      companyId, legacyProduct: selection,
    });
    if (product) return product;
  }
  throw new AuthError(422, "WORKORDER_LABOR_PRODUCT_UNAVAILABLE", "Selected labor product is unavailable. Choose an active local labor product.");
}
