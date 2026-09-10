import { AuthError, permissionDenied, resourceNotFound } from "../../auth/errors.js";
import { requireActor } from "../../auth/authorize.js";
import { z } from "zod";
import { localLaborProductSnapshot } from "../../../../shared/labor-product.js";
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
} from "./labor-products.schemas.js";

function capabilities(context) {
  requireActor(context);
  return {
    canCreate: ["office", "admin"].includes(context.actor.role),
    canPin: context.actor.role === "admin",
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
  return location;
}

export async function readLaborProducts(searchParams, context, dependencies = {}) {
  requireActor(context);
  const input = laborProductListSchema.parse(Object.fromEntries(searchParams));
  const location = await authorizedLocation(context, input.locationId, dependencies);
  const list = dependencies.listProducts || listLocalLaborProducts;
  return {
    items: await list({ companyId: location.company_id, locationId: location.id, q: input.q }),
    ...capabilities(context),
  };
}

export async function addLaborProduct(input, context, dependencies = {}) {
  requireActor(context);
  if (!["office", "admin"].includes(context.actor.role)) throw permissionDenied();
  const parsed = createLaborProductSchema.parse(input);
  const location = await authorizedLocation(context, parsed.locationId, dependencies);
  const create = dependencies.createProduct || createLocalLaborProduct;
  const result = await create({
    companyId: location.company_id,
    name: parsed.name,
    code: parsed.code,
    actorId: context.actor.id,
  });
  if (result.kind === "duplicate") {
    throw new AuthError(409, "LABOR_PRODUCT_DUPLICATE", "That labor name or code already exists.");
  }
  return result.product;
}

export async function changeLaborProductPin(productId, input, context, dependencies = {}) {
  requireActor(context);
  if (context.actor.role !== "admin") throw permissionDenied();
  const parsedProductId = z.string().uuid().safeParse(productId);
  if (!parsedProductId.success) throw resourceNotFound("Labor product");
  const parsed = pinLaborProductSchema.parse(input);
  const location = await authorizedLocation(context, parsed.locationId, dependencies);
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

export async function trustedLocalLaborProduct({ productId, companyId, locationId }, context, dependencies = {}) {
  requireActor(context);
  if (!productId) return null;
  if (!locationId) throw new AuthError(400, "LABOR_PRODUCT_LOCATION_REQUIRED", "Select a workorder location before choosing labor.");
  const location = await authorizedLocation(context, locationId, dependencies);
  if (location.company_id !== companyId) throw permissionDenied();
  const findProduct = dependencies.findProduct || findActiveLocalLaborProduct;
  const product = await findProduct({ companyId, locationId, productId });
  if (!product) throw resourceNotFound("Labor product");
  return localLaborProductSnapshot(product);
}
