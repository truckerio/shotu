import { runAutomaticSamsaraSync } from "../integrations/samsara/samsara.auto-sync.js";
import { requireCompanyAccess } from "../auth/authorize.js";
import "../integrations/samsara/samsara.adapter.js";
import { getIntegrationProvider } from "../integrations/core/integration-provider.registry.js";
import {
  companyIntegrationClients,
  createCompanyIntegrationClient,
  revokeCompanyIntegrationClient,
} from "../integrations/core/integration-clients.service.js";
import {
  configureOdoo,
  discoverOdooLocations,
  listOdooLocationMappings,
  odooAdminStatus,
  setOdooLocationMapping,
  syncOdooPartsAndInventory,
  testOdoo,
} from "../integrations/odoo/odoo.admin.service.js";
import {
  odooConfigurationSchema,
  odooLocationMappingSchema,
} from "../integrations/odoo/odoo.admin.schemas.js";

const samsara = getIntegrationProvider("samsara");

function validated(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) {
    const error = new Error(result.error.issues[0]?.message || "Invalid integration settings.");
    error.statusCode = 400;
    throw error;
  }
  return result.data;
}

function selectedCompanyId(url, requestContext) {
  const companyId = url.searchParams.get("companyId") || [...(requestContext.companyIds || [])][0];
  requireCompanyAccess(requestContext, companyId);
  return companyId;
}

export async function handleIntegrationsApi(req, res, url, helpers) {
  const { sendJson, requestContext } = helpers;

  if (req.method === "GET" && url.pathname === "/api/integrations/samsara/status") {
    const companyId = selectedCompanyId(url, requestContext);
    sendJson(res, 200, await samsara.status(companyId));
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/integrations/samsara/oauth/start") {
    try {
      const companyId = selectedCompanyId(url, requestContext);
      const authUrl = await samsara.oauthStartUrl(req, companyId);
      res.writeHead(302, { location: authUrl });
    } catch (error) {
      res.writeHead(302, { location: `/?samsara=error&message=${encodeURIComponent(error.message)}` });
    }
    res.end();
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/integrations/samsara/oauth/callback") {
    try {
      await samsara.oauthCallback(url);
      runAutomaticSamsaraSync("oauth_callback").catch(() => {});
      res.writeHead(302, { location: "/?samsara=connected" });
      res.end();
    } catch (error) {
      res.writeHead(302, { location: `/?samsara=error&message=${encodeURIComponent(error.message)}` });
      res.end();
    }
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/integrations/samsara/test") {
    const companyId = selectedCompanyId(url, requestContext);
    sendJson(res, 200, await samsara.test(companyId));
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/integrations/samsara/sync") {
    const companyId = selectedCompanyId(url, requestContext);
    sendJson(res, 200, await samsara.sync({ companyId }));
    return true;
  }

  if (req.method === "DELETE" && url.pathname === "/api/integrations/samsara") {
    const companyId = selectedCompanyId(url, requestContext);
    sendJson(res, 200, await samsara.disconnect(companyId));
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/integrations/odoo/status") {
    const companyId = selectedCompanyId(url, requestContext);
    sendJson(res, 200, await odooAdminStatus(companyId));
    return true;
  }

  if (req.method === "PUT" && url.pathname === "/api/integrations/odoo/configuration") {
    const companyId = selectedCompanyId(url, requestContext);
    const input = validated(odooConfigurationSchema, await helpers.readBody(req));
    sendJson(res, 200, await configureOdoo(companyId, input));
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/integrations/odoo/test") {
    const companyId = selectedCompanyId(url, requestContext);
    sendJson(res, 200, await testOdoo(companyId));
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/integrations/odoo/discover-locations") {
    const companyId = selectedCompanyId(url, requestContext);
    sendJson(res, 200, await discoverOdooLocations(companyId));
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/integrations/odoo/locations") {
    const companyId = selectedCompanyId(url, requestContext);
    sendJson(res, 200, await listOdooLocationMappings(companyId));
    return true;
  }

  const odooLocationMatch = /^\/api\/integrations\/odoo\/locations\/([^/]+)\/mapping$/.exec(url.pathname);
  if (req.method === "PUT" && odooLocationMatch) {
    const companyId = selectedCompanyId(url, requestContext);
    const input = validated(odooLocationMappingSchema, await helpers.readBody(req));
    sendJson(res, 200, await setOdooLocationMapping(
      companyId,
      decodeURIComponent(odooLocationMatch[1]),
      input,
    ));
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/integrations/odoo/sync") {
    const companyId = selectedCompanyId(url, requestContext);
    sendJson(res, 200, await syncOdooPartsAndInventory(companyId));
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/integrations/clients") {
    const companyId = selectedCompanyId(url, requestContext);
    sendJson(res, 200, { clients: await companyIntegrationClients(companyId) });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/integrations/clients") {
    const companyId = selectedCompanyId(url, requestContext);
    const created = await createCompanyIntegrationClient(await helpers.readBody(req), {
      companyId,
      userId: requestContext.actor.id,
    });
    sendJson(res, 201, created);
    return true;
  }

  const revokeMatch = /^\/api\/integrations\/clients\/([^/]+)\/revoke$/.exec(url.pathname);
  if (req.method === "POST" && revokeMatch) {
    const companyId = selectedCompanyId(url, requestContext);
    const client = await revokeCompanyIntegrationClient({
      clientId: decodeURIComponent(revokeMatch[1]),
    }, {
      companyId,
      userId: requestContext.actor.id,
    });
    sendJson(res, 200, { client });
    return true;
  }

  return false;
}
