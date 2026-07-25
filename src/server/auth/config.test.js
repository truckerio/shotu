import assert from "node:assert/strict";
import test from "node:test";
import { resolveAuthConfig } from "./config.js";

test("development auth config uses local defaults", () => {
  const config = resolveAuthConfig({ NODE_ENV: "development", PORT: "5050" });
  assert.equal(config.baseURL, "http://localhost:5050");
  assert.equal(config.secureCookies, false);
  assert.equal(config.rateLimitEnabled, false);
  assert.deepEqual(config.ipAddressHeaders, []);
  assert.ok(config.secret.length >= 32);
});

test("production auth config requires a strong secret", () => {
  assert.throws(() => resolveAuthConfig({ NODE_ENV: "production", BETTER_AUTH_URL: "https://app.example.com" }), /required/);
  assert.throws(() => resolveAuthConfig({ NODE_ENV: "production", BETTER_AUTH_SECRET: "short" }), /32 characters/);
});

test("trusted origins include base URL and explicit origins", () => {
  const config = resolveAuthConfig({
    NODE_ENV: "production",
    BETTER_AUTH_SECRET: "a".repeat(32),
    BETTER_AUTH_URL: "https://app.example.com",
    AUTH_TRUSTED_ORIGINS: "http://localhost:4173, https://preview.example.com",
  });
  assert.deepEqual(config.trustedOrigins, [
    "https://app.example.com",
    "http://localhost:4173",
    "https://preview.example.com",
  ]);
  assert.equal(config.secureCookies, true);
  assert.equal(config.rateLimitEnabled, true);
  assert.deepEqual(config.ipAddressHeaders, ["x-real-ip"]);
});

test("production auth can override the trusted client IP header", () => {
  const config = resolveAuthConfig({
    NODE_ENV: "production",
    BETTER_AUTH_SECRET: "a".repeat(32),
    BETTER_AUTH_URL: "https://app.example.com",
    AUTH_IP_ADDRESS_HEADERS: "cf-connecting-ip",
  });
  assert.deepEqual(config.ipAddressHeaders, ["cf-connecting-ip"]);
});
