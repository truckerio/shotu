import { OriginValidationError } from "./errors.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS", "TRACE"]);

function firstHeaderValue(value) {
  const raw = Array.isArray(value) ? value[0] : value;
  return String(raw || "").split(",")[0].trim();
}

function normalizedHttpOrigin(value) {
  if (!value || value === "null") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

function originFromReferer(value) {
  return normalizedHttpOrigin(value);
}

function requestTargetOrigin(req, { publicOrigin, trustProxy = false, trustedProxyHosts = [] } = {}) {
  const configuredOrigin = normalizedHttpOrigin(publicOrigin);
  if (configuredOrigin) return configuredOrigin;

  const forwardedHost = trustProxy ? firstHeaderValue(req.headers?.["x-forwarded-host"]) : "";
  const host = forwardedHost || firstHeaderValue(req.headers?.host);
  const allowedHosts = new Set(trustedProxyHosts.map((entry) => String(entry).toLowerCase()));

  if (!host || (forwardedHost && allowedHosts.size > 0 && !allowedHosts.has(host.toLowerCase()))) {
    return null;
  }

  const forwardedProtocol = trustProxy ? firstHeaderValue(req.headers?.["x-forwarded-proto"]) : "";
  const protocol = forwardedProtocol || (req.socket?.encrypted ? "https" : "http");
  return normalizedHttpOrigin(`${protocol}://${host}`);
}

export function assertSameOriginMutation(req, {
  allowedOrigins = [],
  allowMissingOrigin = false,
  publicOrigin,
  trustProxy = false,
  trustedProxyHosts = [],
} = {}) {
  const method = String(req.method || "GET").toUpperCase();
  if (SAFE_METHODS.has(method)) return { checked: false, origin: null };

  const originHeader = firstHeaderValue(req.headers?.origin);
  const refererHeader = firstHeaderValue(req.headers?.referer);
  const requestOrigin = originHeader
    ? normalizedHttpOrigin(originHeader)
    : originFromReferer(refererHeader);

  if (!requestOrigin) {
    if (allowMissingOrigin && !originHeader && !refererHeader) {
      return { checked: true, origin: null };
    }
    throw new OriginValidationError("A valid Origin or Referer header is required.");
  }

  const acceptedOrigins = new Set(
    allowedOrigins.map(normalizedHttpOrigin).filter(Boolean),
  );
  const targetOrigin = requestTargetOrigin(req, {
    publicOrigin,
    trustProxy,
    trustedProxyHosts,
  });
  if (targetOrigin) acceptedOrigins.add(targetOrigin);

  if (!acceptedOrigins.has(requestOrigin)) {
    throw new OriginValidationError(undefined, { origin: requestOrigin });
  }

  return { checked: true, origin: requestOrigin };
}

export function isSafeHttpMethod(method) {
  return SAFE_METHODS.has(String(method || "GET").toUpperCase());
}
