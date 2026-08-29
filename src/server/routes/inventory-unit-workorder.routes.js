import { ZodError } from "zod";
import { InventoryError } from "../modules/inventory/inventory.errors.js";
import {
  finalizeSerializedUnitForWorkorder,
  issueSerializedUnitForWorkorder,
  readSerializedUnitUsagesForWorkorder,
  resolveSerializedUnitForWorkorder,
} from "../modules/inventory/inventory-unit-workorder.service.js";

function matchPath(pathname) {
  const resolve = /^\/api\/workorders\/([^/]+)\/inventory-units\/resolve$/.exec(pathname);
  if (resolve) return { action: "resolve", workorderId: decodeURIComponent(resolve[1]) };
  const issue = /^\/api\/workorders\/([^/]+)\/inventory-units\/issue$/.exec(pathname);
  if (issue) return { action: "issue", workorderId: decodeURIComponent(issue[1]) };
  const list = /^\/api\/workorders\/([^/]+)\/inventory-unit-usages$/.exec(pathname);
  if (list) return { action: "list", workorderId: decodeURIComponent(list[1]) };
  const finalize = /^\/api\/workorders\/([^/]+)\/inventory-unit-usages\/([^/]+)\/finalize$/.exec(pathname);
  return finalize ? {
    action: "finalize",
    workorderId: decodeURIComponent(finalize[1]),
    usageId: decodeURIComponent(finalize[2]),
  } : null;
}

function sendError(sendJson, res, error) {
  if (error instanceof ZodError) {
    sendJson(res, 400, {
      error: "Invalid serialized-part request.",
      code: "validation_error",
      issues: error.issues,
    });
    return true;
  }
  if (error instanceof InventoryError) {
    sendJson(res, error.statusCode, {
      error: error.message,
      code: error.code,
      retryable: error.retryable,
    });
    return true;
  }
  return false;
}

export async function handleInventoryUnitWorkorderApi(req, res, url, helpers, dependencies = {}) {
  const route = matchPath(url.pathname);
  if (!route) return false;
  try {
    if (req.method === "POST" && route.action === "resolve") {
      helpers.sendJson(res, 200, await resolveSerializedUnitForWorkorder(
        route.workorderId,
        await helpers.readBody(req),
        helpers.requestContext,
        dependencies,
      ));
      return true;
    }
    if (req.method === "POST" && route.action === "issue") {
      helpers.sendJson(res, 201, await issueSerializedUnitForWorkorder(
        route.workorderId,
        await helpers.readBody(req),
        helpers.requestContext,
        dependencies,
      ));
      return true;
    }
    if (req.method === "GET" && route.action === "list") {
      helpers.sendJson(res, 200, await readSerializedUnitUsagesForWorkorder(
        route.workorderId,
        helpers.requestContext,
        dependencies,
      ));
      return true;
    }
    if (req.method === "POST" && route.action === "finalize") {
      helpers.sendJson(res, 200, await finalizeSerializedUnitForWorkorder(
        route.workorderId,
        route.usageId,
        await helpers.readBody(req),
        helpers.requestContext,
        dependencies,
      ));
      return true;
    }
    helpers.sendJson(res, 405, { error: "Unsupported serialized-part action." });
    return true;
  } catch (error) {
    if (sendError(helpers.sendJson, res, error)) return true;
    throw error;
  }
}
