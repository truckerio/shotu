import assert from "node:assert/strict";
import test from "node:test";
import { parseLoadConfig, publicConfig } from "./config.js";

function baseEnv(overrides = {}) {
  return {
    LOAD_BASE_URL: "http://localhost:4173",
    LOAD_ROLES: "admin,office,mechanic",
    LOAD_ADMIN_IDENTIFIER: "admin-user",
    LOAD_ADMIN_PASSWORD: "admin-secret",
    LOAD_OFFICE_IDENTIFIER: "office-user",
    LOAD_OFFICE_PASSWORD: "office-secret",
    LOAD_MECHANIC_IDENTIFIER: "mechanic-user",
    LOAD_MECHANIC_PASSWORD: "mechanic-secret",
    ...overrides,
  };
}

test("validation mode builds a secret-free public configuration", () => {
  const config = parseLoadConfig(baseEnv(), ["--validate"]);
  const visible = JSON.stringify(publicConfig(config));
  assert.equal(config.validateOnly, true);
  assert.match(visible, /credentialsConfigured/);
  assert.doesNotMatch(visible, /admin-secret|office-secret|mechanic-secret/);
});

test("draft writes require explicit opt-in", () => {
  assert.throws(
    () => parseLoadConfig(baseEnv({ LOAD_DRAFT_SCENARIO: "true" }), []),
    /LOAD_ENABLE_DRAFT_WRITES=true/,
  );
});

test("remote draft writes require an explicit remote confirmation", () => {
  assert.throws(
    () => parseLoadConfig(baseEnv({
      LOAD_BASE_URL: "https://example.test",
      LOAD_DRAFT_SCENARIO: "true",
      LOAD_ENABLE_DRAFT_WRITES: "true",
    }), []),
    /LOAD_CONFIRM_REMOTE_WRITES=DISPOSABLE_DRAFTS/,
  );
});

test("invalid percentile ordering is rejected", () => {
  assert.throws(
    () => parseLoadConfig(baseEnv({
      LOAD_MAX_P95_MS: "2000",
      LOAD_MAX_P99_MS: "1000",
    }), []),
    /LOAD_MAX_P99_MS/,
  );
});
