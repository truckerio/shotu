import { query } from "../../db/pool.js";
import { requireCompanyId } from "../../db/company.js";

export async function insertIntegrationClient({
  companyId,
  name,
  tokenPrefix,
  tokenHash,
  scopes,
  expiresAt = null,
  createdByUserId = null,
  client = null,
}) {
  const tenantId = requireCompanyId(companyId);
  const execute = client ? client.query.bind(client) : query;
  const result = await execute(
    `insert into integration_clients (
       company_id, name, token_prefix, token_hash, scopes, expires_at, created_by_user_id
     ) values ($1, $2, $3, $4, $5::text[], $6, $7::uuid)
     returning id, company_id, name, token_prefix, scopes, active, expires_at, last_used_at, created_at, updated_at`,
    [tenantId, name, tokenPrefix, tokenHash, scopes, expiresAt, createdByUserId],
  );
  return result.rows[0];
}

export async function findIntegrationClientByPrefix(prefix) {
  const result = await query(
    `select id, company_id, name, token_prefix, token_hash, scopes, active, expires_at, last_used_at
     from integration_clients
     where token_prefix = $1
     limit 1`,
    [prefix],
  );
  return result.rows[0] || null;
}

export async function touchIntegrationClient(id) {
  await query(
    `update integration_clients
     set last_used_at = now(), updated_at = now()
     where id = $1`,
    [id],
  );
}

export async function listIntegrationClients(companyId) {
  const tenantId = requireCompanyId(companyId);
  const result = await query(
    `select id, company_id, name, token_prefix, scopes, active, expires_at, last_used_at,
            revoked_at, created_at, updated_at
     from integration_clients
     where company_id = $1
     order by created_at desc`,
    [tenantId],
  );
  return result.rows;
}

export async function revokeIntegrationClient({
  companyId,
  clientId,
  revokedByUserId = null,
  client = null,
}) {
  const tenantId = requireCompanyId(companyId);
  const execute = client ? client.query.bind(client) : query;
  const result = await execute(
    `update integration_clients
     set active = false,
         revoked_at = coalesce(revoked_at, now()),
         revoked_by_user_id = coalesce(revoked_by_user_id, $3::uuid),
         updated_at = now()
     where company_id = $1 and id = $2
     returning id, company_id, name, token_prefix, scopes, active, expires_at, last_used_at,
               revoked_at, created_at, updated_at`,
    [tenantId, clientId, revokedByUserId],
  );
  return result.rows[0] || null;
}
