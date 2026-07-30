import { getPool, query } from "../pool.js";
import { requireCompanyId } from "../company.js";
import {
  readIntegrationCredential,
  saveOAuthAccountAndCredentialAtomic,
} from "../../integrations/core/integration-credentials.repo.js";

export async function getIntegrationStatus(provider, companyId) {
  const tenantId = requireCompanyId(companyId);
  const result = await query(
    `
      select id, company_id, provider, status, token_env_key, last_sync_cursor, last_full_sync_at, updated_at,
             token_type, scope, expires_at, oauth_state, oauth_state_created_at,
             (
               exists (
                 select 1 from integration_credentials credential
                 where credential.integration_account_id = integration_accounts.id
                   and credential.credential_kind = 'oauth'
               )
               or access_token is not null
               or refresh_token is not null
             ) as has_credentials
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
        and (
          access_token is not null
          or refresh_token is not null
          or exists (
            select 1 from integration_credentials credential
            where credential.integration_account_id = integration_accounts.id
              and credential.credential_kind = 'oauth'
          )
        )
      order by company_id
    `,
    [provider],
  );
  return result.rows;
}

export async function getLatestIntegrationSyncRun(provider, companyId) {
  const tenantId = requireCompanyId(companyId);
  const result = await query(
    `
      select
        id,
        company_id,
        integration_account_id,
        provider,
        sync_type,
        status,
        started_at,
        finished_at,
        fetched_count,
        changed_count,
        (error is not null) as has_error
      from integration_sync_runs
      where company_id = $1 and provider = $2
      order by started_at desc, id desc
      limit 1
    `,
    [tenantId, provider],
  );
  return result.rows[0] || null;
}

export async function disconnectIntegration(provider, companyId) {
  const tenantId = requireCompanyId(companyId);
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const accountResult = await client.query(
      `
        insert into integration_accounts (
          company_id,
          provider,
          status,
          token_env_key,
          access_token,
          refresh_token,
          token_type,
          scope,
          expires_at,
          oauth_state,
          oauth_state_created_at,
          updated_at
        )
        values ($1, $2, 'disconnected', '', null, null, null, null, null, null, null, now())
        on conflict (company_id, provider)
        do update set
          status = 'disconnected',
          token_env_key = '',
          access_token = null,
          refresh_token = null,
          token_type = null,
          scope = null,
          expires_at = null,
          oauth_state = null,
          oauth_state_created_at = null,
          last_sync_cursor = null,
          updated_at = now()
        returning id, company_id, provider, status, last_full_sync_at, updated_at
      `,
      [tenantId, provider],
    );
    const account = accountResult.rows[0];
    await client.query(
      `delete from integration_credentials
       where company_id = $1 and integration_account_id = $2`,
      [tenantId, account.id],
    );
    const runResult = await client.query(
      `
        insert into integration_sync_runs (
          company_id,
          integration_account_id,
          provider,
          sync_type,
          status,
          started_at,
          finished_at,
          fetched_count,
          changed_count,
          error
        )
        values ($1, $2, $3, 'disconnect', 'completed', now(), now(), 0, 0, null)
        returning
          id,
          company_id,
          integration_account_id,
          provider,
          sync_type,
          status,
          started_at,
          finished_at,
          fetched_count,
          changed_count,
          false as has_error
      `,
      [tenantId, account.id, provider],
    );
    await client.query("commit");
    return { account, run: runResult.rows[0] };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
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
  return saveOAuthAccountAndCredentialAtomic({
    companyId: requireCompanyId(companyId),
    provider,
    tokens,
  });
}

export async function getIntegrationOAuthCredential(provider, companyId) {
  const tenantId = requireCompanyId(companyId);
  const result = await query(
    `select id, access_token, refresh_token
     from integration_accounts
     where company_id = $1 and provider = $2
     limit 1`,
    [tenantId, provider],
  );
  const account = result.rows[0];
  if (!account) return null;
  const encrypted = await readIntegrationCredential({
    companyId: tenantId,
    integrationAccountId: account.id,
    provider,
    credentialKind: "oauth",
  });
  if (encrypted) return encrypted;
  if (account.access_token || account.refresh_token) {
    return {
      accessToken: account.access_token || "",
      refreshToken: account.refresh_token || "",
      legacyPlaintext: true,
    };
  }
  return null;
}

export async function clearIntegrationOAuthCredentials(
  provider,
  companyId,
  { status = "configured", tokenEnvKey = "" } = {},
) {
  const tenantId = requireCompanyId(companyId);
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const result = await client.query(
      `update integration_accounts
       set status = $3,
           token_env_key = $4,
           access_token = null,
           refresh_token = null,
           token_type = null,
           scope = null,
           expires_at = null,
           oauth_state = null,
           oauth_state_created_at = null,
           updated_at = now()
       where company_id = $1 and provider = $2
       returning id, company_id, provider, status, token_env_key, updated_at`,
      [tenantId, provider, status, tokenEnvKey],
    );
    const account = result.rows[0] || null;
    if (account) {
      await client.query(
        `delete from integration_credentials
         where company_id = $1
           and integration_account_id = $2
           and credential_kind = 'oauth'`,
        [tenantId, account.id],
      );
    }
    await client.query("commit");
    return account;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
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
