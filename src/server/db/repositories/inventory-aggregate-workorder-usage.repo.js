import { getPool, query } from "../pool.js";
import { hasQuantityPrecision } from "../../modules/parts/quantity-uom.js";
import {
  reserveAggregateInventoryPositions, pickAggregateInventoryPositions,
  releaseAggregateInventoryPositions, consumeAggregateInventoryPositions,
  adjustConsumedAggregateInventoryPositions,
} from "./inventory-positions.repo.js";

const MEASURED_CATEGORIES = new Set(["liquid_volume", "mass", "gas_volume", "length"]);
const QUANTITY_CATEGORIES = new Set(["count", "packaging"]);

export async function listAggregateWorkorderUsages({
  workorderId,
  companyId,
  locationId,
  limit = 200,
}) {
  const result = await query(
    `with recursive position_tree as (
       select position.id,position.company_id,position.location_id,position.parent_id,position.name,position.name::text path
       from inventory_positions position
       where position.company_id=$1 and position.location_id=$3 and position.parent_id is null
       union all
       select child.id,child.company_id,child.location_id,child.parent_id,child.name,(tree.path||' / '||child.name)::text
       from inventory_positions child join position_tree tree
         on child.company_id=tree.company_id and child.location_id=tree.location_id and child.parent_id=tree.id
     )
     select usage.id, usage.evidence_id, usage.workorder_id, usage.location_id,
            usage.catalog_part_id, usage.quantity, usage.adjustment_total,
            usage.uom_code, usage.status, usage.repair_order,
            catalog.part_number, catalog.description,
            source.source_position_path
     from workorder_aggregate_part_usages usage
     join parts_catalog catalog
       on catalog.company_id=usage.company_id and catalog.id=usage.catalog_part_id
     left join lateral (
       select string_agg(tree.path||' ('||allocation.quantity::text||' '||usage.uom_code||')',', ' order by tree.path) source_position_path
       from inventory_aggregate_usage_position_allocations allocation
       join position_tree tree on tree.company_id=allocation.company_id and tree.id=allocation.position_id
       where allocation.company_id=usage.company_id and allocation.usage_id=usage.id
     ) source on true
     where usage.company_id=$1 and usage.workorder_id=$2 and usage.location_id=$3
     order by usage.created_at, usage.id
     limit $4`,
    [companyId, workorderId, locationId, Math.max(1, Math.min(Number(limit) || 200, 200))],
  );
  return result.rows.map((row) => ({
    id: row.id,
    evidenceId: row.evidence_id,
    workorderId: row.workorder_id,
    locationId: row.location_id,
    catalogPartId: row.catalog_part_id,
    originalQuantity: Number(row.quantity),
    effectiveQuantity: Number(row.quantity) + Number(row.adjustment_total),
    uomCode: row.uom_code,
    status: row.status,
    repairOrder: row.repair_order,
    partNumber: row.part_number,
    description: row.description,
    sourcePositionPath: row.source_position_path || "",
  }));
}

function publicUsage(row) {
  return row && {
    id: row.id,
    evidenceId: row.evidence_id,
    workorderId: row.workorder_id,
    catalogPartId: row.catalog_part_id,
    locationId: row.location_id,
    quantity: Number(row.quantity),
    uomCode: row.uom_code,
    status: row.status,
    repairOrder: row.repair_order,
  };
}

