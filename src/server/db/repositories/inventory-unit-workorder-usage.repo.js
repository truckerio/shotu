import { getPool, query } from "../pool.js";
import { isApplicationOwnedInventoryProvider } from "../../../../shared/inventory-provider.js";

const ISSUE_STATUSES = new Set(["accepted", "in_progress"]);
const FINALIZE_STATUSES = new Set(["accepted", "in_progress", "waiting_office", "parts_requested"]);
const RETURN_STATUSES = new Set([...FINALIZE_STATUSES, "mechanic_done"]);
const REMOVAL_STATUSES = new Set(["closed", "odoo_entered"]);

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
    repairOrder: row.repair_order || "",
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
  actorRole,
  companyId,
  locationId,
}) {
  const result = await query(
    `select unit.id, unit.serial_number, unit.status, unit.location_id, unit.updated_at,
            line.catalog_part_id, line.part_number, line.description, line.uom_code,
            receipt.provider, location.name as location_name
     from operational_workorders workorder
     join inventory_serialized_units unit
       on unit.company_id = workorder.company_id and unit.location_id = workorder.location_id
     join inventory_receipt_lines line
       on line.company_id = unit.company_id and line.id = unit.receipt_line_id
     join inventory_receipts receipt
       on receipt.company_id = unit.company_id and receipt.id = unit.receipt_id
     join locations location
       on location.company_id = unit.company_id and location.id = unit.location_id
     where workorder.id = $1 and unit.id = $2
       and workorder.company_id = $3
       and workorder.location_id = $4
       and ($6::text <> 'mechanic' or exists (
         select 1 from workorder_mechanic_assignments assignment
         where assignment.workorder_id = workorder.id
           and assignment.mechanic_user_id = $5 and assignment.active = true
       ))
     limit 1`,
    [workorderId, unitId, companyId, locationId, actorId, actorRole],
  );
  return publicCandidate(result.rows[0]);
}

export async function listWorkorderSerializedUnitUsages({
  workorderId,
  actorId,
  actorRole,
  companyId,
  locationId,
  limit = 100,
}) {
  const result = await query(
    `${USAGE_SELECT}
     where usage.workorder_id = $1
       and usage.company_id = $3
       and usage.location_id = $4
       and ($6::text <> 'mechanic' or exists (
         select 1 from workorder_mechanic_assignments assignment
         where assignment.workorder_id = usage.workorder_id
           and assignment.mechanic_user_id = $2 and assignment.active = true
       ))
     order by usage.issued_at desc, usage.id desc
     limit $5`,
    [workorderId, actorId, companyId, locationId, limit, actorRole],
  );
  return result.rows.map(publicUsage);
}

