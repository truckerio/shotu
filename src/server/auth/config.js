const LOCAL_SECRET = "development-only-auth-secret-change-before-production";

export function resolveAuthCookiePrefix(environment = process.env) {
  if (environment.NODE_ENV === "production") return "workorder";
  const url = new URL(environment.BETTER_AUTH_URL || `http://localhost:${environment.PORT || 4173}`);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return "workorder";
  const port = url.port || (url.protocol === "https:" ? "443" : "80");
  // Cookies ignore ports. Keep the normal app's existing login, but isolate
  // disposable local apps so their login/logout cannot replace its cookies.
  return port === "4173" ? "workorder" : `workorder-local-${port}`;
}

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
    cookiePrefix: resolveAuthCookiePrefix(environment),
    trustedOrigins: Array.from(new Set([baseURL, ...list(environment.AUTH_TRUSTED_ORIGINS)])),
    secureCookies: production || baseURL.startsWith("https://"),
    rateLimitEnabled: production,
    ipAddressHeaders: production ? list(environment.AUTH_IP_ADDRESS_HEADERS || "x-real-ip") : [],
  };
}
