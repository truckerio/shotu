import { getPool, query } from "../pool.js";

export class ProductModuleAccessConflictError extends Error {
  constructor() {
    super("Product module access changed elsewhere. Reload and try again.");
    this.name = "ProductModuleAccessConflictError";
    this.statusCode = 409;
    this.code = "PRODUCT_MODULE_ACCESS_CONFLICT";
  }
}

function publicRule(row) {
  if (!row) return null;
  return {
    id: row.id,
    companyId: row.company_id,
    locationId: row.location_id || null,
    subjectType: row.subject_type,
    subjectId: row.subject_type === "user" ? row.user_id : row.role_key,
    moduleKey: row.module_key,
    mode: row.access_mode,
    version: Number(row.version),
    updatedAt: row.updated_at,
  };
}

export async function listProductModuleAccessRules({ companyIds, locationIds = null }, dependencies = {}) {
  if (!companyIds?.length) return [];
  const run = dependencies.query || query;
  const result = await run(
    `select * from product_module_access_rules
     where company_id = any($1::uuid[])
       and (location_id is null or $2::uuid[] is null or location_id = any($2::uuid[]))
     order by company_id, location_id nulls first, subject_type, module_key`,
    [companyIds, locationIds],
  );
  return result.rows.map(publicRule);
}

export async function listProductAccessLocations({ companyIds, locationIds = null }, dependencies = {}) {
  if (!companyIds?.length) return [];
  const run = dependencies.query || query;
  const result = await run(
    `select id, company_id, name from locations
     where active = true and company_id = any($1::uuid[])
       and ($2::uuid[] is null or id = any($2::uuid[]))
     order by company_id, id`,
    [companyIds, locationIds],
  );
  return result.rows.map((row) => ({ locationId: row.id, companyId: row.company_id, name: row.name }));
}

export async function saveProductModuleAccessRule(input, dependencies = {}) {
  const pool = dependencies.pool || getPool();
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [
      `product-module:${input.companyId}:${input.locationId || "company"}:${input.subjectType}:${input.subjectId}:${input.moduleKey}`,
    ]);
    const existing = await client.query(
      `select * from product_module_access_rules
       where company_id=$1 and location_id is not distinct from $2::uuid
         and subject_type=$3 and module_key=$4
         and (($3='role' and role_key=$5 and user_id is null) or ($3='user' and user_id=$5::uuid and role_key is null))
       for update`,
      [input.companyId, input.locationId || null, input.subjectType, input.moduleKey, input.subjectId],
    );
    const before = existing.rows[0] || null;
    if (Number(input.expectedVersion || 0) !== Number(before?.version || 0)) throw new ProductModuleAccessConflictError();
    let saved;
    if (input.mode === "inherit") {
      if (before) await client.query("delete from product_module_access_rules where id=$1", [before.id]);
      saved = null;
    } else if (before) {
      const updated = await client.query(
        `update product_module_access_rules set access_mode=$2, version=version+1,
           updated_by_user_id=$3, updated_at=now() where id=$1 returning *`,
        [before.id, input.mode, input.actorId],
      );
      saved = updated.rows[0];
    } else {
      const inserted = await client.query(
        `insert into product_module_access_rules (
           company_id,location_id,subject_type,role_key,user_id,module_key,access_mode,updated_by_user_id
         ) values ($1,$2,$3,case when $3='role' then $4 else null end,
           case when $3='user' then $4::uuid else null end,$5,$6,$7) returning *`,
        [input.companyId, input.locationId || null, input.subjectType, input.subjectId, input.moduleKey, input.mode, input.actorId],
      );
      saved = inserted.rows[0];
    }
    await client.query(
      `insert into product_module_access_events(company_id,location_id,rule_id,actor_id,action,before_value,after_value)
       values($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)`,
      [input.companyId, input.locationId || null, saved?.id || null, input.actorId,
        !before ? "created" : saved ? "updated" : "removed", before ? JSON.stringify(publicRule(before)) : null,
        saved ? JSON.stringify(publicRule(saved)) : null],
    );
    await client.query("commit");
    return publicRule(saved);
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export const productModuleAccessInternals = { publicRule };
