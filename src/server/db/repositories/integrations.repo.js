import { query } from "../pool.js";
import { requireCompanyId } from "../company.js";

export async function getIntegrationStatus(provider, companyId) {
  const tenantId = requireCompanyId(companyId);
  const result = await query(
    `
      select id, company_id, provider, status, token_env_key, last_sync_cursor, last_full_sync_at, updated_at
           , access_token, refresh_token, token_type, scope, expires_at, oauth_state, oauth_state_created_at
      from integration_accounts
      where company_id = $1 and provider = $2
    `,
    [tenantId, provider]
  );
  return result.rows[0] || null;
}

export async function findIntegrationByOAuthState(provider, state) {
  const result = await query(
    `
      select id, company_id, provider, status, oauth_state, oauth_state_created_at
      from integration_accounts
      where provider = $1 and oauth_state = $2
      limit 1
    `,
    [provider, state],
  );
  return result.rows[0] || null;
}

export async function listConnectedIntegrationAccounts(provider) {
  const result = await query(
    `
      select id, company_id, provider, status, last_full_sync_at
      from integration_accounts
      where provider = $1
        and status in ('connected', 'configured')
        and (access_token is not null or refresh_token is not null)
      order by company_id
    `,
    [provider],
  );
  return result.rows;
}

export async function saveOAuthState(provider, state, companyId) {
  const tenantId = requireCompanyId(companyId);
  const result = await query(
    `
      insert into integration_accounts (company_id, provider, status, oauth_state, oauth_state_created_at, updated_at)
      values ($1, $2, 'oauth_pending', $3, now(), now())
      on conflict (company_id, provider)
      do update set
        status = 'oauth_pending',
        oauth_state = excluded.oauth_state,
        oauth_state_created_at = excluded.oauth_state_created_at,
        updated_at = now()
      returning id, company_id, provider, status, oauth_state, oauth_state_created_at
    `,
    [tenantId, provider, state]
  );
  return result.rows[0];
}

export async function saveOAuthTokens(provider, tokens, companyId) {
  const tenantId = requireCompanyId(companyId);
  const result = await query(
    `
      insert into integration_accounts (
        company_id, provider, status, token_env_key, access_token, refresh_token, token_type, scope, expires_at,
        oauth_state, oauth_state_created_at, updated_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, null, null, now())
      on conflict (company_id, provider)
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
      returning id, company_id, provider, status, token_env_key, token_type, scope, expires_at, last_full_sync_at, updated_at
    `,
    [
      tenantId,
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

export async function upsertIntegrationStatus(provider, updates, companyId) {
  const tenantId = requireCompanyId(companyId);
  const result = await query(
    `
      insert into integration_accounts (
        company_id, provider, status, token_env_key, last_sync_cursor, last_full_sync_at, updated_at
      )
      values ($1, $2, $3, $4, $5, $6, now())
      on conflict (company_id, provider)
      do update set
        status = excluded.status,
        token_env_key = excluded.token_env_key,
        last_sync_cursor = excluded.last_sync_cursor,
        last_full_sync_at = excluded.last_full_sync_at,
        updated_at = now()
      returning id, company_id, provider, status, token_env_key, last_sync_cursor, last_full_sync_at, updated_at
    `,
    [
      tenantId,
      provider,
      updates.status || "connected",
      updates.tokenEnvKey || "SAMSARA_API_TOKEN",
      updates.lastSyncCursor || null,
      updates.lastFullSyncAt || null,
    ]
  );
  return result.rows[0];
}

export async function createSyncRun(provider, syncType, companyId) {
  const tenantId = requireCompanyId(companyId);
  const result = await query(
    `
      insert into integration_sync_runs (
        company_id, integration_account_id, provider, sync_type, status
      )
      values (
        $1,
        (select id from integration_accounts where company_id = $1 and provider = $2 limit 1),
        $2,
        $3,
        'running'
      )
      returning id, company_id, integration_account_id, provider, sync_type, status, started_at
    `,
    [tenantId, provider, syncType]
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
