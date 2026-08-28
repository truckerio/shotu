import { getPool, query } from "../pool.js";

function publicFulfillment(row, legs = []) {
  if (!row) return null;
  return {
    id: row.id, companyId: row.company_id, workorderId: row.workorder_id, catalogPartId: row.catalog_part_id,
    destinationLocationId: row.destination_location_id, quantity: Number(row.quantity), uomCode: row.uom_code,
    neededBy: row.needed_by || null, state: row.state, recommendationVersion: Number(row.recommendation_version),
    createdAt: row.created_at, updatedAt: row.updated_at,
    legs: legs.map((leg) => ({ id: leg.id, routeType: leg.route_type, sourceLocationId: leg.source_location_id || null,
      sourceLocationName: leg.source_location_name || "", destinationLocationId: leg.destination_location_id,
      destinationLocationName: leg.destination_location_name || "", quantity: Number(leg.quantity), uomCode: leg.uom_code,
      state: leg.state, inventoryItemId: leg.inventory_item_id || null })),
  };
}

async function load(client, companyId, id) {
  const header = await client.query("select * from part_fulfillment_requests where company_id = $1 and id = $2 limit 1", [companyId, id]);
  if (!header.rows[0]) return null;
  const legs = await client.query(
    `select leg.*, source.name as source_location_name, destination.name as destination_location_name
     from part_fulfillment_legs leg
     left join locations source on source.company_id = leg.company_id and source.id = leg.source_location_id
     join locations destination on destination.company_id = leg.company_id and destination.id = leg.destination_location_id
     where leg.company_id = $1 and leg.fulfillment_request_id = $2
     order by leg.created_at, leg.id`,
    [companyId, id],
  );
  return publicFulfillment(header.rows[0], legs.rows);
}

async function lockActiveFulfillmentWorkorder(client, { companyId, workorderId, destinationLocationId }) {
  const result = await client.query(
    `select status, location_id
       from operational_workorders
      where company_id = $1 and id = $2
      for update`,
    [companyId, workorderId],
  );
  const workorder = result.rows[0];
  return Boolean(
    workorder
    && ["open", "accepted", "in_progress", "mechanic_done"].includes(workorder.status)
    && workorder.location_id === destinationLocationId
  );
}

export async function findFulfillmentAvailability({ companyId, catalogPartId, uomCode, limit = 20 }) {
  const result = await query(
    `select item.id, item.location_id, greatest(item.quantity_on_hand - item.quantity_reserved, 0) as quantity_available,
            item.uom_code, item.updated_at
       from inventory_items item
      where item.company_id = $1 and item.catalog_part_id = $2 and item.uom_code = $3
        and item.source_provider = 'local'
        and item.quantity_on_hand > item.quantity_reserved
      order by case when item.location_id is null then 1 else 0 end, item.updated_at desc, item.id
      limit $4`, [companyId, catalogPartId, uomCode, limit],
  );
  return result.rows.map((row) => ({ id: row.id, locationId: row.location_id, quantityAvailable: Number(row.quantity_available), uomCode: row.uom_code, updatedAt: row.updated_at }));
}

export async function findFulfillmentCatalogPart({ companyId, catalogPartId }) {
  const result = await query("select id, uom_code from parts_catalog where company_id = $1 and id = $2 limit 1", [companyId, catalogPartId]);
  return result.rows[0] ? { id: result.rows[0].id, uomCode: result.rows[0].uom_code } : null;
}

export async function createPartFulfillment(input) {
  const pool = getPool(); const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [`part-fulfillment:create:${input.companyId}:${input.actorId}:${input.idempotencyKey}`]);
    const existing = await client.query(
      "select id, request_hash from part_fulfillment_requests where company_id = $1 and created_by_user_id = $2 and idempotency_key = $3 for update",
      [input.companyId, input.actorId, input.idempotencyKey],
    );
    if (existing.rows[0]) {
      const kind = existing.rows[0].request_hash === input.requestHash ? "replay" : "conflict";
      const fulfillment = kind === "replay" ? await load(client, input.companyId, existing.rows[0].id) : null;
      await client.query("commit"); return { kind, fulfillment };
    }
    if (!await lockActiveFulfillmentWorkorder(client, input)) {
      await client.query("commit");
      return { kind: "inactive", fulfillment: null };
    }
    const inserted = await client.query(
      `insert into part_fulfillment_requests (company_id, workorder_id, catalog_part_id, destination_location_id, quantity, uom_code, needed_by, idempotency_key, request_hash, created_by_user_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
      [input.companyId, input.workorderId, input.catalogPartId, input.destinationLocationId, input.quantity, input.uomCode, input.neededBy, input.idempotencyKey, input.requestHash, input.actorId],
    );
    const id = inserted.rows[0].id;
    for (const leg of input.legs) await client.query(
      `insert into part_fulfillment_legs (company_id, fulfillment_request_id, route_type, source_location_id, destination_location_id, quantity, uom_code, state, inventory_item_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [input.companyId, id, leg.routeType, leg.sourceLocationId, input.destinationLocationId, leg.quantity, input.uomCode, leg.state, leg.inventoryItemId],
    );
    await client.query("insert into part_fulfillment_events (company_id, fulfillment_request_id, event_type, actor_id, details) values ($1,$2,'recommended',$3,$4::jsonb)", [input.companyId, id, input.actorId, JSON.stringify({ legs: input.legs.length })]);
    const fulfillment = await load(client, input.companyId, id); await client.query("commit"); return { kind: "created", fulfillment };
  } catch (error) { await client.query("rollback").catch(() => {}); throw error; } finally { client.release(); }
}

