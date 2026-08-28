import { query } from "../pool.js";

function publicBatch(row) {
  if (!row) return null;
  return {
    id: row.id,
    receiptId: row.receipt_id,
    locationId: row.location_id,
    locationName: row.location_name || "",
    status: row.status,
    templateVersion: row.template_version,
    itemCount: Number(row.item_count),
    createdAt: row.created_at,
    manifestUrl: `/api/office/inventory/label-batches/${encodeURIComponent(row.id)}/items`,
    printUrl: `/api/office/inventory/label-batches/${encodeURIComponent(row.id)}/print`,
  };
}

function publicItem(row) {
  return {
    id: row.id,
    unitId: row.unit_id,
    ordinal: Number(row.ordinal),
    partNumber: row.part_number_snapshot,
    description: row.description_snapshot,
    serialNumber: row.serial_number_snapshot,
    locationName: row.location_name_snapshot,
    qrFormatVersion: Number(row.qr_format_version),
    qrSvgUrl: `/api/office/inventory/units/${encodeURIComponent(row.unit_id)}/qr.svg`,
  };
}

export async function createReceiptLabelBatch(client, {
  batchId,
  companyId,
  locationId,
  receiptId,
  actorId,
  purpose = "receipt",
  templateVersion = "receipt-label-v1",
  items,
}) {
  if (!items.length) return null;
  await client.query(
    `insert into inventory_label_batches (
       id, company_id, location_id, receipt_id, created_by,
       purpose, template_version, item_count
     ) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [batchId, companyId, locationId, receiptId, actorId, purpose, templateVersion, items.length],
  );
  await client.query(
    `insert into inventory_label_batch_items (
       id, company_id, batch_id, unit_id, ordinal,
       part_number_snapshot, description_snapshot, serial_number_snapshot,
       location_name_snapshot, qr_format_version
     )
     select input.id, $1, $2, input.unit_id, input.ordinal,
            input.part_number, input.description, input.serial_number,
            input.location_name, 1
     from unnest(
       $3::uuid[], $4::uuid[], $5::integer[], $6::text[],
       $7::text[], $8::text[], $9::text[]
     ) as input(id, unit_id, ordinal, part_number, description, serial_number, location_name)`,
    [companyId, batchId, items.map((item) => item.id), items.map((item) => item.unitId),
      items.map((item) => item.ordinal), items.map((item) => item.partNumber),
      items.map((item) => item.description), items.map((item) => item.serialNumber),
      items.map((item) => item.locationName)],
  );
  return {
    id: batchId,
    receiptId,
    locationId,
    locationName: items[0].locationName,
    status: "ready",
    templateVersion,
    itemCount: items.length,
    createdAt: new Date().toISOString(),
    manifestUrl: `/api/office/inventory/label-batches/${encodeURIComponent(batchId)}/items`,
    printUrl: `/api/office/inventory/label-batches/${encodeURIComponent(batchId)}/print`,
  };
}

export async function loadReceiptLabelBatch(client, { companyId, receiptId }) {
  const result = await client.query(
    `select batch.*, location.name as location_name
     from inventory_label_batches batch
     join locations location
       on location.company_id = batch.company_id and location.id = batch.location_id
     where batch.company_id = $1 and batch.receipt_id = $2
     limit 1`,
    [companyId, receiptId],
  );
  return publicBatch(result.rows[0]);
}

export async function getInventoryLabelBatch({ batchId, companyIds, locationIds = [], isAdmin = false }) {
  const result = await query(
    `select batch.*, location.name as location_name
     from inventory_label_batches batch
     join locations location
       on location.company_id = batch.company_id and location.id = batch.location_id
     where batch.id = $1 and batch.company_id = any($2::uuid[])
       and ($4::boolean or batch.location_id = any($3::uuid[]))
     limit 1`,
    [batchId, companyIds, locationIds, isAdmin],
  );
  return publicBatch(result.rows[0]);
}

export async function listInventoryLabelBatchItems({ batchId, companyIds, locationIds = [], isAdmin = false, afterOrdinal = 0, limit = 100 }) {
  const result = await query(
    `select item.*
     from inventory_label_batch_items item
     join inventory_label_batches batch
       on batch.company_id = item.company_id and batch.id = item.batch_id
     where item.batch_id = $1 and item.company_id = any($2::uuid[])
       and ($4::boolean or batch.location_id = any($3::uuid[]))
       and item.ordinal > $5
     order by item.ordinal, item.id
     limit $6`,
    [batchId, companyIds, locationIds, isAdmin, afterOrdinal, limit],
  );
  return result.rows.map(publicItem);
}

export async function listAllInventoryLabelBatchItems(scope) {
  return listInventoryLabelBatchItems({ ...scope, afterOrdinal: 0, limit: 500 });
}
