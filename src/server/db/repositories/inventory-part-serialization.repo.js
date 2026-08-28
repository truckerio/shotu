import { createHash, randomUUID } from "node:crypto";
import { getPool, query } from "../pool.js";
import { createReceiptLabelBatch } from "./inventory-labels.repo.js";

function hashRequest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function generatedSerial(batchId, ordinal) {
  return `WG-S-${batchId.replaceAll("-", "").slice(0, 16).toUpperCase()}-${ordinal}`;
}

function publicUnit(row) {
  return {
    id: row.id,
    serialNumber: row.serial_number,
    status: row.status,
    createdAt: row.created_at,
    qrSvgUrl: `/api/office/inventory/units/${encodeURIComponent(row.id)}/qr.svg`,
    printUrl: `/api/office/inventory/units/${encodeURIComponent(row.id)}/label`,
  };
}

export async function getPartLocationSerialization({ catalogPartId, locationId, companyIds }) {
  const selected = await query(
    `select catalog.company_id, catalog.id as catalog_part_id, catalog.part_number,
            catalog.description, catalog.normalized_part_number, catalog.uom_code,
            location.id as location_id, location.name as location_name,
            coalesce(local.quantity_on_hand, 0) as local_quantity_on_hand,
            coalesce(local.quantity_reserved, 0) as local_quantity_reserved,
            coalesce(odoo.quantity_on_hand, 0) as odoo_quantity_on_hand,
            uom.category as uom_category, uom.decimal_scale
     from parts_catalog catalog
     join locations location on location.company_id = catalog.company_id and location.id = $2
     join units_of_measure uom on uom.code = catalog.uom_code
     left join inventory_items local
       on local.company_id = catalog.company_id
      and local.location_id = location.id
      and local.catalog_part_id = catalog.id
      and local.uom_code = catalog.uom_code
      and local.source_provider = 'local'
     left join odoo_inventory_balances odoo
       on odoo.company_id = catalog.company_id
      and odoo.location_id = location.id
      and odoo.catalog_part_id = catalog.id
      and odoo.uom_code = catalog.uom_code
     where catalog.id = $1 and catalog.company_id = any($3::uuid[])
     limit 1`,
    [catalogPartId, locationId, companyIds],
  );
  const part = selected.rows[0];
  if (!part) return null;
  const units = await query(
    `select unit.id, unit.serial_number, unit.status, unit.created_at
     from inventory_serialized_units unit
     join inventory_receipt_lines line
       on line.company_id = unit.company_id and line.id = unit.receipt_line_id
     where unit.company_id = $1 and unit.location_id = $2
       and line.catalog_part_id = $3 and unit.status <> 'void'
     order by unit.serial_number, unit.id
     limit 501`,
    [part.company_id, part.location_id, part.catalog_part_id],
  );
  return {
    part: {
      catalogPartId: part.catalog_part_id,
      partNumber: part.part_number,
      description: part.description || "",
      uomCode: part.uom_code,
    },
    location: {
      locationId: part.location_id,
      locationName: part.location_name,
      localQuantityOnHand: Number(part.local_quantity_on_hand),
      localQuantityReserved: Number(part.local_quantity_reserved),
      odooQuantityOnHand: Number(part.odoo_quantity_on_hand),
    },
    canCreateSerializedUnits: ["count", "packaging"].includes(part.uom_category)
      && Number(part.decimal_scale) === 0,
    units: units.rows.slice(0, 500).map(publicUnit),
    truncated: units.rows.length > 500,
    printUrl: units.rows.some((unit) => unit.status === "in_stock")
      ? `/api/office/inventory/parts/${encodeURIComponent(part.catalog_part_id)}/locations/${encodeURIComponent(part.location_id)}/labels`
      : null,
  };
}

