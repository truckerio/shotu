import {
  listInventoryTaxProfiles,
  createInventoryTaxProfile,
  reviseInventoryTaxProfile,
  setInventoryTaxProfileArchived,
} from "./inventory-tax-profiles.service.js";
import { previewInventoryPartPrice, updateInventoryLocationPartPrice } from "./inventory-part-prices.service.js";

// Use the existing Inventory error boundary and service permission checks.
export async function handleInventoryPricingApi(req, res, url, helpers, dependencies = {}) {
  const { requestContext, readBody, sendJson } = helpers;
  if (url.pathname === "/api/office/inventory/tax-profiles") {
    if (req.method === "GET") {
      sendJson(res, 200, await listInventoryTaxProfiles(url.searchParams, requestContext, dependencies));
      return true;
    }
    if (req.method === "POST") {
      sendJson(res, 201, await createInventoryTaxProfile(await readBody(req), requestContext, dependencies));
      return true;
    }
  }
  const profile = /^\/api\/office\/inventory\/tax-profiles\/([^/]+)(\/archive)?$/.exec(url.pathname);
  if (profile && req.method === "PUT" && !profile[2]) {
    sendJson(res, 200, await reviseInventoryTaxProfile(decodeURIComponent(profile[1]), await readBody(req), requestContext, dependencies));
    return true;
  }
  if (profile && req.method === "PATCH" && profile[2]) {
    sendJson(res, 200, await setInventoryTaxProfileArchived(decodeURIComponent(profile[1]), await readBody(req), requestContext, dependencies));
    return true;
  }
  const preview = /^\/api\/office\/inventory\/parts\/([^/]+)\/pricing-preview$/.exec(url.pathname);
  if (preview && req.method === "POST") {
    sendJson(res, 200, await previewInventoryPartPrice(decodeURIComponent(preview[1]), await readBody(req), requestContext, dependencies));
    return true;
  }
  const locationPreview = /^\/api\/office\/inventory\/parts\/([^/]+)\/locations\/([^/]+)\/pricing-preview$/.exec(url.pathname);
  if (locationPreview && req.method === "POST") {
    sendJson(res, 200, await previewInventoryPartPrice(
      decodeURIComponent(locationPreview[1]),
      await readBody(req),
      requestContext,
      dependencies,
      decodeURIComponent(locationPreview[2]),
    ));
    return true;
  }
  const locationPrice = /^\/api\/office\/inventory\/parts\/([^/]+)\/locations\/([^/]+)\/prices\/([^/]+)$/.exec(url.pathname);
  if (locationPrice && req.method === "PUT") {
    sendJson(res, 200, await updateInventoryLocationPartPrice(
      decodeURIComponent(locationPrice[1]),
      decodeURIComponent(locationPrice[2]),
      decodeURIComponent(locationPrice[3]),
      await readBody(req),
      requestContext,
      dependencies,
    ));
    return true;
  }
  return false;
}
