import { query } from "../pool.js";

export async function getIntegrationStatus(provider) {
  const result = await query(
    `
      select provider, status, token_env_key, last_sync_cursor, last_full_sync_at, updated_at
           , access_token, refresh_token, token_type, scope, expires_at, oauth_state, oauth_state_created_at
      from integration_accounts
      where provider = $1
    `,
    [provider]
  );
  return result.rows[0] || null;
}

export async function saveOAuthState(provider, state) {
  const result = await query(
    `
      insert into integration_accounts (provider, status, oauth_state, oauth_state_created_at, updated_at)
      values ($1, 'oauth_pending', $2, now(), now())
      on conflict (provider)
      do update set
        status = 'oauth_pending',
        oauth_state = excluded.oauth_state,
        oauth_state_created_at = excluded.oauth_state_created_at,
        updated_at = now()
      returning provider, status, oauth_state, oauth_state_created_at
    `,
    [provider, state]
  );
  return result.rows[0];
}

export async function saveOAuthTokens(provider, tokens) {
  const result = await query(
    `
      insert into integration_accounts (
        provider, status, token_env_key, access_token, refresh_token, token_type, scope, expires_at,
        oauth_state, oauth_state_created_at, updated_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, null, null, now())
      on conflict (provider)
      do update set
        status = excluded.status,
        token_env_key = excluded.token_env_key,
        access_token = excluded.access_token,
        refresh_token = excluded.refresh_token,
        token_type = excluded.token_type,
        scope = excluded.scope,
        expires_at = excluded.expires_at,
        oauth_state = null,
        oauth_state_created_at = null,
        updated_at = now()
      returning provider, status, token_env_key, token_type, scope, expires_at, last_full_sync_at, updated_at
    `,
    [
      provider,
      tokens.status || "connected",
      tokens.tokenEnvKey || "SAMSARA_OAUTH",
      tokens.accessToken,
      tokens.refreshToken,
      tokens.tokenType || "bearer",
      tokens.scope || null,
      tokens.expiresAt,
    ]
  );
  return result.rows[0];
}

export async function upsertIntegrationStatus(provider, updates) {
  const result = await query(
    `
      insert into integration_accounts (provider, status, token_env_key, last_sync_cursor, last_full_sync_at, updated_at)
      values ($1, $2, $3, $4, $5, now())
      on conflict (provider)
      do update set
        status = excluded.status,
        token_env_key = excluded.token_env_key,
        last_sync_cursor = excluded.last_sync_cursor,
        last_full_sync_at = excluded.last_full_sync_at,
        updated_at = now()
      returning provider, status, token_env_key, last_sync_cursor, last_full_sync_at, updated_at
    `,
    [
      provider,
      updates.status || "connected",
      updates.tokenEnvKey || "SAMSARA_API_TOKEN",
      updates.lastSyncCursor || null,
      updates.lastFullSyncAt || null,
    ]
  );
  return result.rows[0];
}

export async function createSyncRun(provider, syncType) {
  const result = await query(
    `
      insert into integration_sync_runs (provider, sync_type, status)
      values ($1, $2, 'running')
      returning id, provider, sync_type, status, started_at
    `,
    [provider, syncType]
  );
  return result.rows[0];
}

export async function finishSyncRun(id, updates) {
  const result = await query(
    `
      update integration_sync_runs
      set status = $2,
          finished_at = now(),
          fetched_count = $3,
          changed_count = $4,
          error = $5
      where id = $1
      returning *
    `,
    [id, updates.status, updates.fetchedCount || 0, updates.changedCount || 0, updates.error || null]
  );
  return result.rows[0];
}
