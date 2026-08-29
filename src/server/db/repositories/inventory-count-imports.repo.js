import { randomUUID } from "node:crypto";
import { getPool, query } from "../pool.js";
import { createReceiptLabelBatch } from "./inventory-labels.repo.js";

const INVENTORY_COUNT_BATCH_UNIT_LIMIT = 500;

function publicLine(row) {
  return {
    id: row.id,
    sourceRow: Number(row.source_row),
    sourcePartNumber: row.source_part_number,
    sourcePartName: row.source_part_name,
    sourceDescription: row.source_description,
    sourceBinLocation: row.source_bin_location,
    binLocation: row.reviewed_bin_location,
    sourceQuantity: row.source_quantity_text,
    quantity: row.quantity === null ? null : Number(row.quantity),
    averageCost: row.average_cost === null ? null : Number(row.average_cost),
    catalogPartId: row.catalog_part_id || null,
    partNumber: row.part_number || "",
    description: row.catalog_description || "",
    manufacturer: row.manufacturer || "",
    uomCode: row.uom_code || "ea",
    matchStatus: row.match_status,
    resolutionSource: row.resolution_source,
    appliedReceiptId: row.applied_receipt_id || null,
    appliedAt: row.applied_at || null,
  };
}

function publicImport(row, lines = [], labelBatches = []) {
  if (!row) return null;
  return {
    id: row.id,
    companyId: row.company_id,
    locationId: row.location_id,
    locationName: row.location_name || "",
    sourceFileName: row.source_file_name,
    sourceContentType: row.source_content_type || "",
    sourceSizeBytes: row.source_size_bytes === null || row.source_size_bytes === undefined ? null : Number(row.source_size_bytes),
    sourceAvailable: Boolean(row.source_available),
    downloadUrl: row.source_available ? `/api/office/inventory/count-imports/${encodeURIComponent(row.id)}/file` : "",
    sourceSha256: row.source_sha256,
    status: row.status,
    rowCount: Number(row.row_count),
    readyCount: Number(row.ready_count),
    exceptionCount: Number(row.exception_count),
    appliedCount: Number(row.applied_count),
    version: Number(row.version),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    appliedAt: row.applied_at || null,
    lines: lines.map(publicLine),
    labelBatches: labelBatches.map((batch) => ({
      id: batch.id,
      receiptId: batch.receipt_id,
      itemCount: Number(batch.item_count),
      printUrl: `/api/office/inventory/label-batches/${encodeURIComponent(batch.id)}/print`,
    })),
  };
}

const IMPORT_METADATA_COLUMNS = `
  stocktake.id, stocktake.company_id, stocktake.location_id, stocktake.created_by,
  stocktake.source_file_name, stocktake.source_sha256, stocktake.source_content_type,
  stocktake.source_size_bytes,
  (stocktake.source_ciphertext is not null and stocktake.source_retention_until > now()) as source_available,
  stocktake.status, stocktake.row_count, stocktake.ready_count, stocktake.exception_count,
  stocktake.applied_count, stocktake.version, stocktake.created_at, stocktake.updated_at,
  stocktake.applied_at`;

async function loadImport(client, { importId, companyIds, locationIds = [], isAdmin = false }) {
  const selected = await client.query(
    `select ${IMPORT_METADATA_COLUMNS}, location.name as location_name
     from inventory_count_imports stocktake
     join locations location
       on location.company_id = stocktake.company_id and location.id = stocktake.location_id
     where stocktake.id = $1 and stocktake.company_id = any($2::uuid[])
       and ($4::boolean or stocktake.location_id = any($3::uuid[]))
     limit 1`,
    [importId, companyIds, locationIds, isAdmin],
  );
  const source = selected.rows[0];
  if (!source) return null;
  const lines = await client.query(
    `select line.*, catalog.part_number, catalog.description as catalog_description,
            catalog.manufacturer, catalog.uom_code
     from inventory_count_import_lines line
     left join parts_catalog catalog
       on catalog.company_id = line.company_id and catalog.id = line.catalog_part_id
     where line.company_id = $1 and line.import_id = $2
     order by line.source_row, line.id`,
    [source.company_id, source.id],
  );
  const batches = await client.query(
    `select batch.id, batch.receipt_id, batch.item_count
     from inventory_receipts receipt
     join inventory_label_batches batch
       on batch.company_id = receipt.company_id and batch.receipt_id = receipt.id
     where receipt.company_id = $1 and receipt.count_import_id = $2 and batch.status = 'ready'
     order by batch.created_at, batch.id`,
    [source.company_id, source.id],
  );
  return publicImport(source, lines.rows, batches.rows);
}