export async function createPartSerializedUnits({
  catalogPartId,
  locationId,
  quantity,
  confirmation,
  idempotencyKey,
  actorId,
  companyIds,
  locationIds = [],
  isAdmin = false,
}) {
  const client = await getPool().connect();
  const hash = hashRequest({ catalogPartId, locationId, quantity, confirmation });
  try {
    await client.query("begin");
    const partResult = await client.query(
      `select catalog.company_id, catalog.id as catalog_part_id, catalog.part_number,
              catalog.description, catalog.normalized_part_number, catalog.uom_code,
              location.id as location_id, location.name as location_name,
              uom.category as uom_category, uom.decimal_scale
       from parts_catalog catalog
       join locations location on location.company_id = catalog.company_id and location.id = $2
       join units_of_measure uom on uom.code = catalog.uom_code
       where catalog.id = $1 and catalog.company_id = any($3::uuid[])
         and ($5::boolean or location.id = any($4::uuid[]))
       limit 1`,
      [catalogPartId, locationId, companyIds, locationIds, isAdmin],
    );
    const part = partResult.rows[0];
    if (!part) {
      await client.query("rollback");
      return { kind: "not_found" };
    }
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [
      `part-serialization:${part.company_id}:${actorId}:${idempotencyKey}`,
    ]);
    const replay = await client.query(
      `select batch.request_hash, batch.quantity, receipt.id as receipt_id,
              labels.id as label_batch_id
       from inventory_serialization_batches batch
       join inventory_receipts receipt
         on receipt.company_id = batch.company_id and receipt.serialization_batch_id = batch.id
       join inventory_label_batches labels
         on labels.company_id = receipt.company_id and labels.receipt_id = receipt.id
       where batch.company_id = $1 and batch.created_by = $2 and batch.idempotency_key = $3
       limit 1`,
      [part.company_id, actorId, idempotencyKey],
    );
    if (replay.rows[0]) {
      await client.query("commit");
      if (replay.rows[0].request_hash !== hash) return { kind: "replay_conflict" };
      return {
        kind: "created",
        replayed: true,
        quantity: Number(replay.rows[0].quantity),
        batch: {
          id: replay.rows[0].label_batch_id,
          receiptId: replay.rows[0].receipt_id,
          itemCount: Number(replay.rows[0].quantity),
          printUrl: `/api/office/inventory/label-batches/${encodeURIComponent(replay.rows[0].label_batch_id)}/print`,
        },
      };
    }
    if (!["count", "packaging"].includes(part.uom_category) || Number(part.decimal_scale) !== 0) {
      await client.query("rollback");
      return { kind: "unsupported_unit" };
    }

    const serializationBatchId = randomUUID();
    const receiptId = randomUUID();
    const receiptLineId = randomUUID();
    const labelBatchId = randomUUID();
    const unitIds = Array.from({ length: quantity }, () => randomUUID());
    const ordinals = unitIds.map((_, index) => index + 1);
    const serials = ordinals.map((ordinal) => generatedSerial(serializationBatchId, ordinal));

    await client.query(
      `insert into inventory_serialization_batches (
         id, company_id, location_id, catalog_part_id, created_by,
         idempotency_key, request_hash, quantity, physical_confirmation
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,'physically_present_at_location')`,
      [serializationBatchId, part.company_id, part.location_id, part.catalog_part_id,
        actorId, idempotencyKey, hash, quantity],
    );
    await client.query(
      `insert into inventory_receipts (
         id, company_id, location_id, invoice_run_id, count_import_id, serialization_batch_id,
         created_by, idempotency_key, provider, provider_marker, provider_picking_name,
         status, confirmed_at
       ) values ($1,$2,$3,null,null,$4,$5,$6,'local_serialization',$7,'Serialized physical intake','confirmed',now())`,
      [receiptId, part.company_id, part.location_id, serializationBatchId,
        actorId, idempotencyKey, `SER-${serializationBatchId}`],
    );
    await client.query(
      `insert into inventory_receipt_lines (
         id, company_id, receipt_id, line_index, catalog_part_id, product_external_id,
         part_number, description, quantity, uom_code, tracking_mode
       ) values ($1,$2,$3,0,$4,$5,$6,$7,$8,$9,'serial')`,
      [receiptLineId, part.company_id, receiptId, part.catalog_part_id,
        `local-serialization:${part.catalog_part_id}`, part.part_number,
        part.description || "", quantity, part.uom_code],
    );
    await client.query(
      `insert into inventory_serialized_units (
         id, company_id, location_id, receipt_id, receipt_line_id,
         unit_ordinal, serial_number, status
       )
       select input.id, $1, $2, $3, $4, input.ordinal, input.serial_number, 'in_stock'
       from unnest($5::uuid[], $6::integer[], $7::text[])
         as input(id, ordinal, serial_number)`,
      [part.company_id, part.location_id, receiptId, receiptLineId, unitIds, ordinals, serials],
    );
    await client.query(
      `insert into inventory_unit_events (company_id, unit_id, event_type, actor_id, details)
       select $1, input.id, 'receipt_recorded', $2,
              jsonb_build_object('source', 'part_detail_serialization', 'serializationBatchId', $3::text)
       from unnest($4::uuid[]) as input(id)`,
      [part.company_id, actorId, serializationBatchId, unitIds],
    );
    const balance = await client.query(
      `insert into inventory_items (
         company_id, location_id, catalog_part_id, normalized_part_number,
         part_number, description, quantity_on_hand, quantity_reserved, uom_code,
         source_provider, external_id, last_seen_at, updated_at
       ) values ($1,$2,$3,$4,$5,$6,$7,0,$8,'local',$9,now(),now())
       on conflict (
         company_id,
         (coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid)),
         normalized_part_number,
         uom_code
       ) do update set
         catalog_part_id = excluded.catalog_part_id,
         part_number = excluded.part_number,
         description = excluded.description,
         quantity_on_hand = inventory_items.quantity_on_hand + excluded.quantity_on_hand,
         source_provider = 'local',
         updated_at = now()
       where inventory_items.source_provider = 'local'
       returning id`,
      [part.company_id, part.location_id, part.catalog_part_id,
        part.normalized_part_number, part.part_number, part.description || "",
        quantity, part.uom_code, `local:${part.catalog_part_id}:${part.location_id}:${part.uom_code}`],
    );
    if (!balance.rows[0]) throw new Error("Local inventory ownership changed during serialization.");
    await client.query(
      `insert into inventory_stock_movements (
         company_id, location_id, catalog_part_id, receipt_id, receipt_line_id,
         movement_type, quantity_delta, uom_code, actor_id, reason, idempotency_key
       ) values ($1,$2,$3,$4,$5,'adjustment',$6,$7,$8,$9,$10)`,
      [part.company_id, part.location_id, part.catalog_part_id, receiptId,
        receiptLineId, quantity, part.uom_code, actorId,
        "Physical serialized intake from part details",
        `part-serialization:${serializationBatchId}`],
    );
    const batch = await createReceiptLabelBatch(client, {
      batchId: labelBatchId,
      companyId: part.company_id,
      locationId: part.location_id,
      receiptId,
      actorId,
      purpose: "serialization",
      templateVersion: "part-serialization-label-v1",
      items: unitIds.map((unitId, index) => ({
        id: randomUUID(),
        unitId,
        ordinal: index + 1,
        partNumber: part.part_number,
        description: part.description || "",
        serialNumber: serials[index],
        locationName: part.location_name,
      })),
    });
    await client.query("commit");
    return { kind: "created", replayed: false, quantity, batch };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export const inventoryPartSerializationInternals = { generatedSerial, hashRequest };
