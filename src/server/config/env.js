import "dotenv/config";

function publicEnvValue(value) {
  const lines = String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.at(-1) || "";
}

function satelliteMapProvider(value, hasHereBrowserKey = false) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "arcgis") return "arcgis";
  if (normalized === "here") return "here";
  return hasHereBrowserKey ? "here" : "arcgis";
}

const configuredHereBrowserApiKey = publicEnvValue(
  process.env.NEXT_PUBLIC_HERE_API_KEY
    || process.env.HERE_BROWSER_API_KEY
    || process.env.HERE_API_KEY
);
const configuredSatelliteMapProvider = satelliteMapProvider(
  process.env.SATELLITE_MAP_PROVIDER,
  Boolean(configuredHereBrowserApiKey),
);

export const env = {
  port: Number(process.env.PORT || 4173),
  databaseUrl: process.env.DATABASE_URL || "",
  samsaraApiToken: process.env.SAMSARA_API_TOKEN || "",
  samsaraApiBaseUrl: process.env.SAMSARA_API_BASE_URL || "https://api.samsara.com",
  samsaraOAuthClientId: process.env.SAMSARA_OAUTH_CLIENT_ID || process.env.SAMSARA_CLIENT_ID || "",
  samsaraOAuthClientSecret: process.env.SAMSARA_OAUTH_CLIENT_SECRET || process.env.SAMSARA_CLIENT_SECRET || "",
  samsaraOAuthRedirectUri: process.env.SAMSARA_OAUTH_REDIRECT_URI || "",
  samsaraSyncIntervalMinutes: Number(process.env.SAMSARA_SYNC_INTERVAL_MINUTES || 30),
  samsaraSyncOnStartup: process.env.SAMSARA_SYNC_ON_STARTUP !== "false",
  satelliteMapProvider: configuredSatelliteMapProvider,
  googleMapsBrowserApiKey: publicEnvValue(process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_API_KEY),
  hereBrowserApiKey: configuredHereBrowserApiKey,
};

export function requireDatabaseUrl() {
  if (!env.databaseUrl) {
    throw new Error("DATABASE_URL is required for vehicle lookup.");
  }
  return env.databaseUrl;
}

export function requireSamsaraToken() {
  if (!env.samsaraApiToken) {
    throw new Error("SAMSARA_API_TOKEN is required to sync Samsara vehicles.");
  }
  return env.samsaraApiToken;
}