async function refreshCounts(client, companyId, importId) {
  await client.query(
    `update inventory_count_imports stocktake
     set ready_count = counts.ready_count,
         exception_count = counts.exception_count,
         applied_count = counts.applied_count,
         status = case
           when counts.applied_count > 0 and counts.remaining_count = 0 then 'applied'
           when counts.applied_count > 0 then 'partial'
           else 'draft'
         end,
         applied_at = case
           when counts.applied_count > 0 and counts.remaining_count = 0 then coalesce(stocktake.applied_at, now())
           else null
         end,
         version = stocktake.version + 1,
         updated_at = now()
     from (
       select count(*) filter (where match_status = 'ready')::integer as ready_count,
              count(*) filter (where match_status in ('unmatched', 'duplicate', 'invalid_quantity'))::integer as exception_count,
              count(*) filter (where match_status = 'applied')::integer as applied_count,
              count(*) filter (where match_status not in ('applied', 'ignored'))::integer as remaining_count
       from inventory_count_import_lines
       where company_id = $1 and import_id = $2
     ) counts
     where stocktake.company_id = $1 and stocktake.id = $2`,
    [companyId, importId],
  );
}

export async function createInventoryCountImport({
  importId,
  companyIds,
  locationIds = [],
  isAdmin = false,
  actorId,
  locationId,
  sourceFileName,
  sourceContentType,
  sourceSizeBytes,
  sourceRetentionUntil,
  encryptedSource,
  sourceSha256,
  rows,
}) {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const location = await client.query(
      `select id, company_id
       from locations
       where id = $1 and company_id = any($2::uuid[])
         and ($4::boolean or id = any($3::uuid[]))
       limit 1 for update`,
      [locationId, companyIds, locationIds, isAdmin],
    );
    const target = location.rows[0];
    if (!target) {
      await client.query("rollback");
      return { kind: "not_found" };
    }
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [
      `inventory-count-import:${target.company_id}:${locationId}:${sourceSha256}`,
    ]);
    const existing = await client.query(
      `select id from inventory_count_imports
       where company_id = $1 and location_id = $2 and source_sha256 = $3
       limit 1`,
      [target.company_id, locationId, sourceSha256],
    );
    if (existing.rows[0]) {
      const value = await loadImport(client, {
        importId: existing.rows[0].id,
        companyIds: [target.company_id],
        locationIds: [locationId],
        isAdmin: true,
      });
      await client.query("commit");
      return { kind: "replay", import: value };
    }
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [`inventory-count-storage:${target.company_id}`]);
    const storage = await client.query(
      `select coalesce(sum(source_size_bytes) filter (where source_ciphertext is not null), 0)::bigint as used_bytes
       from inventory_count_imports where company_id = $1`,
      [target.company_id],
    );
    if (Number(storage.rows[0]?.used_bytes || 0) + sourceSizeBytes > 100_000_000) {
      await client.query("rollback");
      return { kind: "quota_exceeded" };
    }
    const normalized = [...new Set(rows.map((row) => row.normalizedPartNumber))];
    const catalog = await client.query(
      `select id, normalized_part_number
       from parts_catalog
       where company_id = $1 and normalized_part_number = any($2::text[])`,
      [target.company_id, normalized],
    );
    const catalogByNumber = new Map(catalog.rows.map((part) => [part.normalized_part_number, part.id]));
    const occurrenceCount = new Map();
    for (const row of rows) {
      occurrenceCount.set(row.normalizedPartNumber, (occurrenceCount.get(row.normalizedPartNumber) || 0) + 1);
    }
    const prepared = rows.map((row) => {
      const catalogPartId = catalogByNumber.get(row.normalizedPartNumber) || null;
      let matchStatus = "ready";
      if (!row.quantity) matchStatus = "invalid_quantity";
      else if ((occurrenceCount.get(row.normalizedPartNumber) || 0) > 1) matchStatus = "duplicate";
      else if (!catalogPartId) matchStatus = "unmatched";
      return {
        ...row,
        catalogPartId: matchStatus === "ready" ? catalogPartId : null,
        matchStatus,
        resolutionSource: matchStatus === "ready" ? "exact" : "none",
      };
    });
    const readyCount = prepared.filter((row) => row.matchStatus === "ready").length;
    const exceptionCount = prepared.length - readyCount;
    await client.query(
      `insert into inventory_count_imports (
         id, company_id, location_id, created_by, source_file_name, source_sha256,
         source_content_type, source_size_bytes, source_ciphertext, source_iv,
         source_auth_tag, source_key_version, source_retention_until,
         row_count, ready_count, exception_count
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
                 $13, $14, $15, $16)`,
      [importId, target.company_id, locationId, actorId, sourceFileName, sourceSha256,
        sourceContentType, sourceSizeBytes, encryptedSource.ciphertext, encryptedSource.iv,
        encryptedSource.authTag, encryptedSource.keyVersion, sourceRetentionUntil,
        prepared.length, readyCount, exceptionCount],
    );
    await client.query(
      `insert into inventory_count_import_lines (
         id, company_id, import_id, source_row, source_part_number,
         source_part_name, source_description, source_bin_location, reviewed_bin_location,
         source_quantity_text, quantity, average_cost, catalog_part_id,
         match_status, resolution_source
       )
       select input.id, $1, $2, input.source_row, input.source_part_number,
              input.source_part_name, input.source_description, input.source_bin_location, input.source_bin_location,
              input.source_quantity_text, input.quantity, input.average_cost,
              input.catalog_part_id, input.match_status, input.resolution_source
       from jsonb_to_recordset($3::jsonb) as input(
         id uuid, source_row integer, source_part_number text, source_part_name text,
         source_description text, source_bin_location text, source_quantity_text text,
         quantity integer, average_cost numeric, catalog_part_id uuid,
         match_status text, resolution_source text
       )`,
      [target.company_id, importId, JSON.stringify(prepared.map((row) => ({
        id: randomUUID(),
        source_row: row.sourceRow,
        source_part_number: row.partNumber,
        source_part_name: row.partName,
        source_description: row.description,
        source_bin_location: row.binLocation,
        source_quantity_text: row.quantityText,
        quantity: row.quantity,
        average_cost: row.averageCost,
        catalog_part_id: row.catalogPartId,
        match_status: row.matchStatus,
        resolution_source: row.resolutionSource,
      })))],
    );
    const value = await loadImport(client, {
      importId,
      companyIds: [target.company_id],
      locationIds: [locationId],
      isAdmin: true,
    });
    await client.query("commit");
    return { kind: "created", import: value };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function getInventoryCountImport(scope) {
  const client = await getPool().connect();
  try {
    return await loadImport(client, scope);
  } finally {
    client.release();
  }
}

