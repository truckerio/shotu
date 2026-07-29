import assert from "node:assert/strict";
import test from "node:test";
import { RateLimitExceededError } from "./errors.js";
import {
  applyRateLimitHeaders,
  createInMemoryRateLimiter,
  createSensitiveRouteRateLimiter,
  requestRateLimitIdentity,
  sensitiveRateLimitPolicy,
  SENSITIVE_RATE_LIMIT_POLICIES,
} from "./rate-limit.js";

test("fixed-window limiter is deterministic, isolated by key, and resets", () => {
  let timestamp = 1_000;
  const limiter = createInMemoryRateLimiter({
    limit: 2,
    windowMs: 500,
    now: () => timestamp,
  });

  assert.equal(limiter.consume("a").remaining, 1);
  assert.equal(limiter.consume("a").remaining, 0);
  assert.equal(limiter.consume("b").allowed, true);
  assert.equal(limiter.consume("a").allowed, false);

  timestamp = 1_500;
  assert.deepEqual(limiter.consume("a"), {
    allowed: true,
    limit: 2,
    remaining: 1,
    resetAt: 2_000,
    retryAfterMs: 0,
  });
});

test("bounded limiter evicts entries rather than growing without limit", () => {
  const limiter = createInMemoryRateLimiter({
    limit: 1,
    windowMs: 1_000,
    maxEntries: 2,
    now: () => 0,
  });

  limiter.consume("a");
  limiter.consume("b");
  limiter.consume("c");
  assert.equal(limiter.size(), 2);
  assert.equal(limiter.consume("a").allowed, true);
});

test("sensitive route classification limits mutations and expensive OAuth start", () => {
  assert.equal(sensitiveRateLimitPolicy("POST", "/api/auth/sign-in/username"), "auth");
  assert.equal(sensitiveRateLimitPolicy("GET", "/api/auth/session"), null);
  assert.equal(sensitiveRateLimitPolicy("DELETE", "/api/admin/users/1"), "admin");
  assert.equal(sensitiveRateLimitPolicy("POST", "/api/integrations/samsara/sync"), "integration");
  assert.equal(sensitiveRateLimitPolicy("GET", "/api/integrations/samsara/oauth/start"), "integration");
  assert.equal(sensitiveRateLimitPolicy("GET", "/api/integrations/samsara/status"), null);
  assert.equal(sensitiveRateLimitPolicy("POST", "/api/auth/kiosk/unlock"), "kiosk");
});

test("auth limiter gives users a short typo-friendly retry window", () => {
  assert.equal(SENSITIVE_RATE_LIMIT_POLICIES.auth.limit, 20);
  assert.equal(SENSITIVE_RATE_LIMIT_POLICIES.auth.windowMs, 60_000);
  assert.equal(SENSITIVE_RATE_LIMIT_POLICIES.kiosk.limit, 10);
});

test("sensitive guard uses independent policies and throws a stable 429 error", () => {
  let timestamp = 0;
  const guard = createSensitiveRouteRateLimiter({
    policies: { auth: { limit: 1, windowMs: 1_000 } },
    now: () => timestamp,
  });
  const req = {
    method: "POST",
    headers: {},
    socket: { remoteAddress: "127.0.0.1" },
  };
  const url = new URL("https://app.example.com/api/auth/sign-in/username");

  const first = guard.check(req, url);
  assert.equal(first.policy, "auth");
  assert.equal(first.result.remaining, 0);
  assert.throws(() => guard.check(req, url), RateLimitExceededError);

  timestamp = 1_000;
  assert.doesNotThrow(() => guard.check(req, url));
});

test("identity trusts only configured proxy IP headers and prefers actor IDs", () => {
  const req = {
    headers: {
      "x-forwarded-for": "203.0.113.2, 10.0.0.1",
      "x-real-ip": "203.0.113.3",
    },
    socket: { remoteAddress: "10.0.0.2" },
  };

  assert.equal(requestRateLimitIdentity(req), "ip:10.0.0.2");
  assert.equal(
    requestRateLimitIdentity(req, { trustedIpHeaders: ["x-real-ip"] }),
    "ip:203.0.113.3",
  );
  assert.equal(
    requestRateLimitIdentity(req, { actorId: "user-1", trustedIpHeaders: ["x-real-ip"] }),
    "user:user-1",
  );
});

test("rate-limit response headers include Retry-After only when blocked", () => {
  const headers = new Map();
  const response = {
    headersSent: false,
    setHeader: (name, value) => headers.set(name, value),
  };

  applyRateLimitHeaders(response, {
    allowed: false,
    limit: 10,
    remaining: 0,
    resetAt: 2_000,
    retryAfterMs: 1_001,
  });

  assert.equal(headers.get("ratelimit-limit"), "10");
  assert.equal(headers.get("retry-after"), "2");
});