export async function reserveAggregateWorkorderUsage(input, transactionClient = null) {
  const client = transactionClient || await getPool().connect();
  const managesTransaction = !transactionClient;
  const finish = async (command) => { if (managesTransaction) await client.query(command); };
  try {
    await finish("begin");
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [
      `aggregate-usage:${input.actorId}:${input.idempotencyKey}`,
    ]);
    const replay = await client.query(
      `select * from workorder_aggregate_part_usages
       where company_id = any($1::uuid[]) and created_by_user_id=$2 and idempotency_key=$3
       limit 1 for update`,
      [input.companyIds, input.actorId, input.idempotencyKey],
    );
    if (replay.rows[0]) {
      await finish("commit");
      return replay.rows[0].request_hash === input.requestHash
        ? { kind: "replay", usage: publicUsage(replay.rows[0]) }
        : { kind: "idempotency_conflict" };
    }
    const selected = await client.query(
      `select workorder.id, workorder.company_id, workorder.location_id, workorder.status,
              catalog.uom_code, catalog.tracking_mode, uom.category, uom.decimal_scale
       from operational_workorders workorder
       join parts_catalog catalog on catalog.company_id=workorder.company_id and catalog.id=$2
       join units_of_measure uom on uom.code=catalog.uom_code
       where workorder.id=$1 and workorder.company_id=any($3::uuid[])
         and ($5::boolean or workorder.location_id=any($4::uuid[]))
       limit 1 for update of workorder`,
      [input.workorderId, input.catalogPartId, input.companyIds, input.locationIds, input.isAdmin],
    );
    const workorder = selected.rows[0];
    if (!workorder) { await finish("rollback"); return { kind: "not_found" }; }
    if (!["open", "accepted", "in_progress"].includes(workorder.status)) {
      await finish("rollback"); return { kind: "inactive_workorder" };
    }
    const scaleValid = hasQuantityPrecision(input.quantity, Number(workorder.decimal_scale));
    const supportsMeasured = workorder.tracking_mode === "measured_bulk" && MEASURED_CATEGORIES.has(workorder.category) && scaleValid;
    const supportsQuantity = workorder.tracking_mode === "quantity" && QUANTITY_CATEGORIES.has(workorder.category)
      && Number(workorder.decimal_scale) === 0 && Number.isInteger(input.quantity);
    const supportsLegacyMeasured = workorder.tracking_mode === null && MEASURED_CATEGORIES.has(workorder.category) && scaleValid;
    if ((!supportsMeasured && !supportsQuantity && !supportsLegacyMeasured) || workorder.uom_code !== input.uomCode) {
      await finish("rollback"); return { kind: "unsupported_uom" };
    }
    const balance = await client.query(
      `select id, quantity_on_hand, quantity_reserved
       from inventory_items
       where company_id=$1 and location_id=$2 and catalog_part_id=$3 and uom_code=$4
         and source_provider='local'
       limit 1 for update`,
      [workorder.company_id, workorder.location_id, input.catalogPartId, input.uomCode],
    );
    const stock = balance.rows[0];
    if (!stock || Number(stock.quantity_on_hand) - Number(stock.quantity_reserved) < input.quantity) {
      await finish("rollback"); return { kind: "insufficient_stock" };
    }
    const sourcePosition = input.sourcePositionId ? await client.query(
      `select position.id
       from inventory_positions position
       join inventory_position_balances balance
         on balance.company_id=position.company_id and balance.position_id=position.id
       where position.company_id=$1 and position.location_id=$2 and position.id=$3
         and position.is_active and position.can_store and position.is_pickable
         and balance.inventory_item_id=$4
         and balance.quantity-balance.quantity_reserved >= $5
       limit 1 for update of position, balance`,
      [workorder.company_id, workorder.location_id, input.sourcePositionId, stock.id, input.quantity],
    ) : { rows: [] };
    if (!sourcePosition.rows[0]) {
      await finish("rollback"); return { kind: "source_position_unavailable" };
    }
    await client.query(
      `update inventory_items set quantity_reserved=quantity_reserved+$3, updated_at=now()
       where company_id=$1 and id=$2`,
      [workorder.company_id, stock.id, input.quantity],
    );
    const inserted = await client.query(
      `insert into workorder_aggregate_part_usages (
         company_id, workorder_id, location_id, catalog_part_id, quantity, uom_code, tracking_mode,
         repair_order, created_by_user_id, idempotency_key, request_hash
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *`,
      [workorder.company_id, input.workorderId, workorder.location_id, input.catalogPartId,
        input.quantity, input.uomCode, supportsQuantity ? "quantity" : "measured_bulk", input.repairOrder,
        input.actorId, input.idempotencyKey, input.requestHash],
    );
    const usage = inserted.rows[0];
    await reserveAggregateInventoryPositions(client, {
      companyId: workorder.company_id, locationId: workorder.location_id, inventoryItemId: stock.id,
      catalogPartId: input.catalogPartId, uomCode: input.uomCode, usageId: usage.id, quantity: input.quantity,
      sourcePositionId: input.sourcePositionId,
    });
    await client.query(
      `insert into workorder_aggregate_part_usage_events
       (company_id, usage_id, event_type, quantity_delta, actor_id, details)
       values ($1,$2,'reserved',$3,$4,$5::jsonb)`,
      [workorder.company_id, usage.id, input.quantity, input.actorId,
        JSON.stringify({ workorderId: input.workorderId })],
    );
    await finish("commit");
    return { kind: "reserved", usage: publicUsage(usage) };
  } catch (error) {
    if (managesTransaction) await client.query("rollback").catch(() => {});
    throw error;
  } finally { if (managesTransaction) client.release(); }
}

