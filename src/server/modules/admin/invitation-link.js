function firstHeader(value) {
  const normalized = Array.isArray(value) ? value[0] : value;
  return String(normalized || "").split(",")[0].trim();
}

export function invitationPublicOrigin(req, environment = process.env) {
  const configuredUrl = String(environment.BETTER_AUTH_URL || "").trim();
  if (configuredUrl) return new URL(configuredUrl).origin;

  const protocol = firstHeader(req.headers["x-forwarded-proto"])
    || (req.socket?.encrypted ? "https" : "http");
  const host = firstHeader(req.headers["x-forwarded-host"]) || firstHeader(req.headers.host);
  if (!host) throw new Error("Unable to determine the public application URL.");
  return `${protocol}://${host}`;
}

export function buildInvitationUrl(origin, token) {
  const url = new URL("/", origin);
  url.searchParams.set("invite", token);
  return url.toString();
}
