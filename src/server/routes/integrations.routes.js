import { samsaraStatus, syncSamsaraVehicles, testSamsaraConnection } from "../integrations/samsara/samsara.sync.service.js";
import { handleSamsaraOAuthCallback, samsaraOAuthStartUrl } from "../integrations/samsara/samsara.oauth.service.js";
import { runAutomaticSamsaraSync } from "../integrations/samsara/samsara.auto-sync.js";

export async function handleIntegrationsApi(req, res, url, helpers) {
  const { sendJson } = helpers;

  if (req.method === "GET" && url.pathname === "/api/integrations/samsara/status") {
    sendJson(res, 200, await samsaraStatus());
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/integrations/samsara/oauth/start") {
    try {
      const authUrl = await samsaraOAuthStartUrl(req);
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
    sendJson(res, 200, await testSamsaraConnection());
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/integrations/samsara/sync") {
    sendJson(res, 200, await syncSamsaraVehicles());
    return true;
  }

  return false;
}