export async function releaseOrReverseAggregateWorkorderUsage(input) {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [
      `aggregate-usage-event:${input.actorId}:${input.idempotencyKey}`,
    ]);
    const prior = await client.query(
      `select event_type, request_hash from workorder_aggregate_part_usage_events
       where company_id=any($1::uuid[]) and actor_id=$2 and idempotency_key=$3
       limit 1`, [input.companyIds, input.actorId, input.idempotencyKey],
    );
    if (prior.rows[0]) {
      await client.query("commit");
      return prior.rows[0].request_hash === input.requestHash ? { kind: "replay" } : { kind: "idempotency_conflict" };
    }
    const selected = await client.query(
      `select usage.*, workorder.status as workorder_status
       from workorder_aggregate_part_usages usage
       join operational_workorders workorder on workorder.company_id=usage.company_id and workorder.id=usage.workorder_id
       where usage.id=$1 and usage.workorder_id=$5 and usage.company_id=any($2::uuid[])
         and ($4::boolean or usage.location_id=any($3::uuid[]))
       limit 1 for update of usage, workorder`,
      [input.usageId, input.companyIds, input.locationIds, input.isAdmin, input.workorderId],
    );
    const usage = selected.rows[0];
    if (!usage) { await client.query("rollback"); return { kind: "not_found" }; }
    if (input.action === "adjust" && usage.tracking_mode === "quantity" && !Number.isInteger(input.targetQuantity)) {
      await client.query("rollback"); return { kind: "unsupported_uom" };
    }
    const balance = await client.query(
      `select id from inventory_items where company_id=$1 and location_id=$2
       and catalog_part_id=$3 and uom_code=$4 and source_provider='local' limit 1 for update`,
      [usage.company_id, usage.location_id, usage.catalog_part_id, usage.uom_code],
    );
    if (!balance.rows[0]) throw new Error("Aggregate inventory balance is missing.");
    let eventType;
    let movementType = null;
    let movementDelta = 0;
    let eventDelta = 0;
    if (["reserved", "installed_pending_approval"].includes(usage.status) && input.action === "release") {
      await releaseAggregateInventoryPositions(client, { companyId: usage.company_id, usageId: usage.id,
        actorId: input.actorId, workorderId: usage.workorder_id, reason: input.reason });
      await client.query(`update inventory_items set quantity_reserved=quantity_reserved-$3, updated_at=now() where company_id=$1 and id=$2`, [usage.company_id, balance.rows[0].id, usage.quantity]);
      await client.query(`update workorder_aggregate_part_usages set status='released', released_at=now(), finalized_by_user_id=$3, updated_at=now() where company_id=$1 and id=$2`, [usage.company_id, usage.id, input.actorId]);
      eventType = "released";
      eventDelta = -Number(usage.quantity);
    } else if (usage.status === "consumed" && input.action === "reverse") {
      const effectiveQuantity = Number(usage.quantity) + Number(usage.adjustment_total);
      await adjustConsumedAggregateInventoryPositions(client, { companyId: usage.company_id, locationId: usage.location_id,
        inventoryItemId: balance.rows[0].id, catalogPartId: usage.catalog_part_id, uomCode: usage.uom_code,
        usageId: usage.id, actorId: input.actorId, workorderId: usage.workorder_id,
        quantityDelta: -effectiveQuantity, reason: input.reason, idempotencyKey: input.idempotencyKey });
      await client.query(`update inventory_items set quantity_on_hand=quantity_on_hand+$3, updated_at=now() where company_id=$1 and id=$2`, [usage.company_id, balance.rows[0].id, effectiveQuantity]);
      await client.query(`update workorder_aggregate_part_usages set status='reversed', reversed_at=now(), finalized_by_user_id=$3, updated_at=now() where company_id=$1 and id=$2`, [usage.company_id, usage.id, input.actorId]);
      eventType = "reversed"; movementType = "return";
      movementDelta = effectiveQuantity; eventDelta = movementDelta;
    } else if (usage.status === "consumed" && input.action === "adjust") {
      const effectiveQuantity = Number(usage.quantity) + Number(usage.adjustment_total);
      const consumptionDelta = Number(input.targetQuantity) - effectiveQuantity;
      if (consumptionDelta === 0) { await client.query("rollback"); return { kind: "terminal" }; }
      await adjustConsumedAggregateInventoryPositions(client, { companyId: usage.company_id, locationId: usage.location_id,
        inventoryItemId: balance.rows[0].id, catalogPartId: usage.catalog_part_id, uomCode: usage.uom_code,
        usageId: usage.id, actorId: input.actorId, workorderId: usage.workorder_id,
        quantityDelta: consumptionDelta, reason: input.reason, idempotencyKey: input.idempotencyKey });
      const adjusted = await client.query(
        `update inventory_items set quantity_on_hand=quantity_on_hand-$3, updated_at=now()
         where company_id=$1 and id=$2 and quantity_on_hand-$3 >= 0 returning id`,
        [usage.company_id, balance.rows[0].id, consumptionDelta],
      );
      if (!adjusted.rows[0]) { await client.query("rollback"); return { kind: "insufficient_stock" }; }
      await client.query(
        `update workorder_aggregate_part_usages
         set adjustment_total=adjustment_total+$3, finalized_by_user_id=$4, updated_at=now()
         where company_id=$1 and id=$2`,
        [usage.company_id, usage.id, consumptionDelta, input.actorId],
      );
      eventType = "adjusted"; movementType = "adjustment";
      movementDelta = -consumptionDelta; eventDelta = movementDelta;
    } else { await client.query("rollback"); return { kind: "terminal" }; }
    await client.query(
      `insert into workorder_aggregate_part_usage_events
       (company_id, usage_id, event_type, quantity_delta, actor_id, idempotency_key, request_hash, details)
       values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
      [usage.company_id, usage.id, eventType, eventDelta, input.actorId,
        input.idempotencyKey, input.requestHash, JSON.stringify({ reason: input.reason })],
    );
    if (movementType) await client.query(
      `insert into inventory_stock_movements
       (company_id, location_id, catalog_part_id, movement_type, quantity_delta, uom_code,
        actor_id, reason, idempotency_key, aggregate_usage_id, workorder_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [usage.company_id, usage.location_id, usage.catalog_part_id, movementType, movementDelta,
        usage.uom_code, input.actorId, input.reason, `aggregate-${eventType}:${usage.id}:${input.idempotencyKey}`,
        usage.id, usage.workorder_id],
    );
    await client.query("commit");
    return { kind: eventType };
  } catch (error) { await client.query("rollback").catch(() => {}); throw error; }
  finally { client.release(); }
}

