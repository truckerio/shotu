import { env } from "../config/env.js";

export async function handleConfigApi(req, res, url, helpers) {
  const { sendJson } = helpers;

  if (req.method === "GET" && url.pathname === "/api/config") {
    sendJson(res, 200, {
      maps: {
        googleMapsBrowserApiKey: env.googleMapsBrowserApiKey,
        hereBrowserApiKey: env.hereBrowserApiKey,
      },
    });
    return true;
  }

  return false;
}
