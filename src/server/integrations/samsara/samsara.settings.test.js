import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { permissionForRequest } from "../../auth/policy.js";
import { PERMISSION } from "../../auth/permissions.js";
import { publicSamsaraStatus } from "./samsara.sync.service.js";

const repositoryUrl = new URL("../../db/repositories/integrations.repo.js", import.meta.url);
const credentialsRepositoryUrl = new URL("../core/integration-credentials.repo.js", import.meta.url);
const routesUrl = new URL("../../routes/integrations.routes.js", import.meta.url);

test("settings status exposes safe OAuth and latest sync metadata", () => {
  const status = publicSamsaraStatus({
    account: {
      status: "connected",
      access_token: "secret-access",
      refresh_token: "secret-refresh",
      last_full_sync_at: "2026-07-25T12:00:00.000Z",
    },
    latestSync: {
      id: "11111111-1111-4111-8111-111111111111",
      sync_type: "manual",
      status: "failed",
      started_at: "2026-07-25T12:00:00.000Z",
      finished_at: "2026-07-25T12:01:00.000Z",
      fetched_count: 17,
      changed_count: 4,
      has_error: true,
      error: "provider response containing private detail",
    },
  });

  assert.deepEqual(status, {
    configured: true,
    provider: "samsara",
    authType: "oauth",
    status: "connected",
    lastFullSyncAt: "2026-07-25T12:00:00.000Z",
    latestSync: {
      id: "11111111-1111-4111-8111-111111111111",
      type: "manual",
      status: "failed",
      startedAt: "2026-07-25T12:00:00.000Z",
      finishedAt: "2026-07-25T12:01:00.000Z",
      fetchedCount: 17,
      changedCount: 4,
      hasError: true,
    },
  });
  for (const key of ["access_token", "refresh_token", "error"]) {
    assert.equal(Object.hasOwn(status, key), false);
  }
  for (const key of ["error", "accessToken", "refreshToken"]) {
    assert.equal(Object.hasOwn(status.latestSync, key), false);
  }
});

test("settings status distinguishes OAuth pending, disconnected, and API token fallback", () => {
  assert.deepEqual(publicSamsaraStatus({
    account: { status: "oauth_pending" },
  }), {
    configured: false,
    provider: "samsara",
    authType: "oauth",
    status: "oauth_pending",
    lastFullSyncAt: null,
    latestSync: null,
  });

  assert.equal(publicSamsaraStatus({
    account: { status: "disconnected" },
  }).status, "disconnected");
  assert.equal(publicSamsaraStatus({
    account: { status: "disconnected" },
    hasApiToken: true,
  }).status, "configured");
  assert.equal(publicSamsaraStatus({
    account: { status: "disconnected" },
    hasApiToken: true,
  }).authType, "api_token");
});

test("disconnect clears OAuth credentials and state while appending a safe audit run", async () => {
  const source = await readFile(repositoryUrl, "utf8");
  const disconnectBody = source.slice(
    source.indexOf("export async function disconnectIntegration"),
    source.indexOf("export async function saveOAuthState"),
  );

  assert.match(disconnectBody, /access_token = null/i);
  assert.match(disconnectBody, /refresh_token = null/i);
  assert.match(disconnectBody, /token_type = null/i);
  assert.match(disconnectBody, /scope = null/i);
  assert.match(disconnectBody, /expires_at = null/i);
  assert.match(disconnectBody, /oauth_state = null/i);
  assert.match(disconnectBody, /oauth_state_created_at = null/i);
  assert.match(disconnectBody, /'disconnect', 'completed'/i);
  assert.match(disconnectBody, /await client\.query\("begin"\)/i);
  assert.match(disconnectBody, /await client\.query\("commit"\)/i);
  assert.doesNotMatch(disconnectBody, /returning[\s\S]*access_token/i);
  assert.doesNotMatch(disconnectBody, /returning[\s\S]*refresh_token/i);
});

test("disconnect route uses existing integration-admin policy and authorized company selector", async () => {
  const source = await readFile(routesUrl, "utf8");
  assert.match(source, /DELETE" && url\.pathname === "\/api\/integrations\/samsara"/);
  assert.match(source, /const companyId = selectedCompanyId\(url, requestContext\)/);
  assert.match(source, /await samsara\.disconnect\(companyId\)/);
  for (const [method, path] of [
    ["GET", "/api/integrations/samsara/status"],
    ["POST", "/api/integrations/samsara/test"],
    ["POST", "/api/integrations/samsara/sync"],
    ["DELETE", "/api/integrations/samsara"],
  ]) {
    assert.equal(permissionForRequest(method, path), PERMISSION.INTEGRATION_ADMIN);
  }
});

test("disconnect preserves reconnect through fresh OAuth state and token upsert", async () => {
  const source = await readFile(repositoryUrl, "utf8");
  const credentialsSource = await readFile(credentialsRepositoryUrl, "utf8");
  assert.match(source, /saveOAuthState[\s\S]*status = 'oauth_pending'/i);
  assert.match(source, /saveOAuthTokens[\s\S]*saveOAuthAccountAndCredentialAtomic/i);
  assert.match(credentialsSource, /saveOAuthAccountAndCredentialAtomic[\s\S]*oauth_state = null/i);
  assert.match(credentialsSource, /saveOAuthAccountAndCredentialAtomic[\s\S]*await client\.query\("commit"\)/i);
});
