import { z } from "zod";
import {
  createOdooDraftSchema,
  mapOdooWorkorderPartSchema,
  prepareOdooWorkorderSchema,
} from "../integrations/odoo/odoo.outbound.schemas.js";
import {
  createWorkorderOdooDraft,
  mapWorkorderOdooPart,
  markWorkorderOdooMissingInfo,
  prepareWorkorderOdooModule,
  workorderOdooReadiness,
} from "../modules/workorders/workorder-odoo-module.service.js";
import { permissionDenied } from "../auth/errors.js";
import {
  moduleActionSchema,
  modulePatchSchema,
} from "../modules/workorders/workorder-module-runtime.registry.js";
import {
  patchWorkorderModule,
  protectedWorkorderDetail,
  readWorkorderModuleRuntime,
  readWorkorderUnitHistory,
  runWorkorderModuleAction,
  createWorkorderRuntime,
  workorderCreateContext,
} from "../modules/workorders/workorder-module-runtime.service.js";
import { createWorkorderSchema } from "../modules/workorders/workorder.schemas.js";

const missingInfoSchema = z.object({
  note: z.string().trim().min(1).max(1000),
}).strict();

function validated(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) {
    const error = new Error(result.error.issues[0]?.message || "Invalid Odoo module request.");
    error.statusCode = 400;
    throw error;
  }
  return result.data;
}

function odooModuleRoute(pathname) {
  const match = /^\/api\/workorders\/([^/]+)\/modules\/odoo\/(readiness|preparation|part-mapping|draft|missing-info)$/.exec(pathname);
  return match ? {
    workorderId: decodeURIComponent(match[1]),
    action: match[2],
  } : null;
}

function genericModuleRoute(pathname) {
  const root = /^\/api\/workorders\/([^/]+)\/modules$/.exec(pathname);
  if (root) return { workorderId: decodeURIComponent(root[1]), moduleKey: null, action: null };
  const match = /^\/api\/workorders\/([^/]+)\/modules\/([^/]+)(?:\/actions\/([^/]+))?$/.exec(pathname);
  return match ? {
    workorderId: decodeURIComponent(match[1]),
    moduleKey: decodeURIComponent(match[2]),
    action: match[3] ? decodeURIComponent(match[3]) : null,
  } : null;
}

function unitHistoryRoute(pathname) {
  const match = /^\/api\/workorders\/([^/]+)\/modules\/unit\/history$/.exec(pathname);
  return match ? { workorderId: decodeURIComponent(match[1]) } : null;
}

export async function handleWorkorderModulesApi(req, res, url, helpers, dependencies = {}) {
  const { sendJson, readBody, requestContext } = helpers;
  if (req.method === "GET" && url.pathname === "/api/workorders/create-context") {
    const loadCreateContext = dependencies.createContext || workorderCreateContext;
    sendJson(res, 200, await loadCreateContext(requestContext));
    return true;
  }
  if (req.method === "POST" && url.pathname === "/api/workorders") {
    const rawInput = await readBody(req);
    const input = validated(createWorkorderSchema, rawInput);
    const createWorkorder = dependencies.createWorkorder || createWorkorderRuntime;
    sendJson(res, 201, { workorder: await createWorkorder(requestContext, input, rawInput) });
    return true;
  }
  const historyRoute = unitHistoryRoute(url.pathname);
  const route = historyRoute ? null : odooModuleRoute(url.pathname);
  const genericRoute = route || historyRoute ? null : genericModuleRoute(url.pathname);
  if (!historyRoute && !route && !genericRoute) return false;

  const readiness = dependencies.readiness || workorderOdooReadiness;
  const prepare = dependencies.prepare || prepareWorkorderOdooModule;
  const createDraft = dependencies.createDraft || createWorkorderOdooDraft;
  const mapPart = dependencies.mapPart || mapWorkorderOdooPart;
  const markMissingInfo = dependencies.markMissingInfo || markWorkorderOdooMissingInfo;
  const readDetail = dependencies.readDetail || protectedWorkorderDetail;
  const readModule = dependencies.readModule || readWorkorderModuleRuntime;
  const patchModule = dependencies.patchModule || patchWorkorderModule;
  const runAction = dependencies.runAction || runWorkorderModuleAction;
  const readUnitHistory = dependencies.readUnitHistory || readWorkorderUnitHistory;

  if (historyRoute) {
    if (req.method !== "GET") return false;
    sendJson(res, 200, await readUnitHistory(requestContext, historyRoute.workorderId, {
      limit: url.searchParams.get("limit") || undefined,
      cursor: url.searchParams.get("cursor") || null,
    }));
    return true;
  }

  if (genericRoute) {
    if (req.method === "GET" && !genericRoute.moduleKey) {
      sendJson(res, 200, await readDetail(requestContext, genericRoute.workorderId));
      return true;
    }
    if (req.method === "GET" && genericRoute.moduleKey && !genericRoute.action) {
      sendJson(res, 200, await readModule(requestContext, genericRoute.workorderId, genericRoute.moduleKey));
      return true;
    }
    if (req.method === "PATCH" && genericRoute.moduleKey && !genericRoute.action) {
      const schema = modulePatchSchema(genericRoute.moduleKey);
      if (!schema) throw permissionDenied();
      const input = validated(schema, await readBody(req));
      sendJson(res, 200, { result: await patchModule(
        requestContext, genericRoute.workorderId, genericRoute.moduleKey, input,
      ) });
      return true;
    }
    if (req.method === "POST" && genericRoute.moduleKey && genericRoute.action) {
      const schema = moduleActionSchema(genericRoute.moduleKey, genericRoute.action);
      if (!schema) throw permissionDenied();
      const input = validated(schema, await readBody(req));
      sendJson(res, 200, { result: await runAction(
        requestContext,
        genericRoute.workorderId,
        genericRoute.moduleKey,
        genericRoute.action,
        { ...input, requestId: req.requestId },
      ) });
      return true;
    }
    return false;
  }

  if (req.method === "GET" && route.action === "readiness") {
    sendJson(res, 200, await readiness(requestContext, route.workorderId));
    return true;
  }

  if (req.method === "PUT" && route.action === "preparation") {
    const input = validated(prepareOdooWorkorderSchema, await readBody(req));
    sendJson(res, 200, await prepare(requestContext, route.workorderId, input));
    return true;
  }

  if (req.method === "POST" && route.action === "draft") {
    const input = validated(createOdooDraftSchema, await readBody(req));
    sendJson(res, 201, await createDraft(requestContext, route.workorderId, {
      ...input,
      requestId: req.requestId,
    }));
    return true;
  }

  if (req.method === "PUT" && route.action === "part-mapping") {
    const input = validated(mapOdooWorkorderPartSchema, await readBody(req));
    sendJson(res, 200, await mapPart(requestContext, route.workorderId, {
      ...input,
      requestId: req.requestId,
    }));
    return true;
  }

  if (req.method === "POST" && route.action === "missing-info") {
    const input = validated(missingInfoSchema, await readBody(req));
    sendJson(res, 200, {
      odooEntry: await markMissingInfo(requestContext, route.workorderId, input),
    });
    return true;
  }

  return false;
}