export async function listAvailableSerializedUnitsForWorkorder({
  workorderId,
  companyId,
  locationId,
  catalogPartId,
  queryText = "",
  after = "",
  limit = 50,
}) {
  const result = await query(
    `with selected_part as (
       select part.id, part.part_number, part.description, part.uom_code,
              location.id as location_id, location.name as location_name,
              uom.category as uom_category, uom.decimal_scale
       from operational_workorders workorder
       join parts_catalog part on part.company_id = workorder.company_id
       join locations location on location.company_id = workorder.company_id and location.id = workorder.location_id
       join units_of_measure uom on uom.code = part.uom_code
       where workorder.id = $1 and workorder.company_id = $2
         and workorder.location_id = $3 and part.id = $4
     )
     select selected_part.id as selected_part_id,
            selected_part.part_number as selected_part_number,
            selected_part.description as selected_part_description,
            selected_part.uom_code as selected_part_uom_code,
            selected_part.location_id, selected_part.location_name,
            selected_part.uom_category, selected_part.decimal_scale,
            child.id, child.serial_number, child.status, child.updated_at,
            child.catalog_part_id, child.part_number, child.description, child.uom_code
     from selected_part
     left join lateral (
       select unit.id, unit.serial_number, unit.status, unit.updated_at,
              line.catalog_part_id, line.part_number, line.description, line.uom_code
       from inventory_serialized_units unit
       join inventory_receipt_lines line
         on line.company_id = unit.company_id and line.id = unit.receipt_line_id
       join inventory_receipts receipt
         on receipt.company_id = unit.company_id and receipt.id = unit.receipt_id
        and receipt.provider in ('local', 'local_count', 'local_serialization')
       where unit.company_id = $2 and unit.location_id = $3
         and line.catalog_part_id = selected_part.id and unit.status = 'in_stock'
         and ($5::text = '' or unit.serial_number ilike '%' || replace(replace(replace($5, '\\', '\\\\'), '%', '\\%'), '_', '\\_') || '%' escape '\\')
         and ($6::text = '' or unit.serial_number > $6)
       order by unit.serial_number, unit.id
       limit $7
     ) child on true
     order by child.serial_number, child.id`,
    [workorderId, companyId, locationId, catalogPartId, queryText, after, limit + 1],
  );
  if (!result.rows.length) return { kind: "missing", units: [] };
  const selected = result.rows[0];
  const candidates = result.rows.filter((row) => row.id);
  const hasMore = candidates.length > limit;
  const page = candidates.slice(0, limit);
  return {
    kind: "found",
    part: {
      catalogPartId: selected.selected_part_id,
      partNumber: selected.selected_part_number,
      description: selected.selected_part_description || "",
      uomCode: selected.selected_part_uom_code,
    },
    location: { locationId: selected.location_id, name: selected.location_name || "" },
    canCreateSerializedUnits: ["count", "packaging"].includes(selected.uom_category)
      && Number(selected.decimal_scale) === 0,
    units: page.map((row) => ({
      id: row.id,
      serialNumber: row.serial_number,
      status: row.status,
      catalogPartId: row.catalog_part_id,
      partNumber: row.part_number,
      description: row.description || "",
      uomCode: row.uom_code,
      locationName: row.location_name || "",
      eligible: true,
      updatedAt: row.updated_at,
    })),
    nextCursor: hasMore ? page.at(-1)?.serial_number || null : null,
  };
}

export async function listWorkorderInstalledSerializedParts({
  workorderId,
  companyId,
  locationId,
  limit = 2000,
}) {
  const result = await query(
    `select usage.id as usage_id, usage.catalog_part_id, usage.repair_order,
            unit.serial_number, line.part_number, line.description, usage.uom_code
     from workorder_serialized_part_usages usage
     join inventory_serialized_units unit
       on unit.company_id = usage.company_id and unit.id = usage.unit_id
     join inventory_receipt_lines line
       on line.company_id = unit.company_id and line.id = unit.receipt_line_id
     where usage.workorder_id = $1
       and usage.company_id = $2
       and usage.location_id = $3
       and usage.status in ('installed_pending_approval', 'installed')
     order by usage.finalized_at, usage.issued_at, usage.id
     limit $4`,
    [workorderId, companyId, locationId, limit],
  );
  return result.rows.map((row) => ({
    usageId: row.usage_id,
    catalogPartId: row.catalog_part_id,
    serialNumber: row.serial_number,
    partNumber: row.part_number,
    description: row.description || "",
    repairOrder: row.repair_order,
    quantity: 1,
    uomCode: row.uom_code,
  }));
}

