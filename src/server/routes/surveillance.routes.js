import {
  authorizeWorkorderModule,
  resolveWorkorderModuleDecisions,
} from "../modules/workorders/workorder-module-access.service.js";
import { projectProtectedWorkorderDetail } from "../modules/workorders/workorder-module-projection.js";
import {
  markOdooEntered,
  surveillanceDashboard,
  surveillanceWorkorderDetail,
} from "../modules/surveillance/surveillance.service.js";
import {
  createWorkorderOdooDraft,
  markWorkorderOdooMissingInfo,
  prepareWorkorderOdooModule,
  workorderOdooReadiness,
} from "../modules/workorders/workorder-odoo-module.service.js";
import { z } from "zod";
import { requireWorkorderAccess } from "../auth/resource-access.js";
import {
  createOdooDraftSchema,
  prepareOdooWorkorderSchema,
} from "../integrations/odoo/odoo.outbound.schemas.js";

const markOdooEnteredSchema = z.object({
  odooServiceOrderNo: z.string().trim().max(120).default(""),
  note: z.string().trim().max(1000).default(""),
});

const markMissingInfoSchema = z.object({
  note: z.string().trim().min(1).max(1000),
});

function validated(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) {
    const error = new Error(result.error.issues[0]?.message || "Invalid Odoo service order request.");
    error.statusCode = 400;
    throw error;
  }
  return result.data;
}

function workorderIdFrom(pathname, suffix = "") {
  const escapedSuffix = suffix ? suffix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : "";
  const match = new RegExp(`^/api/surveillance/workorders/([^/]+)${escapedSuffix}$`).exec(pathname);
  return match ? decodeURIComponent(match[1]) : null;
}

export async function handleSurveillanceApi(req, res, url, helpers, dependencies = {}) {
  const { sendJson, readBody, requestContext } = helpers;
  const userId = requestContext.actor.id;
  const readOdooReadiness = dependencies.odooReadiness || workorderOdooReadiness;
  const prepareOdoo = dependencies.prepareOdoo || prepareWorkorderOdooModule;
  const createOdooDraft = dependencies.createOdooDraft || createWorkorderOdooDraft;
  const markMissingInfo = dependencies.markMissingInfo || markWorkorderOdooMissingInfo;
  const authorizeModule = dependencies.authorizeModule || authorizeWorkorderModule;
  const markEntered = dependencies.markOdooEntered || markOdooEntered;
  const resolveModules = dependencies.resolveModules || resolveWorkorderModuleDecisions;

  if (req.method === "GET" && url.pathname === "/api/surveillance/dashboard") {
    sendJson(res, 200, await surveillanceDashboard(requestContext));
    return true;
  }

  const detailId = workorderIdFrom(url.pathname);
  if (req.method === "GET" && detailId) {
    const { decisions } = await resolveModules(requestContext, detailId);
    sendJson(res, 200, projectProtectedWorkorderDetail(
      await surveillanceWorkorderDetail(detailId, userId),
      decisions,
    ));
    return true;
  }

  const odooId = workorderIdFrom(url.pathname, "/mark-odoo-entered");
  if (req.method === "POST" && odooId) {
    await authorizeModule(requestContext, odooId, {
      moduleKey: "odoo",
      capability: "write",
      action: "markEntered",
    });
    const input = markOdooEnteredSchema.parse(await readBody(req));
    sendJson(res, 200, { odooEntry: await markEntered(odooId, { ...input, userId }) });
    return true;
  }

  const missingInfoId = workorderIdFrom(url.pathname, "/mark-missing-info");
  if (req.method === "POST" && missingInfoId) {
    const input = markMissingInfoSchema.parse(await readBody(req));
    sendJson(res, 200, {
      odooEntry: await markMissingInfo(requestContext, missingInfoId, input),
    });
    return true;
  }

  const odooReadinessId = workorderIdFrom(url.pathname, "/odoo-readiness");
  if (req.method === "GET" && odooReadinessId) {
    sendJson(res, 200, await readOdooReadiness(requestContext, odooReadinessId));
    return true;
  }

  const odooPreparationId = workorderIdFrom(url.pathname, "/odoo-preparation");
  if (req.method === "PUT" && odooPreparationId) {
    const input = validated(prepareOdooWorkorderSchema, await readBody(req));
    sendJson(res, 200, await prepareOdoo(requestContext, odooPreparationId, input));
    return true;
  }

  const odooDraftId = workorderIdFrom(url.pathname, "/odoo-draft");
  if (req.method === "POST" && odooDraftId) {
    const input = validated(createOdooDraftSchema, await readBody(req));
    sendJson(res, 201, await createOdooDraft(requestContext, odooDraftId, {
      ...input,
      requestId: req.requestId,
    }));
    return true;
  }

  return false;
}
