import { getPool, query } from "../pool.js";

const ISSUE_STATUSES = new Set(["accepted", "in_progress"]);
const FINALIZE_STATUSES = new Set(["accepted", "in_progress", "waiting_office", "parts_requested"]);

function publicUsage(row) {
  if (!row) return null;
  return {
    id: row.id,
    workorderId: row.workorder_id,
    assetId: row.asset_id,
    locationId: row.location_id,
    unitId: row.unit_id,
    catalogPartId: row.catalog_part_id,
    uomCode: row.uom_code,
    status: row.status,
    issuedByUserId: row.issued_by_user_id,
    issuedAt: row.issued_at,
    finalizedByUserId: row.finalized_by_user_id || null,
    finalizedAt: row.finalized_at || null,
    serialNumber: row.serial_number,
    partNumber: row.part_number,
    description: row.description || "",
    locationName: row.location_name || "",
    workorderSerial: row.workorder_serial || "",
    asset: {
      id: row.asset_id,
      unitNo: row.asset_unit_no || "",
      name: row.asset_name || "",
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function publicCandidate(row) {
  if (!row) return null;
  return {
    id: row.id,
    serialNumber: row.serial_number,
    status: row.status,
    catalogPartId: row.catalog_part_id,
    partNumber: row.part_number,
    description: row.description || "",
    uomCode: row.uom_code,
    locationId: row.location_id,
    locationName: row.location_name || "",
    provider: row.provider,
    updatedAt: row.updated_at,
  };
}

const USAGE_SELECT = `
  select usage.*, unit.serial_number, line.part_number, line.description,
         location.name as location_name, workorder.serial as workorder_serial,
         asset.unit_no as asset_unit_no, asset.name as asset_name
  from workorder_serialized_part_usages usage
  join inventory_serialized_units unit
    on unit.company_id = usage.company_id and unit.id = usage.unit_id
  join inventory_receipt_lines line
    on line.company_id = unit.company_id and line.id = unit.receipt_line_id
  join locations location
    on location.company_id = usage.company_id and location.id = usage.location_id
  join operational_workorders workorder
    on workorder.company_id = usage.company_id and workorder.id = usage.workorder_id
  join assets asset
    on asset.company_id = usage.company_id and asset.id = usage.asset_id`;

async function loadUsage(client, companyId, usageId) {
  const result = await client.query(
    `${USAGE_SELECT} where usage.company_id = $1 and usage.id = $2 limit 1`,
    [companyId, usageId],
  );
  return publicUsage(result.rows[0]);
}

export async function resolveWorkorderSerializedUnit({
  workorderId,
  unitId,
  actorId,
  companyIds,
  locationIds = [],
}) {
  const result = await query(
    `select unit.id, unit.serial_number, unit.status, unit.location_id, unit.updated_at,
            line.catalog_part_id, line.part_number, line.description, line.uom_code,
            receipt.provider, location.name as location_name
     from operational_workorders workorder
     join workorder_mechanic_assignments assignment
       on assignment.workorder_id = workorder.id
      and assignment.mechanic_user_id = $3 and assignment.active = true
     join inventory_serialized_units unit
       on unit.company_id = workorder.company_id and unit.location_id = workorder.location_id
     join inventory_receipt_lines line
       on line.company_id = unit.company_id and line.id = unit.receipt_line_id
     join inventory_receipts receipt
       on receipt.company_id = unit.company_id and receipt.id = unit.receipt_id
     join locations location
       on location.company_id = unit.company_id and location.id = unit.location_id
     where workorder.id = $1 and unit.id = $2
       and workorder.company_id = any($4::uuid[])
       and workorder.location_id = any($5::uuid[])
     limit 1`,
    [workorderId, unitId, actorId, companyIds, locationIds],
  );
  return publicCandidate(result.rows[0]);
}

export async function listWorkorderSerializedUnitUsages({
  workorderId,
  actorId,
  companyIds,
  locationIds = [],
  limit = 100,
}) {
  const result = await query(
    `${USAGE_SELECT}
     join workorder_mechanic_assignments assignment
       on assignment.workorder_id = usage.workorder_id
      and assignment.mechanic_user_id = $2 and assignment.active = true
     where usage.workorder_id = $1
       and usage.company_id = any($3::uuid[])
       and usage.location_id = any($4::uuid[])
     order by usage.issued_at desc, usage.id desc
     limit $5`,
    [workorderId, actorId, companyIds, locationIds, limit],
  );
  return result.rows.map(publicUsage);
}

async function lockWorkorder(client, input) {
  const result = await client.query(
    `select workorder.id, workorder.company_id, workorder.location_id,
            workorder.asset_id, workorder.status,
            coalesce(policy.mechanic_can_record_parts, false) as mechanic_can_record_parts,
            exists (
              select 1 from workorder_mechanic_assignments assignment
              where assignment.workorder_id = workorder.id
                and assignment.mechanic_user_id = $2 and assignment.active = true
            ) as mechanic_assigned
     from operational_workorders workorder
     left join location_workorder_policies policy
       on policy.company_id = workorder.company_id and policy.location_id = workorder.location_id
     where workorder.id = $1
       and workorder.company_id = any($3::uuid[])
       and workorder.location_id = any($4::uuid[])
     for update of workorder`,
    [input.workorderId, input.actorId, input.companyIds, input.locationIds],
  );
  return result.rows[0] || null;
}

export async function issueSerializedUnitToWorkorder(input) {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const workorder = await lockWorkorder(client, input);
    if (!workorder || !workorder.mechanic_assigned) {
      await client.query("rollback");
      return { kind: "missing" };
    }
    const replay = await client.query(
      `select id, issue_request_hash
       from workorder_serialized_part_usages
       where company_id = $1 and issued_by_user_id = $2 and issue_idempotency_key = $3
       limit 1`,
      [workorder.company_id, input.actorId, input.idempotencyKey],
    );
    if (replay.rows[0]) {
      const kind = replay.rows[0].issue_request_hash === input.requestHash ? "replay" : "idempotency_conflict";
      const usage = kind === "replay" ? await loadUsage(client, workorder.company_id, replay.rows[0].id) : null;
      await client.query("commit");
      return { kind, usage };
    }
    if (!ISSUE_STATUSES.has(workorder.status)) {
      await client.query("rollback");
      return { kind: "workorder_state" };
    }
    if (!workorder.asset_id) {
      await client.query("rollback");
      return { kind: "asset_required" };
    }
    if (!workorder.mechanic_can_record_parts) {
      await client.query("rollback");
      return { kind: "parts_disabled" };
    }
    const unitResult = await client.query(
      `select unit.id, unit.status, unit.location_id, line.catalog_part_id, line.uom_code,
              receipt.provider
       from inventory_serialized_units unit
       join inventory_receipt_lines line
         on line.company_id = unit.company_id and line.id = unit.receipt_line_id
       join inventory_receipts receipt
         on receipt.company_id = unit.company_id and receipt.id = unit.receipt_id
       where unit.id = $1 and unit.company_id = $2 and unit.location_id = $3
       for update of unit`,
      [input.unitId, workorder.company_id, workorder.location_id],
    );
    const unit = unitResult.rows[0];
    if (!unit) {
      await client.query("rollback");
      return { kind: "missing" };
    }
    if (unit.provider !== "local") {
      await client.query("rollback");
      return { kind: "provider_not_local" };
    }
    if (unit.status !== "in_stock") {
      await client.query("rollback");
      return { kind: "unit_state" };
    }
    const itemResult = await client.query(
      `select id, quantity_on_hand
       from inventory_items
       where company_id = $1 and location_id = $2 and catalog_part_id = $3
         and uom_code = $4 and source_provider = 'local'
       order by updated_at desc, id
       limit 1 for update`,
      [workorder.company_id, workorder.location_id, unit.catalog_part_id, unit.uom_code],
    );
    const item = itemResult.rows[0];
    if (!item || Number(item.quantity_on_hand) < 1) {
      await client.query("rollback");
      return { kind: "stock_mismatch" };
    }
    const inserted = await client.query(
      `insert into workorder_serialized_part_usages (
         company_id, workorder_id, asset_id, location_id, unit_id, catalog_part_id,
         uom_code, issued_by_user_id, issue_idempotency_key, issue_request_hash
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       returning id`,
      [workorder.company_id, workorder.id, workorder.asset_id, workorder.location_id,
        unit.id, unit.catalog_part_id, unit.uom_code, input.actorId,
        input.idempotencyKey, input.requestHash],
    );
    const usageId = inserted.rows[0].id;
    const updatedUnit = await client.query(
      "update inventory_serialized_units set status = 'issued', updated_at = now() where company_id = $1 and id = $2 and status = 'in_stock' returning id",
      [workorder.company_id, unit.id],
    );
    if (!updatedUnit.rows[0]) throw new Error("Serialized inventory unit changed while it was being issued.");
    const updatedItem = await client.query(
      `update inventory_items set quantity_on_hand = quantity_on_hand - 1, updated_at = now()
       where id = $1 and quantity_on_hand >= 1 returning id`,
      [item.id],
    );
    if (!updatedItem.rows[0]) throw new Error("Serialized inventory balance changed while it was being issued.");
    await client.query(
      `insert into inventory_unit_events (
         company_id, unit_id, event_type, actor_id, usage_id, workorder_id, asset_id, details
       ) values ($1,$2,'issued',$3,$4,$5,$6,$7::jsonb)`,
      [workorder.company_id, unit.id, input.actorId, usageId, workorder.id,
        workorder.asset_id, JSON.stringify({ source: "mechanic_scan" })],
    );
    await client.query(
      `insert into inventory_stock_movements (
         company_id, location_id, catalog_part_id, movement_type, quantity_delta,
         uom_code, actor_id, reason, idempotency_key, unit_id, usage_id, workorder_id, asset_id
       ) values ($1,$2,$3,'issue',-1,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [workorder.company_id, workorder.location_id, unit.catalog_part_id, unit.uom_code,
        input.actorId, `Issued serialized unit to workorder ${workorder.id}`,
        `serialized-issue:${usageId}`, unit.id, usageId, workorder.id, workorder.asset_id],
    );
    const usage = await loadUsage(client, workorder.company_id, usageId);
    await client.query("commit");
    return { kind: "issued", usage };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    if (error?.code === "23505") {
      return {
        kind: error.constraint === "workorder_serialized_usage_issue_idempotency_key"
          ? "idempotency_conflict"
          : "unit_state",
        usage: null,
      };
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function finalizeSerializedUnitUsage(input) {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const workorder = await lockWorkorder(client, input);
    if (!workorder || !workorder.mechanic_assigned) {
      await client.query("rollback");
      return { kind: "missing" };
    }
    const usageResult = await client.query(
      `select usage.*, unit.status as unit_status
       from workorder_serialized_part_usages usage
       join inventory_serialized_units unit
         on unit.company_id = usage.company_id and unit.id = usage.unit_id
       where usage.company_id = $1 and usage.workorder_id = $2 and usage.id = $3
         and usage.location_id = $4 and usage.asset_id = $5
       for update of usage, unit`,
      [workorder.company_id, workorder.id, input.usageId, workorder.location_id, workorder.asset_id],
    );
    const usage = usageResult.rows[0];
    if (!usage) {
      await client.query("rollback");
      return { kind: "missing" };
    }
    if (usage.finalize_idempotency_key === input.idempotencyKey) {
      const kind = usage.finalize_request_hash === input.requestHash ? "replay" : "idempotency_conflict";
      const replayed = kind === "replay" ? await loadUsage(client, workorder.company_id, usage.id) : null;
      await client.query("commit");
      return { kind, usage: replayed };
    }
    if (!FINALIZE_STATUSES.has(workorder.status)) {
      await client.query("rollback");
      return { kind: "workorder_state" };
    }
    if (usage.status !== "issued" || usage.unit_status !== "issued" || usage.finalize_idempotency_key) {
      await client.query("rollback");
      return { kind: "unit_state" };
    }
    if (input.disposition === "returned") {
      const item = await client.query(
        `select id from inventory_items
         where company_id = $1 and location_id = $2 and catalog_part_id = $3
           and uom_code = $4 and source_provider = 'local'
         order by updated_at desc, id limit 1 for update`,
        [workorder.company_id, usage.location_id, usage.catalog_part_id, usage.uom_code],
      );
      if (!item.rows[0]) {
        await client.query("rollback");
        return { kind: "stock_mismatch" };
      }
      await client.query(
        "update inventory_items set quantity_on_hand = quantity_on_hand + 1, updated_at = now() where id = $1",
        [item.rows[0].id],
      );
      await client.query(
        `insert into inventory_stock_movements (
           company_id, location_id, catalog_part_id, movement_type, quantity_delta,
           uom_code, actor_id, reason, idempotency_key, unit_id, usage_id, workorder_id, asset_id
         ) values ($1,$2,$3,'return',1,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [workorder.company_id, usage.location_id, usage.catalog_part_id, usage.uom_code,
          input.actorId, `Returned unused serialized unit from workorder ${workorder.id}`,
          `serialized-return:${usage.id}`, usage.unit_id, usage.id, workorder.id, usage.asset_id],
      );
    }
    const nextUnitStatus = input.disposition === "installed" ? "installed" : "in_stock";
    await client.query(
      `update inventory_serialized_units set status = $3, updated_at = now()
       where company_id = $1 and id = $2 and status = 'issued'`,
      [workorder.company_id, usage.unit_id, nextUnitStatus],
    );
    await client.query(
      `update workorder_serialized_part_usages
       set status = $3, finalized_by_user_id = $4, finalized_at = now(),
           finalize_idempotency_key = $5, finalize_request_hash = $6, updated_at = now()
       where company_id = $1 and id = $2 and status = 'issued'`,
      [workorder.company_id, usage.id, input.disposition, input.actorId,
        input.idempotencyKey, input.requestHash],
    );
    await client.query(
      `insert into inventory_unit_events (
         company_id, unit_id, event_type, actor_id, usage_id, workorder_id, asset_id, details
       ) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
      [workorder.company_id, usage.unit_id, input.disposition, input.actorId, usage.id,
        workorder.id, usage.asset_id, JSON.stringify({ source: "mechanic_scan" })],
    );
    const finalized = await loadUsage(client, workorder.company_id, usage.id);
    await client.query("commit");
    return { kind: "finalized", usage: finalized };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    if (error?.code === "23505") return { kind: "idempotency_conflict", usage: null };
    throw error;
  } finally {
    client.release();
  }
}