export async function updateSerializedUsageRepairOrder(input) {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const workorder = await lockWorkorder(client, input);
    if (!workorder) {
      await client.query("rollback");
      return { kind: "missing" };
    }
    if (!input.allowedWorkorderStatuses?.includes(workorder.status)) {
      await client.query("rollback");
      return { kind: "workorder_state" };
    }
    const usageResult = await client.query(
      `select usage.*, unit.serial_number, line.part_number
       from workorder_serialized_part_usages usage
       join inventory_serialized_units unit
         on unit.company_id = usage.company_id and unit.id = usage.unit_id
       join inventory_receipt_lines line
         on line.company_id = unit.company_id and line.id = unit.receipt_line_id
       where usage.company_id = $1 and usage.workorder_id = $2 and usage.id = $3
         and usage.location_id = $4 and usage.asset_id = $5
       for update of usage`,
      [workorder.company_id, workorder.id, input.usageId, workorder.location_id, workorder.asset_id],
    );
    const usage = usageResult.rows[0];
    if (!usage) {
      await client.query("rollback");
      return { kind: "missing" };
    }
    if (!['installed_pending_approval', 'installed'].includes(usage.status)) {
      await client.query("rollback");
      return { kind: "usage_state" };
    }
    if (usage.repair_order === input.repairOrder) {
      const unchanged = await loadUsage(client, workorder.company_id, usage.id);
      await client.query("commit");
      return { kind: "unchanged", usage: unchanged };
    }
    await client.query(
      `update workorder_serialized_part_usages
       set repair_order = $3, updated_at = now()
       where company_id = $1 and id = $2`,
      [workorder.company_id, usage.id, input.repairOrder],
    );
    await client.query(
      `insert into workorder_field_events (
         workorder_id, field_key, field_label, old_value, new_value, changed_by_user_id
       ) values ($1, 'serialized_usage_repair_order', 'Serialized part repair order', $2, $3, $4)`,
      [
        workorder.id,
        JSON.stringify({ usageId: usage.id, serialNumber: usage.serial_number, partNumber: usage.part_number, repairOrder: usage.repair_order || "" }),
        JSON.stringify({ usageId: usage.id, serialNumber: usage.serial_number, partNumber: usage.part_number, repairOrder: input.repairOrder }),
        input.actorId,
      ],
    );
    const updated = await loadUsage(client, workorder.company_id, usage.id);
    await client.query("commit");
    return { kind: "updated", usage: updated };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function lockWorkorder(client, input) {
  const result = await client.query(
    `select workorder.id, workorder.company_id, workorder.location_id,
            workorder.asset_id, workorder.status
     from operational_workorders workorder
     where workorder.id = $1
       and workorder.company_id = $2
       and workorder.location_id = $3
       and ($5::text <> 'mechanic' or exists (
         select 1 from workorder_mechanic_assignments assignment
         where assignment.workorder_id = workorder.id
           and assignment.mechanic_user_id = $4 and assignment.active = true
       ))
     for update of workorder`,
    [input.workorderId, input.companyId, input.locationId, input.actorId, input.actorRole],
  );
  return result.rows[0] || null;
}

export async function issueSerializedUnitToWorkorder(input) {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const workorder = await lockWorkorder(client, input);
    if (!workorder) {
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
    const unitResult = await client.query(
      `select unit.id, unit.status, unit.location_id, line.catalog_part_id, line.uom_code, line.description,
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
    if (!isApplicationOwnedInventoryProvider(unit.provider)) {
      await client.query("rollback");
      return { kind: "provider_not_local" };
    }
    if (unit.status !== "in_stock") {
      await client.query("rollback");
      return { kind: "unit_state" };
    }
    const itemResult = await client.query(
      `select id, quantity_on_hand, quantity_reserved
       from inventory_items
       where company_id = $1 and location_id = $2 and catalog_part_id = $3
         and uom_code = $4 and source_provider = 'local'
       order by updated_at desc, id
       limit 1 for update`,
      [workorder.company_id, workorder.location_id, unit.catalog_part_id, unit.uom_code],
    );
    const item = itemResult.rows[0];
    if (!item || Number(item.quantity_on_hand) - Number(item.quantity_reserved) < 1) {
      await client.query("rollback");
      return { kind: "stock_mismatch" };
    }
    const inserted = await client.query(
      `insert into workorder_serialized_part_usages (
         company_id, workorder_id, asset_id, location_id, unit_id, catalog_part_id,
         uom_code, repair_order, status, issued_by_user_id, issue_idempotency_key, issue_request_hash
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,'reserved',$9,$10,$11)
       returning id`,
      [workorder.company_id, workorder.id, workorder.asset_id, workorder.location_id,
        unit.id, unit.catalog_part_id, unit.uom_code, String(unit.description || "").trim().slice(0, 2000), input.actorId,
        input.idempotencyKey, input.requestHash],
    );
    const usageId = inserted.rows[0].id;
    const updatedUnit = await client.query(
      "update inventory_serialized_units set status = 'reserved', updated_at = now() where company_id = $1 and id = $2 and status = 'in_stock' returning id",
      [workorder.company_id, unit.id],
    );
    if (!updatedUnit.rows[0]) throw new Error("Serialized inventory unit changed while it was being reserved.");
    const updatedItem = await client.query(
      `update inventory_items set quantity_reserved = quantity_reserved + 1, updated_at = now()
       where id = $1 and quantity_on_hand - quantity_reserved >= 1 returning id`,
      [item.id],
    );
    if (!updatedItem.rows[0]) throw new Error("Serialized inventory balance changed while it was being reserved.");
    await client.query(
      `insert into inventory_unit_events (
         company_id, unit_id, event_type, actor_id, usage_id, workorder_id, asset_id, details
       ) values ($1,$2,'reserved',$3,$4,$5,$6,$7::jsonb)`,
      [workorder.company_id, unit.id, input.actorId, usageId, workorder.id,
        workorder.asset_id, JSON.stringify({ source: "workorder_parts_scan", actorRole: input.actorRole })],
    );
    const usage = await loadUsage(client, workorder.company_id, usageId);
    await client.query("commit");
    return { kind: "reserved", usage };
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
    if (!workorder) {
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
    const command = await client.query(
      `select request_hash from workorder_serialized_part_usage_commands
       where company_id = $1 and actor_id = $2 and idempotency_key = $3 limit 1`,
      [workorder.company_id, input.actorId, input.idempotencyKey],
    );
    if (command.rows[0]) {
      const kind = command.rows[0].request_hash === input.requestHash ? "replay" : "idempotency_conflict";
      const replayed = kind === "replay" ? await loadUsage(client, workorder.company_id, usage.id) : null;
      await client.query("commit");
      return { kind, usage: replayed };
    }
    const removing = input.disposition === "removed";
    const permittedStatuses = removing
      ? REMOVAL_STATUSES
      : input.disposition === "returned" ? RETURN_STATUSES : FINALIZE_STATUSES;
    if (!permittedStatuses.has(workorder.status)) {
      await client.query("rollback");
      return { kind: "workorder_state" };
    }
    const legacy = usage.status === "issued" && usage.unit_status === "issued";
    const reserving = usage.status === "reserved" && usage.unit_status === "reserved";
    const pendingInstall = usage.status === "installed_pending_approval" && usage.unit_status === "installed_pending_approval";
    const approvedInstall = usage.status === "installed" && usage.unit_status === "installed";
    if (!(
      input.disposition === "installed" && (legacy || reserving)
      || input.disposition === "returned" && (legacy || reserving || pendingInstall)
      || removing && approvedInstall
    )) {
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
      if (legacy) {
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
            input.actorId, `Returned legacy issued unit from workorder ${workorder.id}`,
            `serialized-return:${usage.id}`, usage.unit_id, usage.id, workorder.id, usage.asset_id],
        );
      } else {
        const released = await client.query(
          `update inventory_items set quantity_reserved = quantity_reserved - 1, updated_at = now()
           where id = $1 and quantity_reserved >= 1 returning id`,
          [item.rows[0].id],
        );
        if (!released.rows[0]) {
          await client.query("rollback");
          return { kind: "stock_mismatch" };
        }
      }
    }
    const nextStatus = input.disposition === "installed" && !legacy
      ? "installed_pending_approval"
      : input.disposition;
    const eventType = input.disposition === "returned" && pendingInstall
      ? "removed_returned_to_stock"
      : nextStatus;
    const nextUnitStatus = nextStatus === "returned" ? "in_stock" : nextStatus;
    await client.query(
      `update inventory_serialized_units set status = $3, updated_at = now()
       where company_id = $1 and id = $2 and status = $4`,
      [workorder.company_id, usage.unit_id, nextUnitStatus, usage.unit_status],
    );
    await client.query(
      `update workorder_serialized_part_usages
       set status = $3, finalized_by_user_id = $4, finalized_at = now(),
           finalize_idempotency_key = $5, finalize_request_hash = $6, updated_at = now()
       where company_id = $1 and id = $2 and status = $7`,
      [workorder.company_id, usage.id, nextStatus, input.actorId,
        input.idempotencyKey, input.requestHash, usage.status],
    );
    await client.query(
      `insert into workorder_serialized_part_usage_commands (
         company_id, usage_id, actor_id, action, idempotency_key, request_hash
       ) values ($1,$2,$3,$4,$5,$6)`,
      [workorder.company_id, usage.id, input.actorId,
        input.disposition === "installed" ? "install" : input.disposition === "returned" ? "return" : "remove",
        input.idempotencyKey, input.requestHash],
    );
    await client.query(
      `insert into inventory_unit_events (
         company_id, unit_id, event_type, actor_id, usage_id, workorder_id, asset_id, details
       ) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
      [workorder.company_id, usage.unit_id, eventType, input.actorId, usage.id,
        workorder.id, usage.asset_id, JSON.stringify({ source: "workorder_parts_scan", actorRole: input.actorRole })],
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

export async function consumePendingSerializedInstallationsForApproval(client, { workorderId, companyId, officeUserId }) {
  const pending = await client.query(
    `select usage.*, unit.status as unit_status
     from workorder_serialized_part_usages usage
     join inventory_serialized_units unit
       on unit.company_id = usage.company_id and unit.id = usage.unit_id
     where usage.company_id = $1 and usage.workorder_id = $2
       and usage.status = 'installed_pending_approval'
     order by usage.catalog_part_id, usage.uom_code, usage.id
     for update of usage, unit`,
    [companyId, workorderId],
  );
  for (const usage of pending.rows) {
    if (usage.unit_status !== "installed_pending_approval") throw new Error("Serialized installation state does not match its exact unit.");
    const item = await client.query(
      `select id from inventory_items
       where company_id = $1 and location_id = $2 and catalog_part_id = $3
         and uom_code = $4 and source_provider = 'local'
       order by updated_at desc, id limit 1 for update`,
      [companyId, usage.location_id, usage.catalog_part_id, usage.uom_code],
    );
    if (!item.rows[0]) throw new Error("Serialized installation has no matching local inventory balance.");
    const consumed = await client.query(
      `update inventory_items set quantity_on_hand = quantity_on_hand - 1,
           quantity_reserved = quantity_reserved - 1, updated_at = now()
       where id = $1 and quantity_on_hand >= 1 and quantity_reserved >= 1 returning id`,
      [item.rows[0].id],
    );
    if (!consumed.rows[0]) throw new Error("Serialized installation reservation does not match local inventory balance.");
    await client.query(
      "update inventory_serialized_units set status = 'installed', updated_at = now() where company_id = $1 and id = $2 and status = 'installed_pending_approval'",
      [companyId, usage.unit_id],
    );
    await client.query(
      "update workorder_serialized_part_usages set status = 'installed', finalized_by_user_id = $3, finalized_at = now(), updated_at = now() where company_id = $1 and id = $2 and status = 'installed_pending_approval'",
      [companyId, usage.id, officeUserId],
    );
    await client.query(
      `insert into inventory_stock_movements (
         company_id, location_id, catalog_part_id, movement_type, quantity_delta,
         uom_code, actor_id, reason, idempotency_key, unit_id, usage_id, workorder_id, asset_id
       ) values ($1,$2,$3,'issue',-1,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [companyId, usage.location_id, usage.catalog_part_id, usage.uom_code,
        officeUserId, `Consumed serialized reservation when workorder ${workorderId} was approved`,
        `serialized-approval:${usage.id}`, usage.unit_id, usage.id, workorderId, usage.asset_id],
    );
    await client.query(
      `insert into inventory_unit_events (
         company_id, unit_id, event_type, actor_id, usage_id, workorder_id, asset_id, details
       ) values ($1,$2,'installed',$3,$4,$5,$6,$7::jsonb)`,
      [companyId, usage.unit_id, officeUserId, usage.id, workorderId, usage.asset_id,
        JSON.stringify({ source: "workorder_approval" })],
    );
  }
  return pending.rows.length;
}
