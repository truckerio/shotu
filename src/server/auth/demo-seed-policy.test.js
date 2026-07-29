import assert from "node:assert/strict";
import test from "node:test";
import {
  assertLocalDemoSeed,
  resolveDemoUserPassword,
} from "../db/seeds/demo-seed-policy.js";

test("production rejects demo users even with explicit opt-in and a custom password", () => {
  assert.throws(
    () => resolveDemoUserPassword({
      NODE_ENV: "production",
      ALLOW_DEMO_USER_SEED: "true",
      DEMO_USER_PASSWORD: "UniqueDemoPassword!2026",
    }),
    /disabled in production/,
  );
});

test("production cannot use a previously known demo password", () => {
  assert.throws(
    () => resolveDemoUserPassword({
      NODE_ENV: "production",
      ALLOW_DEMO_USER_SEED: "true",
      DEMO_USER_PASSWORD: "PreviouslyKnownPassword2026!",
    }),
    /disabled in production/,
  );
});

test("local demo seeds require explicit opt-in", () => {
  assert.throws(
    () => assertLocalDemoSeed({ NODE_ENV: "development", ALLOW_DEMO_USER_SEED: "false" }),
    /requires ALLOW_DEMO_USER_SEED=true/,
  );
});

test("local demo users require an explicit strong password", () => {
  assert.throws(
    () => resolveDemoUserPassword({
      NODE_ENV: "development",
      ALLOW_DEMO_USER_SEED: "true",
    }),
    /DEMO_USER_PASSWORD is required/,
  );
  assert.throws(
    () => resolveDemoUserPassword({
      NODE_ENV: "development",
      ALLOW_DEMO_USER_SEED: "true",
      DEMO_USER_PASSWORD: "short",
    }),
    /at least 12 characters/,
  );
  assert.equal(
    resolveDemoUserPassword({
      NODE_ENV: "development",
      ALLOW_DEMO_USER_SEED: "true",
      DEMO_USER_PASSWORD: "UniqueDemoPassword!2026",
    }),
    "UniqueDemoPassword!2026",
  );
});
