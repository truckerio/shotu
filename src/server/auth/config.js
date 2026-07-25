const LOCAL_SECRET = "development-only-auth-secret-change-before-production";

function list(value) {
  return String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function resolveAuthConfig(environment = process.env) {
  const production = environment.NODE_ENV === "production";
  const port = Number(environment.PORT || 4173);
  const baseURL = environment.BETTER_AUTH_URL || `http://localhost:${port}`;
  const secret = environment.BETTER_AUTH_SECRET || (production ? "" : LOCAL_SECRET);

  if (!secret) throw new Error("BETTER_AUTH_SECRET is required in production.");
  if (secret.length < 32) throw new Error("BETTER_AUTH_SECRET must contain at least 32 characters.");

  return {
    baseURL,
    secret,
    trustedOrigins: Array.from(new Set([baseURL, ...list(environment.AUTH_TRUSTED_ORIGINS)])),
    secureCookies: production || baseURL.startsWith("https://"),
    rateLimitEnabled: production,
    ipAddressHeaders: production ? list(environment.AUTH_IP_ADDRESS_HEADERS || "x-real-ip") : [],
  };
}
