import {
  disconnectSamsara,
  samsaraStatus,
  syncSamsaraVehicles,
  testSamsaraConnection,
} from "../integrations/samsara/samsara.sync.service.js";
import { handleSamsaraOAuthCallback, samsaraOAuthStartUrl } from "../integrations/samsara/samsara.oauth.service.js";
import { runAutomaticSamsaraSync } from "../integrations/samsara/samsara.auto-sync.js";
import { requireCompanyAccess } from "../auth/authorize.js";

function selectedCompanyId(url, requestContext) {
  const companyId = url.searchParams.get("companyId") || [...(requestContext.companyIds || [])][0];
  requireCompanyAccess(requestContext, companyId);
  return companyId;
}

export async function handleIntegrationsApi(req, res, url, helpers) {
  const { sendJson, requestContext } = helpers;

  if (req.method === "GET" && url.pathname === "/api/integrations/samsara/status") {
    const companyId = selectedCompanyId(url, requestContext);
    sendJson(res, 200, await samsaraStatus(companyId));
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/integrations/samsara/oauth/start") {
    try {
      const companyId = selectedCompanyId(url, requestContext);
      const authUrl = await samsaraOAuthStartUrl(req, companyId);
      res.writeHead(302, { location: authUrl });
    } catch (error) {
      res.writeHead(302, { location: `/?samsara=error&message=${encodeURIComponent(error.message)}` });
    }
    res.end();
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/integrations/samsara/oauth/callback") {
    try {
      await handleSamsaraOAuthCallback(url);
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
    sendJson(res, 200, await testSamsaraConnection(companyId));
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/integrations/samsara/sync") {
    const companyId = selectedCompanyId(url, requestContext);
    sendJson(res, 200, await syncSamsaraVehicles({ companyId }));
    return true;
  }

  if (req.method === "DELETE" && url.pathname === "/api/integrations/samsara") {
    const companyId = selectedCompanyId(url, requestContext);
    sendJson(res, 200, await disconnectSamsara(companyId));
    return true;
  }

  return false;
}
