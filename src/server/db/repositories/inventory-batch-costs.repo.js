import { getPool } from "../pool.js";

function publicRevision(row, layer = {}) {
  return row && {
    id: row.id,
    costLayerId: row.cost_layer_id,
    version: Number(row.version),
    unitCost: String(row.unit_cost),
    currency: row.currency,
    reason: row.reason,
    effectiveAt: row.effective_at,
    createdBy: row.created_by,
    catalogPartId: layer.catalog_part_id || null,
    locationId: layer.location_id || null,
  };
}

export async function appendInventoryBatchCostRevision(input) {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const layer = await client.query(
      `select layer.company_id,layer.location_id,layer.catalog_part_id
       from inventory_aggregate_cost_layers layer
       where layer.id=$1 and layer.company_id=any($2::uuid[])
         and ($4::boolean or layer.location_id=any($3::uuid[]))
       limit 1
       for update`,
      [input.costLayerId, input.companyIds, input.locationIds, input.isAdmin],
    );
    if (!layer.rows[0]) {
      await client.query("rollback");
      return { kind: "not_found" };
    }
    const companyId = layer.rows[0].company_id;
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [
      `batch-cost:${companyId}:${input.costLayerId}`,
    ]);
    const replay = await client.query(
      `select * from inventory_aggregate_cost_layer_revisions
       where company_id=$1 and created_by=$2 and idempotency_key=$3
       limit 1`,
      [companyId, input.actorId, input.idempotencyKey],
    );
    if (replay.rows[0]) {
      await client.query("commit");
      return replay.rows[0].request_hash === input.requestHash
        ? { kind: "saved", revision: publicRevision(replay.rows[0], layer.rows[0]), replayed: true }
        : { kind: "idempotency_conflict" };
    }
    const current = await client.query(
      `select * from inventory_aggregate_cost_layer_revisions
       where company_id=$1 and cost_layer_id=$2
       order by version desc limit 1`,
      [companyId, input.costLayerId],
    );
    const version = Number(current.rows[0]?.version || 0);
    if (version !== input.expectedVersion) {
      await client.query("rollback");
      return { kind: "stale", currentVersion: version };
    }
    const saved = await client.query(
      `insert into inventory_aggregate_cost_layer_revisions(
         company_id,cost_layer_id,version,unit_cost,currency,reason,
         previous_revision_id,created_by,idempotency_key,request_hash
       ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       returning *`,
      [companyId, input.costLayerId, version + 1, input.unitCost, input.currency,
        input.reason, current.rows[0]?.id || null, input.actorId,
        input.idempotencyKey, input.requestHash],
    );
    await client.query("commit");
    return { kind: "saved", revision: publicRevision(saved.rows[0], layer.rows[0]), replayed: false };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
