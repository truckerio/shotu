import { runAutomaticSamsaraSync } from "../integrations/samsara/samsara.auto-sync.js";
import { requireCompanyAccess } from "../auth/authorize.js";
import "../integrations/samsara/samsara.adapter.js";
import { getIntegrationProvider } from "../integrations/core/integration-provider.registry.js";
import {
  companyIntegrationClients,
  createCompanyIntegrationClient,
  revokeCompanyIntegrationClient,
} from "../integrations/core/integration-clients.service.js";

const samsara = getIntegrationProvider("samsara");

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