export async function getInventoryCountImportFile({ importId, companyIds, locationIds = [], isAdmin = false }) {
  const result = await query(
      `select id, company_id, source_file_name, source_sha256, source_content_type,
              source_size_bytes, source_ciphertext, source_iv, source_auth_tag, source_key_version
       from inventory_count_imports
       where id = $1 and company_id = any($2::uuid[])
         and ($4::boolean or location_id = any($3::uuid[]))
         and source_ciphertext is not null and source_retention_until > now()
       limit 1`,
      [importId, companyIds, locationIds, isAdmin],
  );
  return result.rows[0] || null;
}

export async function auditInventoryCountFileDownload({ companyId, importId, actorId }) {
  await query(
    `insert into inventory_count_source_access_events (company_id, import_id, actor_id, action)
     values ($1, $2, $3, 'download')`,
    [companyId, importId, actorId],
  );
}

export async function resolveInventoryCountImportLine({
  importId,
  lineId,
  actorId,
  companyIds,
  locationIds = [],
  isAdmin = false,
  expectedVersion,
  action,
  catalogPartId,
  quantity,
  binLocation,
}) {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const selected = await client.query(
      `select stocktake.id, stocktake.company_id, stocktake.location_id, stocktake.version
       from inventory_count_imports stocktake
       where stocktake.id = $1 and stocktake.company_id = any($2::uuid[])
         and ($4::boolean or stocktake.location_id = any($3::uuid[]))
       limit 1 for update`,
      [importId, companyIds, locationIds, isAdmin],
    );
    const stocktake = selected.rows[0];
    if (!stocktake) {
      await client.query("rollback");
      return { kind: "not_found" };
    }
    if (Number(stocktake.version) !== Number(expectedVersion)) {
      await client.query("rollback");
      return { kind: "stale" };
    }
    const line = await client.query(
      `select id, catalog_part_id, quantity, reviewed_bin_location, match_status
       from inventory_count_import_lines
       where company_id = $1 and import_id = $2 and id = $3
       limit 1 for update`,
      [stocktake.company_id, stocktake.id, lineId],
    );
    if (!line.rows[0] || line.rows[0].match_status === "applied") {
      await client.query("rollback");
      return { kind: "not_found" };
    }
    let updatedLine;
    if (action === "ignore") {
      updatedLine = await client.query(
        `update inventory_count_import_lines
         set match_status = 'ignored', catalog_part_id = null, quantity = null,
             resolution_source = 'manual', updated_at = now()
         where company_id = $1 and import_id = $2 and id = $3
         returning catalog_part_id, quantity, reviewed_bin_location, match_status`,
        [stocktake.company_id, stocktake.id, lineId],
      );
    } else {
      const catalog = await client.query(
        `select id from parts_catalog where company_id = $1 and id = $2 limit 1`,
        [stocktake.company_id, catalogPartId],
      );
      if (!catalog.rows[0]) {
        await client.query("rollback");
        return { kind: "catalog_not_found" };
      }
      const duplicate = await client.query(
        `select 1 from inventory_count_import_lines
         where company_id = $1 and import_id = $2 and catalog_part_id = $3
           and id <> $4 and match_status in ('ready', 'applied')
         limit 1`,
        [stocktake.company_id, stocktake.id, catalogPartId, lineId],
      );
      if (duplicate.rows[0]) {
        await client.query("rollback");
        return { kind: "duplicate" };
      }
      updatedLine = await client.query(
        `update inventory_count_import_lines
         set match_status = 'ready', catalog_part_id = $4, quantity = $5,
             reviewed_bin_location = $6, resolution_source = 'manual', updated_at = now()
         where company_id = $1 and import_id = $2 and id = $3
         returning catalog_part_id, quantity, reviewed_bin_location, match_status`,
        [stocktake.company_id, stocktake.id, lineId, catalogPartId, quantity, binLocation],
      );
    }
    const reviewState = (row) => ({
      catalogPartId: row.catalog_part_id || null,
      quantity: row.quantity === null ? null : Number(row.quantity),
      reviewedBinLocation: row.reviewed_bin_location,
      matchStatus: row.match_status,
    });
    await client.query(
      `insert into inventory_count_review_events (
         company_id, import_id, line_id, actor_id, action, before_state, after_state
       ) values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)`,
      [stocktake.company_id, stocktake.id, lineId, actorId, action,
        JSON.stringify(reviewState(line.rows[0])), JSON.stringify(reviewState(updatedLine.rows[0]))],
    );
    await refreshCounts(client, stocktake.company_id, stocktake.id);
    const value = await loadImport(client, {
      importId: stocktake.id,
      companyIds: [stocktake.company_id],
      locationIds: [stocktake.location_id],
      isAdmin: true,
    });
    await client.query("commit");
    return { kind: "updated", import: value };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

function chunksByUnitLimit(lines, limit = INVENTORY_COUNT_BATCH_UNIT_LIMIT) {
  const chunks = [];
  let current = [];
  let total = 0;
  for (const line of lines) {
    if (current.length && total + Number(line.quantity) > limit) {
      chunks.push(current);
      current = [];
      total = 0;
    }
    current.push(line);
    total += Number(line.quantity);
  }
  if (current.length) chunks.push(current);
  return chunks;
}

export async function applyInventoryCountImport({
  importId,
  companyIds,
  locationIds = [],
  isAdmin = false,
  actorId,
  expectedVersion,
  createLabelBatch = createReceiptLabelBatch,
}) {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const selected = await client.query(
      `select stocktake.id, stocktake.company_id, stocktake.location_id,
              stocktake.source_file_name, stocktake.version, location.name as location_name
       from inventory_count_imports stocktake
       join locations location
         on location.company_id = stocktake.company_id and location.id = stocktake.location_id
       where stocktake.id = $1 and stocktake.company_id = any($2::uuid[])
         and ($4::boolean or stocktake.location_id = any($3::uuid[]))
       limit 1 for update`,
      [importId, companyIds, locationIds, isAdmin],
    );
    const stocktake = selected.rows[0];
    if (!stocktake) {
      await client.query("rollback");
      return { kind: "not_found" };
    }
    if (Number(stocktake.version) !== Number(expectedVersion)) {
      await client.query("rollback");
      return { kind: "stale" };
    }
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [
      `inventory-count-apply:${stocktake.company_id}:${stocktake.location_id}`,
    ]);
    const ready = await client.query(
      `select line.*, catalog.part_number, catalog.normalized_part_number,
              catalog.description as catalog_description, catalog.uom_code
       from inventory_count_import_lines line
       join parts_catalog catalog
         on catalog.company_id = line.company_id and catalog.id = line.catalog_part_id
       where line.company_id = $1 and line.import_id = $2 and line.match_status = 'ready'
       order by line.source_row, line.id
       for update of line`,
      [stocktake.company_id, stocktake.id],
    );
    if (!ready.rows.length) {
      const value = await loadImport(client, {
        importId: stocktake.id,
        companyIds: [stocktake.company_id],
        locationIds: [stocktake.location_id],
        isAdmin: true,
      });
      await client.query("commit");
      return { kind: "replay", import: value };
    }
    for (const line of ready.rows) {
      const existing = await client.query(
        `select id, source_provider, external_id, quantity_on_hand, quantity_reserved,
                provider_updated_at, last_seen_at
         from inventory_items
         where company_id = $1 and location_id = $2 and catalog_part_id = $3 and uom_code = $4
           and source_provider = 'local'
         limit 1 for update`,
        [stocktake.company_id, stocktake.location_id, line.catalog_part_id, line.uom_code],
      );
      if (existing.rows[0]) {
        await client.query("rollback");
        return {
          kind: "stock_conflict",
          sourceRow: Number(line.source_row),
        };
      }
    }
    const chunks = chunksByUnitLimit(ready.rows);
    for (const [chunkIndex, lines] of chunks.entries()) {
      const receiptId = randomUUID();
      const labelBatchId = randomUUID();
      await client.query(
        `insert into inventory_receipts (
           id, company_id, location_id, invoice_run_id, count_import_id, created_by,
           idempotency_key, provider, provider_marker, provider_picking_name,
           status, confirmed_at
         ) values ($1, $2, $3, null, $4, $5, $6, 'local_count', $7, 'Opening inventory count', 'confirmed', now())`,
        [receiptId, stocktake.company_id, stocktake.location_id, stocktake.id, actorId,
          `count:${stocktake.id}:chunk:${chunkIndex + 1}`,
          `COUNT-${stocktake.id.replaceAll("-", "").slice(0, 20).toUpperCase()}-${chunkIndex + 1}`],
      );
      const labelItems = [];
      for (const [lineIndex, line] of lines.entries()) {
        const receiptLineId = randomUUID();
        await client.query(
          `insert into inventory_receipt_lines (
             id, company_id, receipt_id, line_index, catalog_part_id,
             product_external_id, part_number, description, quantity, uom_code, tracking_mode
           ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'serial')`,
          [receiptLineId, stocktake.company_id, receiptId, lineIndex, line.catalog_part_id,
            `local-count:${line.catalog_part_id}`, line.part_number,
            line.catalog_description || line.source_part_name || line.source_description || "",
            line.quantity, line.uom_code],
        );
        await client.query(
          `insert into inventory_stock_movements (
             company_id, location_id, catalog_part_id, receipt_id, receipt_line_id,
             movement_type, quantity_delta, uom_code, actor_id, reason, idempotency_key
           ) values ($1, $2, $3, $4, $5, 'adjustment', $6, $7, $8, $9, $10)`,
          [stocktake.company_id, stocktake.location_id, line.catalog_part_id, receiptId,
            receiptLineId, line.quantity, line.uom_code, actorId,
            `Opening count from ${stocktake.source_file_name}, row ${line.source_row}`,
            `count-import:${stocktake.id}:row:${line.source_row}`],
        );
        const unitIds = Array.from({ length: Number(line.quantity) }, () => randomUUID());
        const ordinals = unitIds.map((_, index) => index + 1);
        const serials = ordinals.map((ordinal) => (
          `WG-C-${stocktake.id.replaceAll("-", "").slice(0, 12).toUpperCase()}-${line.source_row}-${ordinal}`
        ));
        await client.query(
          `insert into inventory_serialized_units (
             id, company_id, location_id, receipt_id, receipt_line_id,
             unit_ordinal, serial_number, status
           )
           select input.id, $1, $2, $3, $4, input.ordinal, input.serial_number, 'in_stock'
           from unnest($5::uuid[], $6::integer[], $7::text[])
             as input(id, ordinal, serial_number)`,
          [stocktake.company_id, stocktake.location_id, receiptId, receiptLineId,
            unitIds, ordinals, serials],
        );
        await client.query(
          `insert into inventory_unit_events (company_id, unit_id, event_type, actor_id, details)
           select $1, input.id, 'receipt_recorded', $2,
                  jsonb_build_object('source', 'opening_count', 'countImportId', $3::text, 'sourceRow', $4::integer)
           from unnest($5::uuid[]) as input(id)`,
          [stocktake.company_id, actorId, stocktake.id, line.source_row, unitIds],
        );
        const balance = await client.query(
          `insert into inventory_items (
             company_id, location_id, catalog_part_id, normalized_part_number, part_number,
             description, quantity_on_hand, quantity_reserved, uom_code, bin_location,
             source_provider, external_id, last_seen_at, updated_at
           ) values ($1, $2, $3, $4, $5, $6, $7, 0, $8, $9, 'local', $10, now(), now())
           on conflict (
             company_id,
             (coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid)),
             normalized_part_number,
             uom_code
           ) do nothing
           returning id`,
          [stocktake.company_id, stocktake.location_id, line.catalog_part_id,
            line.normalized_part_number, line.part_number,
            line.catalog_description || line.source_part_name || line.source_description || "",
            line.quantity, line.uom_code, line.reviewed_bin_location,
            `local-count:${stocktake.id}:${line.catalog_part_id}`],
        );
        if (!balance.rows[0]) throw new Error("Inventory count ownership changed during apply.");
        unitIds.forEach((unitId, index) => labelItems.push({
          id: randomUUID(),
          unitId,
          ordinal: labelItems.length + 1,
          partNumber: line.part_number,
          description: line.catalog_description || line.source_part_name || line.source_description || "",
          serialNumber: serials[index],
          locationName: stocktake.location_name,
        }));
        await client.query(
          `update inventory_count_import_lines
           set match_status = 'applied', applied_receipt_id = $4, applied_at = now(), updated_at = now()
           where company_id = $1 and import_id = $2 and id = $3`,
          [stocktake.company_id, stocktake.id, line.id, receiptId],
        );
      }
      await createLabelBatch(client, {
        batchId: labelBatchId,
        companyId: stocktake.company_id,
        locationId: stocktake.location_id,
        receiptId,
        actorId,
        purpose: "stock_count",
        templateVersion: "stock-count-label-v1",
        items: labelItems,
      });
    }
    await refreshCounts(client, stocktake.company_id, stocktake.id);
    const value = await loadImport(client, {
      importId: stocktake.id,
      companyIds: [stocktake.company_id],
      locationIds: [stocktake.location_id],
      isAdmin: true,
    });
    await client.query("commit");
    return { kind: "applied", import: value };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export const inventoryCountImportInternals = {
  batchUnitLimit: INVENTORY_COUNT_BATCH_UNIT_LIMIT,
  chunksByUnitLimit,
};

export async function listInventoryCountImports({ companyIds, locationIds = [], isAdmin = false, limit = 20, offset = 0 }) {
  const [result, count] = await Promise.all([
    query(
    `select ${IMPORT_METADATA_COLUMNS}, location.name as location_name
     from inventory_count_imports stocktake
     join locations location
       on location.company_id = stocktake.company_id and location.id = stocktake.location_id
     where stocktake.company_id = any($1::uuid[])
       and ($3::boolean or stocktake.location_id = any($2::uuid[]))
     order by stocktake.updated_at desc, stocktake.id
     limit $4 offset $5`,
    [companyIds, locationIds, isAdmin, limit, offset],
    ),
    query(
      `select count(*)::integer as total
       from inventory_count_imports stocktake
       where stocktake.company_id = any($1::uuid[])
         and ($3::boolean or stocktake.location_id = any($2::uuid[]))`,
      [companyIds, locationIds, isAdmin],
    ),
  ]);
  return { imports: result.rows.map((row) => publicImport(row)), total: Number(count.rows[0]?.total || 0) };
}

export async function deleteExpiredInventoryCountSources({ limit = 100 } = {}) {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const deleted = await client.query(
      `with expired as (
         select company_id, id from inventory_count_imports
         where source_ciphertext is not null and source_retention_until <= now()
         order by source_retention_until, id
         limit $1 for update skip locked
       )
       update inventory_count_imports stocktake
       set source_ciphertext = null, source_iv = null, source_auth_tag = null,
           source_key_version = null,
           source_retention_until = null, source_deleted_at = now(), updated_at = now()
       from expired
       where stocktake.company_id = expired.company_id and stocktake.id = expired.id
       returning stocktake.company_id, stocktake.id`,
      [limit],
    );
    if (deleted.rows.length) {
      await client.query(
        `insert into inventory_count_source_access_events (company_id, import_id, actor_id, action)
         select source.company_id, source.id, null, 'retention_delete'
         from jsonb_to_recordset($1::jsonb) as source(company_id uuid, id uuid)`,
        [JSON.stringify(deleted.rows)],
      );
    }
    await client.query("commit");
    return deleted.rows.length;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function findAuthorizedInventoryLocation({ locationId, companyIds, locationIds = [], isAdmin = false }) {
  const result = await query(
    `select id, company_id, name
     from locations
     where id = $1 and company_id = any($2::uuid[])
       and ($4::boolean or id = any($3::uuid[]))
     limit 1`,
    [locationId, companyIds, locationIds, isAdmin],
  );
  return result.rows[0] || null;
}