export async function markAggregateUsagesPending(client, { workorderId, companyId, actorId }) {
  const rows = await client.query(
    `update workorder_aggregate_part_usages set status='installed_pending_approval', pending_at=now(), updated_at=now()
     where company_id=$1 and workorder_id=$2 and status='reserved'
     returning id,quantity,location_id,catalog_part_id,uom_code,workorder_id`,
    [companyId, workorderId],
  );
  for (const row of rows.rows) {
    await pickAggregateInventoryPositions(client, { companyId, locationId: row.location_id,
      catalogPartId: row.catalog_part_id, uomCode: row.uom_code, usageId: row.id, actorId,
      workorderId: row.workorder_id, reason: "Workorder usage moved off shelf pending approval" });
    await client.query(`insert into workorder_aggregate_part_usage_events
      (company_id,usage_id,event_type,quantity_delta,actor_id) values ($1,$2,'installed_pending_approval',0,$3)`,
    [companyId, row.id, actorId]);
  }
}

export async function resetAggregateUsagesForRevision(client, { workorderId, companyId, actorId }) {
  const rows = await client.query(
    `update workorder_aggregate_part_usages
     set status='reserved', pending_at=null, updated_at=now()
     where company_id=$1 and workorder_id=$2 and status='installed_pending_approval'
     returning id`, [companyId, workorderId],
  );
  for (const row of rows.rows) await client.query(
    `insert into workorder_aggregate_part_usage_events
     (company_id,usage_id,event_type,quantity_delta,actor_id,details)
     values ($1,$2,'reserved',0,$3,$4::jsonb)`,
    [companyId, row.id, actorId, JSON.stringify({ reason: "workorder_revision" })],
  );
}

