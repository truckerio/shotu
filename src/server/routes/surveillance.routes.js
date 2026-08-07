import {
  createSurveillanceOdooDraft,
  markOdooEntered,
  markOdooMissingInfo,
  prepareSurveillanceOdooWorkorder,
  surveillanceDashboard,
  surveillanceOdooReadiness,
  surveillanceWorkorderDetail,
} from "../modules/surveillance/surveillance.service.js";
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

export async function handleSurveillanceApi(req, res, url, helpers) {
  const { sendJson, readBody, requestContext } = helpers;
  const userId = requestContext.actor.id;

  if (req.method === "GET" && url.pathname === "/api/surveillance/dashboard") {
    sendJson(res, 200, await surveillanceDashboard(requestContext));
    return true;
  }

  const detailId = workorderIdFrom(url.pathname);
  if (req.method === "GET" && detailId) {
    await requireWorkorderAccess(requestContext, detailId);
    sendJson(res, 200, await surveillanceWorkorderDetail(detailId, userId));
    return true;
  }

  const odooId = workorderIdFrom(url.pathname, "/mark-odoo-entered");
  if (req.method === "POST" && odooId) {
    await requireWorkorderAccess(requestContext, odooId);
    const input = markOdooEnteredSchema.parse(await readBody(req));
    sendJson(res, 200, { odooEntry: await markOdooEntered(odooId, { ...input, userId }) });
    return true;
  }

  const missingInfoId = workorderIdFrom(url.pathname, "/mark-missing-info");
  if (req.method === "POST" && missingInfoId) {
    await requireWorkorderAccess(requestContext, missingInfoId);
    const input = markMissingInfoSchema.parse(await readBody(req));
    sendJson(res, 200, { odooEntry: await markOdooMissingInfo(missingInfoId, { ...input, userId }) });
    return true;
  }

  const odooReadinessId = workorderIdFrom(url.pathname, "/odoo-readiness");
  if (req.method === "GET" && odooReadinessId) {
    await requireWorkorderAccess(requestContext, odooReadinessId);
    sendJson(res, 200, await surveillanceOdooReadiness(odooReadinessId, { userId }));
    return true;
  }

  const odooPreparationId = workorderIdFrom(url.pathname, "/odoo-preparation");
  if (req.method === "PUT" && odooPreparationId) {
    await requireWorkorderAccess(requestContext, odooPreparationId);
    const input = validated(prepareOdooWorkorderSchema, await readBody(req));
    sendJson(res, 200, await prepareSurveillanceOdooWorkorder(odooPreparationId, { ...input, userId }));
    return true;
  }

  const odooDraftId = workorderIdFrom(url.pathname, "/odoo-draft");
  if (req.method === "POST" && odooDraftId) {
    await requireWorkorderAccess(requestContext, odooDraftId);
    const input = validated(createOdooDraftSchema, await readBody(req));
    sendJson(res, 201, await createSurveillanceOdooDraft(odooDraftId, {
      ...input,
      userId,
      requestId: req.requestId,
    }));
    return true;
  }

  return false;
}
