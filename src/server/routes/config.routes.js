import { env } from "../config/env.js";

export function publicMapsConfig(config = env) {
  const wantsArcgis = config.satelliteMapProvider === "arcgis";
  const satelliteProvider = !wantsArcgis && config.hereBrowserApiKey
    ? "here"
    : "arcgis";
  return {
    satelliteProvider,
    hereBrowserApiKey: satelliteProvider === "here" ? config.hereBrowserApiKey : "",
    googleMapsBrowserApiKey: config.googleMapsBrowserApiKey || "",
  };
}

export async function handleConfigApi(req, res, url, helpers) {
  const { sendJson } = helpers;

  if (req.method === "GET" && url.pathname === "/api/config") {
    sendJson(res, 200, {
      maps: publicMapsConfig(),
    });
    return true;
  }

  return false;
}
