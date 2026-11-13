import { createHash } from "node:crypto";
import { getPool, query } from "../pool.js";
import { AuthError } from "../../auth/errors.js";

function setupRow(row) {
  if (!row) return null;
  return { companyId: row.company_id, operatingMode: row.operating_mode, shopIdentity: row.shop_identity,
    step: row.step, status: row.status, version: row.version,
    completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null };
}
export async function getBusinessSetup(companyId) {
  return setupRow((await query("select * from business_setups where company_id=$1", [companyId])).rows[0]);
}
export async function getBusinessSetupDefaults(companyId, locationId) {
  const result = await query(`select c.name, l.address from companies c
    left join locations l on l.id=$2 and l.company_id=c.id where c.id=$1`, [companyId, locationId || null]);
  return result.rows[0] || null;
}
export async function saveBusinessSetup(input, actorId, dependencies = {}) {
  const client = await (dependencies.pool || getPool()).connect();
  const requestHash = createHash("sha256").update(JSON.stringify({ companyId: input.companyId, locationId: input.locationId || null,
    expectedVersion: input.expectedVersion, operatingMode: input.operatingMode, shopIdentity: input.shopIdentity,
    step: input.step, status: input.status })).digest("hex");
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`business-setup:${input.companyId}`]);
    const prior = (await client.query("select request_hash,result from business_setup_idempotency where company_id=$1 and actor_id=$2 and idempotency_key=$3", [input.companyId, actorId, input.idempotencyKey])).rows[0];
    if (prior) {
      if (prior.request_hash !== requestHash) throw new AuthError(409, "IDEMPOTENCY_KEY_CONFLICT", "This request key was already used for different data.");
      await client.query("commit");
      return prior.result;
    }
    const current = (await client.query("select * from business_setups where company_id=$1 for update", [input.companyId])).rows[0];
    if ((current?.version || 0) !== input.expectedVersion) throw new AuthError(409, "BUSINESS_SETUP_VERSION_CONFLICT", "Business setup has changed. Refresh and try again.");
    const saved = (await client.query(`insert into business_setups (company_id,operating_mode,shop_identity,step,status,version,completed_at)
      values ($1,$2,$3::jsonb,$4,$5,1,case when $5='completed' then now() else null end)
      on conflict (company_id) do update set operating_mode=excluded.operating_mode,shop_identity=excluded.shop_identity,
      step=excluded.step,status=excluded.status,version=business_setups.version+1,
      completed_at=case when excluded.status='completed' then coalesce(business_setups.completed_at,now()) else null end,updated_at=now()
      returning *`, [input.companyId, input.operatingMode, JSON.stringify(input.shopIdentity), input.step, input.status])).rows[0];
    const result = setupRow(saved);
    await client.query("insert into business_setup_audit_events (company_id,actor_id,setup) values ($1,$2,$3::jsonb)", [input.companyId, actorId, JSON.stringify(result)]);
    await client.query("insert into business_setup_idempotency (company_id,actor_id,idempotency_key,request_hash,result) values ($1,$2,$3,$4,$5::jsonb)", [input.companyId, actorId, input.idempotencyKey, requestHash, JSON.stringify(result)]);
    await client.query("commit");
    return result;
  } catch (error) { await client.query("rollback").catch(() => {}); throw error; }
  finally { client.release(); }
}
