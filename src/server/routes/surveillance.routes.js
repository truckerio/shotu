import { resolveWorkorderModuleDecisions } from "../modules/workorders/workorder-module-access.service.js";
import { projectProtectedWorkorderDetail } from "../modules/workorders/workorder-module-projection.js";
import { surveillanceDashboard, surveillanceWorkorderDetail } from "../modules/surveillance/surveillance.service.js";

function workorderIdFrom(pathname, suffix = "") {
  const escapedSuffix = suffix ? suffix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : "";
  const match = new RegExp(`^/api/surveillance/workorders/([^/]+)${escapedSuffix}$`).exec(pathname);
  return match ? decodeURIComponent(match[1]) : null;
}

export async function handleSurveillanceApi(req, res, url, helpers, dependencies = {}) {
  const { sendJson, requestContext } = helpers;
  const userId = requestContext.actor.id;
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

  return false;
}
