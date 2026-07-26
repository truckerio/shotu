import { RateLimitExceededError } from "./errors.js";

export const SENSITIVE_RATE_LIMIT_POLICIES = Object.freeze({
  auth: Object.freeze({ limit: 10, windowMs: 10 * 60_000 }),
  admin: Object.freeze({ limit: 60, windowMs: 60_000 }),
  integration: Object.freeze({ limit: 10, windowMs: 60_000 }),
});

function positiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive safe integer.`);
  }
  return value;
}

export function createInMemoryRateLimiter({
  limit,
  windowMs,
  maxEntries = 10_000,
  now = Date.now,
} = {}) {
  positiveInteger(limit, "limit");
  positiveInteger(windowMs, "windowMs");
  positiveInteger(maxEntries, "maxEntries");

  const entries = new Map();

  function evictExpired(timestamp) {
    for (const [key, entry] of entries) {
      if (entry.resetAt <= timestamp) entries.delete(key);
    }
  }

  function ensureCapacity(timestamp) {
    if (entries.size < maxEntries) return;
    evictExpired(timestamp);
    if (entries.size < maxEntries) return;
    entries.delete(entries.keys().next().value);
  }

  function consume(key, cost = 1) {
    positiveInteger(cost, "cost");
    const normalizedKey = String(key || "");
    if (!normalizedKey) throw new TypeError("A non-empty rate-limit key is required.");

    const timestamp = now();
    let entry = entries.get(normalizedKey);
    if (!entry || entry.resetAt <= timestamp) {
      ensureCapacity(timestamp);
      entry = { count: 0, resetAt: timestamp + windowMs };
      entries.set(normalizedKey, entry);
    } else {
      entries.delete(normalizedKey);
      entries.set(normalizedKey, entry);
    }

    const allowed = entry.count + cost <= limit;
    if (allowed) entry.count += cost;
    const remaining = Math.max(0, limit - entry.count);

    return {
      allowed,
      limit,
      remaining,
      resetAt: entry.resetAt,
      retryAfterMs: allowed ? 0 : Math.max(1, entry.resetAt - timestamp),
    };
  }

  return {
    consume,
    clear: () => entries.clear(),
    size: () => entries.size,
  };
}

export function sensitiveRateLimitPolicy(method, pathname) {
  const normalizedMethod = String(method || "GET").toUpperCase();
  const path = String(pathname || "");

  if (path === "/api/auth" || path.startsWith("/api/auth/")) {
    return ["GET", "HEAD", "OPTIONS"].includes(normalizedMethod) ? null : "auth";
  }
  if (path === "/api/admin" || path.startsWith("/api/admin/")) {
    return ["GET", "HEAD", "OPTIONS"].includes(normalizedMethod) ? null : "admin";
  }
  if (path === "/api/integrations" || path.startsWith("/api/integrations/")) {
    const expensiveGet = path.endsWith("/oauth/start");
    return expensiveGet || !["GET", "HEAD", "OPTIONS"].includes(normalizedMethod)
      ? "integration"
      : null;
  }
  return null;
}

function firstHeaderValue(value) {
  const raw = Array.isArray(value) ? value[0] : value;
  return String(raw || "").split(",")[0].trim();
}

export function requestRateLimitIdentity(req, {
  actorId,
  trustedIpHeaders = [],
} = {}) {
  if (actorId) return `user:${actorId}`;

  for (const header of trustedIpHeaders) {
    const address = firstHeaderValue(req.headers?.[String(header).toLowerCase()]);
    if (address) return `ip:${address}`;
  }

  const socketAddress = req.socket?.remoteAddress;
  return socketAddress ? `ip:${socketAddress}` : "ip:unknown";
}

export function createSensitiveRouteRateLimiter({
  policies = SENSITIVE_RATE_LIMIT_POLICIES,
  now = Date.now,
  maxEntries = 10_000,
} = {}) {
  const limiters = Object.fromEntries(
    Object.entries(policies).map(([name, policy]) => [
      name,
      createInMemoryRateLimiter({ ...policy, now, maxEntries }),
    ]),
  );

  return {
    check(req, url, { actorId, trustedIpHeaders } = {}) {
      const policy = sensitiveRateLimitPolicy(req.method, url.pathname);
      if (!policy) return { policy: null, result: null };

      const identity = requestRateLimitIdentity(req, { actorId, trustedIpHeaders });
      const result = limiters[policy].consume(`${policy}:${identity}`);
      if (!result.allowed) throw new RateLimitExceededError(result);
      return { policy, result };
    },
    clear() {
      for (const limiter of Object.values(limiters)) limiter.clear();
    },
  };
}

export function applyRateLimitHeaders(res, result) {
  if (!result || res.headersSent) return false;
  res.setHeader("ratelimit-limit", String(result.limit));
  res.setHeader("ratelimit-remaining", String(result.remaining));
  res.setHeader("ratelimit-reset", String(Math.ceil(result.resetAt / 1000)));
  if (!result.allowed) {
    res.setHeader("retry-after", String(Math.ceil(result.retryAfterMs / 1000)));
  }
  return true;
}
