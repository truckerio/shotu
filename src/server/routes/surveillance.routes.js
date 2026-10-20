import { resolveWorkorderModuleDecisions } from "../modules/workorders/workorder-module-access.service.js";
import { projectLoadedProtectedWorkorderDetail } from "../modules/workorders/workorder-module-runtime.service.js";
import { effectiveCompanyContext } from "../auth/company-role.js";
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
    const { workorder, decisions } = await resolveModules(requestContext, detailId);
    const targetContext = effectiveCompanyContext(requestContext, workorder.companyId);
    sendJson(res, 200, await projectLoadedProtectedWorkorderDetail(
      await (dependencies.loadDetail || surveillanceWorkorderDetail)(detailId, userId),
      decisions,
      { viewerRole: targetContext.actor.role },
      dependencies,
    ));
    return true;
  }

  return false;
}
