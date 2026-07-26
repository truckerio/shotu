import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { migrate } from "../../db/migrate.js";
import { closePool, query } from "../../db/pool.js";
import {
  disconnectIntegration,
  getIntegrationStatus,
  getLatestIntegrationSyncRun,
  saveOAuthState,
  saveOAuthTokens,
} from "../../db/repositories/integrations.repo.js";

const companyId = randomUUID();
const slug = `samsara-settings-${companyId.slice(0, 8)}`;

async function cleanup() {
  await query("delete from integration_sync_runs where company_id = $1", [companyId]);
  await query("delete from integration_accounts where company_id = $1", [companyId]);
  await query("delete from companies where id = $1", [companyId]);
}

try {
  await migrate();
  await query(
    "insert into companies (id, slug, name) values ($1, $2, 'Samsara settings integration test')",
    [companyId, slug],
  );

  await saveOAuthState("samsara", "initial-state", companyId);
  await saveOAuthTokens("samsara", {
    status: "connected",
    accessToken: "initial-access-token",
    refreshToken: "initial-refresh-token",
    tokenType: "bearer",
    scope: "vehicles:read",
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  }, companyId);

  const disconnected = await disconnectIntegration("samsara", companyId);
  assert.deepEqual(Object.keys(disconnected.account).sort(), [
    "company_id",
    "id",
    "last_full_sync_at",
    "provider",
    "status",
    "updated_at",
  ]);
  assert.equal(disconnected.account.status, "disconnected");
  assert.equal(disconnected.run.sync_type, "disconnect");
  assert.equal(disconnected.run.status, "completed");
  assert.equal(disconnected.run.has_error, false);

  const cleared = await getIntegrationStatus("samsara", companyId);
  assert.equal(cleared.access_token, null);
  assert.equal(cleared.refresh_token, null);
  assert.equal(cleared.token_type, null);
  assert.equal(cleared.scope, null);
  assert.equal(cleared.expires_at, null);
  assert.equal(cleared.oauth_state, null);
  assert.equal(cleared.oauth_state_created_at, null);

  const latest = await getLatestIntegrationSyncRun("samsara", companyId);
  assert.equal(latest.sync_type, "disconnect");
  assert.equal(latest.status, "completed");
  assert.equal(latest.has_error, false);

  await saveOAuthState("samsara", "reconnect-state", companyId);
  const pending = await getIntegrationStatus("samsara", companyId);
  assert.equal(pending.status, "oauth_pending");
  assert.equal(pending.oauth_state, "reconnect-state");

  await saveOAuthTokens("samsara", {
    status: "connected",
    accessToken: "reconnected-access-token",
    refreshToken: "reconnected-refresh-token",
    tokenType: "bearer",
    scope: "vehicles:read",
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  }, companyId);
  const reconnected = await getIntegrationStatus("samsara", companyId);
  assert.equal(reconnected.status, "connected");
  assert.equal(reconnected.access_token, "reconnected-access-token");
  assert.equal(reconnected.refresh_token, "reconnected-refresh-token");
  assert.equal(reconnected.oauth_state, null);

  process.stdout.write(`${JSON.stringify({
    passed: true,
    credentialsCleared: true,
    auditRecorded: true,
    reconnectSupported: true,
  })}\n`);
} finally {
  await cleanup();
  await closePool();
}
