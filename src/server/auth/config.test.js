import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { resolveAuthConfig } from "./config.js";

test("application auth uses the resolved cookie namespace", async () => {
  const source = await readFile(new URL("./auth.js", import.meta.url), "utf8");
  assert.match(source, /cookiePrefix:\s*config\.cookiePrefix/);
});

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

test("alternate loopback apps isolate cookies using the public URL port", () => {
  for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
    const config = resolveAuthConfig({ NODE_ENV: "test", PORT: "4173", BETTER_AUTH_URL: `http://${host}:4192` });
    assert.equal(config.cookiePrefix, "workorder-local-4192");
    assert.notEqual(config.cookiePrefix, resolveAuthConfig({ NODE_ENV: "test", BETTER_AUTH_URL: `http://${host}:4193` }).cookiePrefix);
  }
  assert.equal(resolveAuthConfig({ PORT: "4192" }).cookiePrefix, "workorder-local-4192");
  assert.equal(resolveAuthConfig({ BETTER_AUTH_URL: "http://localhost" }).cookiePrefix, "workorder-local-80");
  assert.equal(resolveAuthConfig({ BETTER_AUTH_URL: "https://localhost" }).cookiePrefix, "workorder-local-443");
});

test("primary local app and hosted production keep existing cookie names", () => {
  for (const environment of [
    {},
    { BETTER_AUTH_URL: "http://localhost:4173" },
    { BETTER_AUTH_URL: "http://127.0.0.1:4173" },
    { BETTER_AUTH_URL: "http://preview.example.test:4192" },
    { NODE_ENV: "production", BETTER_AUTH_URL: "https://app.example.test", BETTER_AUTH_SECRET: "a".repeat(32) },
    { NODE_ENV: "production", BETTER_AUTH_URL: "http://localhost:4192", BETTER_AUTH_SECRET: "a".repeat(32) },
  ]) assert.equal(resolveAuthConfig(environment).cookiePrefix, "workorder");
});