export async function getPartFulfillment({ fulfillmentId, companyIds, locationIds = [], isAdmin = false }) {
  const result = await query(
    `select request.company_id, request.id from part_fulfillment_requests request
      where request.id = $1 and request.company_id = any($2::uuid[])
        and ($4::boolean or request.destination_location_id = any($3::uuid[])) limit 1`,
    [fulfillmentId, companyIds, locationIds, isAdmin],
  );
  if (!result.rows[0]) return null;
  const pool = getPool(); const client = await pool.connect(); try { return await load(client, result.rows[0].company_id, fulfillmentId); } finally { client.release(); }
}

export async function approvePartFulfillment({ fulfillmentId, companyId, actorId, idempotencyKey, requestHash, recommendationVersion }) {
  const pool = getPool(); const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [`part-fulfillment:approve:${companyId}:${actorId}:${idempotencyKey}`]);
    const priorApproval = await client.query(
      `select id, approval_request_hash
       from part_fulfillment_requests
       where company_id = $1 and approved_by_user_id = $2 and approval_idempotency_key = $3
       for update`,
      [companyId, actorId, idempotencyKey],
    );
    if (priorApproval.rows[0]) {
      const sameApproval = priorApproval.rows[0].id === fulfillmentId
        && priorApproval.rows[0].approval_request_hash === requestHash;
      const fulfillment = sameApproval ? await load(client, companyId, fulfillmentId) : null;
      await client.query("commit");
      return { kind: sameApproval ? "replay" : "conflict", fulfillment };
    }
    const requestIdentity = await client.query(
      "select workorder_id, destination_location_id from part_fulfillment_requests where company_id = $1 and id = $2 limit 1",
      [companyId, fulfillmentId],
    );
    if (!requestIdentity.rows[0]) { await client.query("commit"); return { kind: "missing", fulfillment: null }; }
    if (!await lockActiveFulfillmentWorkorder(client, {
      companyId,
      workorderId: requestIdentity.rows[0].workorder_id,
      destinationLocationId: requestIdentity.rows[0].destination_location_id,
    })) {
      await client.query("commit");
      return { kind: "inactive", fulfillment: null };
    }
    const row = await client.query("select * from part_fulfillment_requests where company_id = $1 and id = $2 for update", [companyId, fulfillmentId]);
    const current = row.rows[0]; if (!current) { await client.query("commit"); return { kind: "missing", fulfillment: null }; }
    if (current.state === "approved") {
      const sameApproval = current.approval_idempotency_key === idempotencyKey
        && current.approval_request_hash === requestHash;
      const fulfillment = sameApproval ? await load(client, companyId, fulfillmentId) : null;
      await client.query("commit");
      return { kind: sameApproval ? "replay" : "conflict", fulfillment };
    }
    if (current.state !== "recommended" || Number(current.recommendation_version) !== recommendationVersion) { await client.query("commit"); return { kind: "stale", fulfillment: null }; }
    await client.query("update part_fulfillment_requests set state = 'approved', approved_by_user_id = $3, approval_idempotency_key = $4, approval_request_hash = $5, approved_at = now(), updated_at = now() where company_id = $1 and id = $2", [companyId, fulfillmentId, actorId, idempotencyKey, requestHash]);
    await client.query("insert into part_fulfillment_events (company_id, fulfillment_request_id, event_type, actor_id, details) values ($1,$2,'approved',$3,$4::jsonb)", [companyId, fulfillmentId, actorId, JSON.stringify({ idempotencyKey })]);
    const fulfillment = await load(client, companyId, fulfillmentId); await client.query("commit"); return { kind: "approved", fulfillment };
  } catch (error) { await client.query("rollback").catch(() => {}); throw error; } finally { client.release(); }
}
