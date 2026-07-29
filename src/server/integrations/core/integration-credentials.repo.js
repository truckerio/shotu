import { getPool, query } from "../../db/pool.js";
import { requireCompanyId } from "../../db/company.js";
import {
  decryptIntegrationSecret,
  encryptIntegrationSecret,
} from "./integration-crypto.js";

export async function saveIntegrationCredential({
  companyId,
  integrationAccountId,
  provider,
  credentialKind,
  secret,
  metadata = {},
}) {
  const tenantId = requireCompanyId(companyId);
  const context = {
    companyId: tenantId,
    provider,
    accountId: integrationAccountId,
    credentialKind,
  };
  const encrypted = encryptIntegrationSecret(secret, context);
  const result = await query(
    `insert into integration_credentials (
       company_id, integration_account_id, provider, credential_kind,
       ciphertext, iv, auth_tag, key_version, metadata, updated_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, now())
     on conflict (integration_account_id, credential_kind) do update
     set ciphertext = excluded.ciphertext,
         iv = excluded.iv,
         auth_tag = excluded.auth_tag,
         key_version = excluded.key_version,
         metadata = excluded.metadata,
         updated_at = now()
     returning id, company_id, integration_account_id, provider, credential_kind,
               key_version, metadata, created_at, updated_at`,
    [
      tenantId,
      integrationAccountId,
      provider,
      credentialKind,
      encrypted.ciphertext,
      encrypted.iv,
      encrypted.authTag,
      encrypted.keyVersion,
      JSON.stringify(metadata),
    ],
  );
  return result.rows[0];
}

export async function readIntegrationCredential({
  companyId,
  integrationAccountId,
  provider,
  credentialKind,
}) {
  const tenantId = requireCompanyId(companyId);
  const result = await query(
    `select ciphertext, iv, auth_tag, key_version, metadata
     from integration_credentials
     where company_id = $1
       and integration_account_id = $2
       and provider = $3
       and credential_kind = $4
     limit 1`,
    [tenantId, integrationAccountId, provider, credentialKind],
  );
  const encrypted = result.rows[0];
  if (!encrypted) return null;
  return decryptIntegrationSecret({
    ciphertext: encrypted.ciphertext,
    iv: encrypted.iv,
    authTag: encrypted.auth_tag,
    keyVersion: encrypted.key_version,
  }, {
    companyId: tenantId,
    provider,
    accountId: integrationAccountId,
    credentialKind,
  });
}

export async function deleteIntegrationCredentials({ companyId, integrationAccountId }) {
  const tenantId = requireCompanyId(companyId);
  await query(
    `delete from integration_credentials
     where company_id = $1 and integration_account_id = $2`,
    [tenantId, integrationAccountId],
  );
}

export async function saveOAuthCredentialAndClearLegacy({
  companyId,
  account,
  provider,
  secret,
  metadata = {},
}) {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const context = {
      companyId,
      provider,
      accountId: account.id,
      credentialKind: "oauth",
    };
    const encrypted = encryptIntegrationSecret(secret, context);
    await client.query(
      `insert into integration_credentials (
         company_id, integration_account_id, provider, credential_kind,
         ciphertext, iv, auth_tag, key_version, metadata, updated_at
       ) values ($1, $2, $3, 'oauth', $4, $5, $6, $7, $8::jsonb, now())
       on conflict (integration_account_id, credential_kind) do update
       set ciphertext = excluded.ciphertext,
           iv = excluded.iv,
           auth_tag = excluded.auth_tag,
           key_version = excluded.key_version,
           metadata = excluded.metadata,
           updated_at = now()`,
      [
        companyId,
        account.id,
        provider,
        encrypted.ciphertext,
        encrypted.iv,
        encrypted.authTag,
        encrypted.keyVersion,
        JSON.stringify(metadata),
      ],
    );
    await client.query(
      `update integration_accounts
       set access_token = null, refresh_token = null, updated_at = now()
       where id = $1 and company_id = $2`,
      [account.id, companyId],
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function saveOAuthAccountAndCredentialAtomic({
  companyId,
  provider,
  tokens,
}) {
  const tenantId = requireCompanyId(companyId);
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const accountResult = await client.query(
      `insert into integration_accounts (
         company_id, provider, status, token_env_key, access_token, refresh_token,
         token_type, scope, expires_at, oauth_state, oauth_state_created_at, updated_at
       )
       values ($1, $2, $3, $4, null, null, $5, $6, $7, null, null, now())
       on conflict (company_id, provider)
       do update set
         status = excluded.status,
         token_env_key = excluded.token_env_key,
         access_token = null,
         refresh_token = null,
         token_type = excluded.token_type,
         scope = excluded.scope,
         expires_at = excluded.expires_at,
         oauth_state = null,
         oauth_state_created_at = null,
         updated_at = now()
       returning id, company_id, provider, status, token_env_key, token_type, scope,
                 expires_at, last_full_sync_at, updated_at`,
      [
        tenantId,
        provider,
        tokens.status || "connected",
        tokens.tokenEnvKey || "SAMSARA_OAUTH",
        tokens.tokenType || "bearer",
        tokens.scope || null,
        tokens.expiresAt || null,
      ],
    );
    const account = accountResult.rows[0];
    const context = {
      companyId: tenantId,
      provider,
      accountId: account.id,
      credentialKind: "oauth",
    };
    const encrypted = encryptIntegrationSecret({
      accessToken: tokens.accessToken || "",
      refreshToken: tokens.refreshToken || "",
    }, context);
    await client.query(
      `insert into integration_credentials (
         company_id, integration_account_id, provider, credential_kind,
         ciphertext, iv, auth_tag, key_version, metadata, updated_at
       ) values ($1, $2, $3, 'oauth', $4, $5, $6, $7, $8::jsonb, now())
       on conflict (integration_account_id, credential_kind) do update
       set ciphertext = excluded.ciphertext,
           iv = excluded.iv,
           auth_tag = excluded.auth_tag,
           key_version = excluded.key_version,
           metadata = excluded.metadata,
           updated_at = now()`,
      [
        tenantId,
        account.id,
        provider,
        encrypted.ciphertext,
        encrypted.iv,
        encrypted.authTag,
        encrypted.keyVersion,
        JSON.stringify({
          tokenType: tokens.tokenType || "bearer",
          scope: tokens.scope || null,
          expiresAt: tokens.expiresAt || null,
        }),
      ],
    );
    await client.query("commit");
    return account;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
