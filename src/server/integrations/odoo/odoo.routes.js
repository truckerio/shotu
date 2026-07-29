import {
  INTEGRATION_SCOPES,
  requireIntegrationScope,
} from "../core/integration-auth.js";
import {
  integrationInvalidRequest,
} from "../core/integration-errors.js";
import {
  getOdooWorkorder,
  listOdooWorkorders,
  recordOdooResultAtomic,
} from "./odoo.repo.js";
import { odooListSchema, odooResultSchema } from "./odoo.schemas.js";

const BASE = "/api/integrations/odoo/v1";

function workorderPath(pathname, suffix = "") {
  const escaped = suffix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`^${BASE}/workorders/([^/]+)${escaped}$`).exec(pathname);
  return match ? decodeURIComponent(match[1]) : null;
}

function parseWithSchema(schema, input) {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw integrationInvalidRequest("INVALID_INTEGRATION_REQUEST", "The integration request is invalid.", {
      issues: result.error.issues.map((issue) => ({
        path: issue.path,
        message: issue.message,
      })),
    });
  }
  return result.data;
}

export async function handleOdooIntegrationApi(req, res, url, helpers) {
  const { sendJson, readBody, integrationContext } = helpers;

  if (req.method === "GET" && url.pathname === `${BASE}/workorders`) {
    requireIntegrationScope(integrationContext, INTEGRATION_SCOPES.WORKORDERS_READ);
    const input = parseWithSchema(odooListSchema, Object.fromEntries(url.searchParams));
    sendJson(res, 200, await listOdooWorkorders({
      companyId: integrationContext.companyId,
      ...input,
    }));
    return true;
  }

  const detailId = workorderPath(url.pathname);
  if (req.method === "GET" && detailId) {
    requireIntegrationScope(integrationContext, INTEGRATION_SCOPES.WORKORDERS_READ);
    sendJson(res, 200, await getOdooWorkorder({
      companyId: integrationContext.companyId,
      workorderId: detailId,
    }));
    return true;
  }

  const resultId = workorderPath(url.pathname, "/result");
  if (req.method === "PUT" && resultId) {
    requireIntegrationScope(integrationContext, INTEGRATION_SCOPES.WORKORDERS_WRITE);
    const idempotencyKey = String(req.headers["idempotency-key"] || "").trim();
    if (idempotencyKey.length < 16 || idempotencyKey.length > 200) {
      throw integrationInvalidRequest(
        "INVALID_IDEMPOTENCY_KEY",
        "Idempotency-Key must contain between 16 and 200 characters.",
      );
    }
    const input = parseWithSchema(odooResultSchema, await readBody(req));
    const result = await recordOdooResultAtomic({
      companyId: integrationContext.companyId,
      integrationClientId: integrationContext.integrationClient.id,
      workorderId: resultId,
      input,
      idempotencyKey,
      requestId: req.requestId,
      path: url.pathname,
    });
    if (result.replayed) res.setHeader("idempotency-replayed", "true");
    sendJson(res, result.statusCode, result.body);
    return true;
  }

  return false;
}