export async function releaseAggregateUsagesForCancelledWorkorder(client, { workorderId, companyId, actorId, reason }) {
  const usages = await client.query(
    `select * from workorder_aggregate_part_usages
     where company_id=$1 and workorder_id=$2 and status in ('reserved','installed_pending_approval')
     order by id for update`, [companyId, workorderId],
  );
  for (const usage of usages.rows) {
    await releaseAggregateInventoryPositions(client, { companyId, usageId: usage.id, actorId,
      workorderId: usage.workorder_id, reason: reason || "Workorder cancelled" });
    const released = await client.query(
      `update inventory_items set quantity_reserved=quantity_reserved-$4, updated_at=now()
       where company_id=$1 and location_id=$2 and catalog_part_id=$3 and uom_code=$5
         and source_provider='local' and quantity_reserved >= $4 returning id`,
      [companyId, usage.location_id, usage.catalog_part_id, usage.quantity, usage.uom_code],
    );
    if (!released.rows[0]) throw new Error("Aggregate reservation changed before cancellation.");
    await client.query(
      `update workorder_aggregate_part_usages
       set status='released', released_at=now(), finalized_by_user_id=$3, updated_at=now()
       where company_id=$1 and id=$2`, [companyId, usage.id, actorId],
    );
    await client.query(
      `insert into workorder_aggregate_part_usage_events
       (company_id,usage_id,event_type,quantity_delta,actor_id,details)
       values ($1,$2,'released',$3,$4,$5::jsonb)`,
      [companyId, usage.id, -Number(usage.quantity), actorId, JSON.stringify({ reason })],
    );
  }
}

export async function consumeAggregateUsagesForApproval(client, { workorderId, companyId, actorId }) {
  const usages = await client.query(
    `select * from workorder_aggregate_part_usages
     where company_id=$1 and workorder_id=$2 and status='installed_pending_approval'
     order by id for update`, [companyId, workorderId],
  );
  for (const usage of usages.rows) {
    const balance = await client.query(
      `update inventory_items set quantity_on_hand=quantity_on_hand-$4,
         quantity_reserved=quantity_reserved-$4, updated_at=now()
       where company_id=$1 and location_id=$2 and catalog_part_id=$3 and uom_code=$5
         and source_provider='local' and quantity_reserved >= $4 and quantity_on_hand >= $4
       returning id`,
      [companyId, usage.location_id, usage.catalog_part_id, usage.quantity, usage.uom_code],
    );
    if (!balance.rows[0]) throw new Error("Aggregate inventory reservation changed before approval.");
    await consumeAggregateInventoryPositions(client, { companyId, usageId: usage.id });
    await client.query(
      `update workorder_aggregate_part_usages set status='consumed', consumed_at=now(), finalized_by_user_id=$3, updated_at=now()
       where company_id=$1 and id=$2`, [companyId, usage.id, actorId],
    );
    await client.query(
      `insert into workorder_aggregate_part_usage_events
       (company_id,usage_id,event_type,quantity_delta,actor_id) values ($1,$2,'consumed',$3,$4)`,
      [companyId, usage.id, -Number(usage.quantity), actorId],
    );
    await client.query(
      `insert into inventory_stock_movements
       (company_id,location_id,catalog_part_id,movement_type,quantity_delta,uom_code,actor_id,
        reason,idempotency_key,aggregate_usage_id,workorder_id)
       values ($1,$2,$3,'issue',$4,$5,$6,'Measured consumable approved on workorder',$7,$8,$9)`,
      [companyId, usage.location_id, usage.catalog_part_id, -Number(usage.quantity), usage.uom_code,
        actorId, `aggregate-consume:${usage.id}`, usage.id, usage.workorder_id],
    );
  }
}

export const aggregateUsageInternals = { MEASURED_CATEGORIES, QUANTITY_CATEGORIES };
