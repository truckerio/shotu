import { getPool, query } from "../pool.js";

export async function loadReviewedInvoiceForReceipt({ runId, companyIds }) {
  const result = await query(
    `select r.id, r.company_id, r.location_id, r.status, r.version, r.reviewed_draft,
            r.reviewed_at, location.name as location_name
     from invoice_extraction_runs r
     join locations location on location.company_id = r.company_id and location.id = r.location_id
     where r.id = $1 and r.company_id = any($2::uuid[])
     limit 1`,
    [runId, companyIds],
  );
  return result.rows[0] || null;
}

export async function loadOdooProductMappings({ companyId, normalizedPartNumbers }) {
  const result = await query(
    `select catalog.id as catalog_part_id, catalog.normalized_part_number,
            catalog.part_number, catalog.description, catalog.uom_code,
            mapping.external_id as product_external_id, mapping.display_name,
            mapping.active
     from parts_catalog catalog
     join odoo_product_mappings mapping
       on mapping.company_id = catalog.company_id and mapping.catalog_part_id = catalog.id
     where catalog.company_id = $1
       and catalog.normalized_part_number = any($2::text[])
       and mapping.active = true
     order by catalog.normalized_part_number, mapping.external_id`,
    [companyId, normalizedPartNumbers],
  );
  return result.rows;
}

export async function loadMappedOdooReceiptLocations({ companyId, locationId }) {
  const result = await query(
    `with confirmed_mapping as (
       select mapping.warehouse_external_id
       from odoo_location_warehouse_mappings mapping
       where mapping.company_id = $1 and mapping.location_id = $2
     ), configured_warehouse as (
       select warehouse.stock_location_external_id as external_id
       from confirmed_mapping mapping
       join odoo_warehouses warehouse
         on warehouse.company_id = $1
        and warehouse.external_id = mapping.warehouse_external_id
       where warehouse.active = true
         and btrim(warehouse.stock_location_external_id) <> ''
     )
     select external_id from configured_warehouse
     union all
     select location.external_id
     from odoo_inventory_locations location
     where location.company_id = $1 and location.app_location_id = $2
       and location.mapping_status = 'mapped' and location.active = true
       and not exists (select 1 from confirmed_mapping)
     order by external_id`,
    [companyId, locationId],
  );
  return result.rows.map((row) => String(row.external_id));
}

async function receiptRow(client, { receiptId, companyIds, locationIds = [], isAdmin = false }) {
  const result = await client.query(
    `select receipt.*, location.name as location_name
     from inventory_receipts receipt
     join locations location on location.company_id = receipt.company_id and location.id = receipt.location_id
     where receipt.id = $1 and receipt.company_id = any($2::uuid[])
       and ($4::boolean or receipt.location_id = any($3::uuid[]))
     limit 1`,
    [receiptId, companyIds, locationIds, isAdmin],
  );
  return result.rows[0] || null;
}

async function publicReceipt(client, row) {
  if (!row) return null;
  const [lines, units] = await Promise.all([
    client.query(
      `select id, line_index, catalog_part_id, product_external_id, part_number,
              description, quantity, uom_code, tracking_mode
       from inventory_receipt_lines
       where company_id = $1 and receipt_id = $2
       order by line_index, id`,
      [row.company_id, row.id],
    ),
    client.query(
      `select unit.id, unit.receipt_line_id, unit.unit_ordinal, unit.serial_number,
              unit.provider_lot_external_id, unit.status, unit.created_at, unit.updated_at,
              line.line_index, line.part_number, line.description
       from inventory_serialized_units unit
       join inventory_receipt_lines line
         on line.company_id = unit.company_id and line.id = unit.receipt_line_id
       where unit.company_id = $1 and unit.receipt_id = $2
       order by line.line_index, unit.unit_ordinal, unit.id`,
      [row.company_id, row.id],
    ),
  ]);
  return {
    id: row.id,
    invoiceRunId: row.invoice_run_id,
    locationId: row.location_id,
    locationName: row.location_name,
    status: row.status,
    version: Number(row.version),
    provider: row.provider,
    providerPickingExternalId: row.provider_picking_external_id || null,
    providerPickingName: row.provider_picking_name || "",
    errorCode: row.error_code || null,
    createdAt: row.created_at,
    confirmedAt: row.confirmed_at || null,
    lines: lines.rows.map((line) => ({
      id: line.id,
      lineIndex: line.line_index,
      catalogPartId: line.catalog_part_id,
      productExternalId: line.product_external_id,
      partNumber: line.part_number,
      description: line.description,
      quantity: line.quantity,
      uomCode: line.uom_code,
      trackingMode: line.tracking_mode,
    })),
    units: units.rows.map((unit) => ({
      id: unit.id,
      receiptLineId: unit.receipt_line_id,
      lineIndex: unit.line_index,
      ordinal: unit.unit_ordinal,
      serialNumber: unit.serial_number,
      providerLotExternalId: unit.provider_lot_external_id || null,
      status: unit.status,
      partNumber: unit.part_number,
      description: unit.description,
      createdAt: unit.created_at,
      updatedAt: unit.updated_at,
    })),
  };
}

export async function stageInventoryReceipt({
  receiptId,
  companyId,
  locationId,
  invoiceRunId,
  actorId,
  idempotencyKey,
  marker,
  lines,
  units,
  requestHash,
  providerRoute,
}) {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [`inventory-receipt:${companyId}:${invoiceRunId}`]);
    const existing = await client.query(
      `select receipt.id, receipt.idempotency_key, command.request_hash,
              command.picking_type_external_id, command.source_location_external_id,
              command.destination_location_external_id
       from inventory_receipts receipt
       join inventory_provider_commands command
         on command.company_id = receipt.company_id and command.receipt_id = receipt.id and command.action = 'receive'
       where receipt.company_id = $1 and receipt.invoice_run_id = $2
       for update of receipt, command`,
      [companyId, invoiceRunId],
    );
    if (existing.rows[0]) {
      if (existing.rows[0].idempotency_key !== idempotencyKey || existing.rows[0].request_hash !== requestHash) {
        await client.query("commit");
        return { receipt: null, inserted: false, conflict: true };
      }
      const row = await receiptRow(client, { receiptId: existing.rows[0].id, companyIds: [companyId], isAdmin: true });
      await client.query("commit");
      return {
        receipt: await publicReceipt(client, row),
        inserted: false,
        providerRoute: {
          pickingTypeId: Number(existing.rows[0].picking_type_external_id),
          sourceLocationId: Number(existing.rows[0].source_location_external_id),
          destinationLocationId: Number(existing.rows[0].destination_location_external_id),
        },
      };
    }
    await client.query(
      `insert into inventory_receipts (
         id, company_id, location_id, invoice_run_id, created_by,
         idempotency_key, provider_marker
       ) values ($1, $2, $3, $4, $5, $6, $7)`,
      [receiptId, companyId, locationId, invoiceRunId, actorId, idempotencyKey, marker],
    );
    await client.query(
      `insert into inventory_receipt_lines (
         id, company_id, receipt_id, line_index, catalog_part_id,
         product_external_id, part_number, description, quantity, uom_code, tracking_mode
       )
       select input.id, $1, $2, input.line_index, input.catalog_part_id,
              input.product_external_id, input.part_number, input.description,
              input.quantity, input.uom_code, 'serial'
       from unnest(
         $3::uuid[], $4::integer[], $5::uuid[], $6::text[], $7::text[],
         $8::text[], $9::integer[], $10::text[]
       ) as input(id, line_index, catalog_part_id, product_external_id, part_number, description, quantity, uom_code)`,
      [companyId, receiptId, lines.map((line) => line.id), lines.map((line) => line.lineIndex),
        lines.map((line) => line.catalogPartId), lines.map((line) => line.productExternalId),
        lines.map((line) => line.partNumber), lines.map((line) => line.description),
        lines.map((line) => line.quantity), lines.map((line) => line.uomCode)],
    );
    await client.query(
      `insert into inventory_serialized_units (
         id, company_id, location_id, receipt_id, receipt_line_id, unit_ordinal, serial_number
       )
       select input.id, $1, $2, $3, input.receipt_line_id, input.unit_ordinal, input.serial_number
       from unnest($4::uuid[], $5::uuid[], $6::integer[], $7::text[])
         as input(id, receipt_line_id, unit_ordinal, serial_number)`,
      [companyId, locationId, receiptId, units.map((unit) => unit.id), units.map((unit) => unit.receiptLineId),
        units.map((unit) => unit.ordinal), units.map((unit) => unit.serialNumber)],
    );
    await client.query(
      `insert into inventory_unit_events (company_id, unit_id, event_type, actor_id)
       select $1, input.unit_id, 'receipt_staged', $3
       from unnest($2::uuid[]) as input(unit_id)`,
      [companyId, units.map((unit) => unit.id), actorId],
    );
    await client.query(
      `insert into inventory_provider_commands (
         company_id, receipt_id, action, request_hash, picking_type_external_id,
         source_location_external_id, destination_location_external_id
       ) values ($1, $2, 'receive', $3, $4, $5, $6)`,
      [companyId, receiptId, requestHash, providerRoute.pickingTypeId,
        providerRoute.sourceLocationId, providerRoute.destinationLocationId],
    );
    const row = await receiptRow(client, { receiptId, companyIds: [companyId], isAdmin: true });
    await client.query("commit");
    return { receipt: await publicReceipt(client, row), inserted: true, providerRoute };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function claimInventoryReceiptCommand({ receiptId, companyId }) {
  const result = await query(
    `with claimed as (
       update inventory_provider_commands command
       set status = 'processing', attempts = attempts + 1, started_at = now(), updated_at = now()
       where command.company_id = $1 and command.receipt_id = $2 and command.action = 'receive'
         and command.status in ('pending', 'reconciliation_required')
       returning command.id
     )
     update inventory_receipts receipt
     set status = 'processing', error_code = null, updated_at = now()
     from claimed
     where receipt.company_id = $1 and receipt.id = $2
     returning receipt.id`,
    [companyId, receiptId],
  );
  return Boolean(result.rows[0]);
}

export async function confirmInventoryReceipt({ receiptId, companyId, actorId, providerResult }) {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const receipt = await client.query(
      `update inventory_receipts
       set status = 'confirmed', provider_picking_external_id = $3,
           provider_picking_name = $4, confirmed_at = coalesce(confirmed_at, now()),
           error_code = null, version = version + 1, updated_at = now()
       where company_id = $1 and id = $2
       returning *`,
      [companyId, receiptId, providerResult.pickingExternalId, providerResult.pickingName],
    );
    const lotBySerial = new Map(providerResult.lots.map((lot) => [lot.serialNumber, lot.externalId]));
    const units = await client.query(
      `select id, serial_number from inventory_serialized_units
       where company_id = $1 and receipt_id = $2 for update`,
      [companyId, receiptId],
    );
    for (const unit of units.rows) {
      const lotExternalId = lotBySerial.get(unit.serial_number);
      if (!lotExternalId) throw new Error(`Odoo serial ${unit.serial_number} was not returned.`);
      const updated = await client.query(
        `update inventory_serialized_units
         set status = 'in_stock', provider_lot_external_id = $3, updated_at = now()
         where company_id = $1 and id = $2 and status in ('pending', 'in_stock')
         returning id`,
        [companyId, unit.id, lotExternalId],
      );
      if (!updated.rows[0]) throw new Error(`Inventory unit ${unit.id} is no longer receivable.`);
      await client.query(
        `insert into inventory_unit_events (
           company_id, unit_id, event_type, actor_id, provider_reference
         ) select $1, $2, 'receipt_confirmed', $3, $4
           where not exists (
             select 1 from inventory_unit_events
             where company_id = $1 and unit_id = $2 and event_type = 'receipt_confirmed'
           )`,
        [companyId, unit.id, actorId, providerResult.pickingName],
      );
    }
    await client.query(
      `update inventory_provider_commands
       set status = 'succeeded', provider_response = $3, last_error_code = null,
           completed_at = now(), updated_at = now()
       where company_id = $1 and receipt_id = $2 and action = 'receive'`,
      [companyId, receiptId, JSON.stringify({
        pickingExternalId: providerResult.pickingExternalId,
        pickingName: providerResult.pickingName,
        state: providerResult.state,
        serialCount: providerResult.lots.length,
      })],
    );
    const row = await receiptRow(client, { receiptId, companyIds: [companyId], isAdmin: true });
    await client.query("commit");
    return publicReceipt(client, row || receipt.rows[0]);
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function markInventoryReceiptReconciliation({ receiptId, companyId, actorId, errorCode }) {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    await client.query(
      `update inventory_receipts
       set status = 'reconciliation_required', error_code = $3, version = version + 1, updated_at = now()
       where company_id = $1 and id = $2`,
      [companyId, receiptId, errorCode],
    );
    await client.query(
      `update inventory_provider_commands
       set status = 'reconciliation_required', last_error_code = $3, completed_at = now(), updated_at = now()
       where company_id = $1 and receipt_id = $2 and action = 'receive'`,
      [companyId, receiptId, errorCode],
    );
    await client.query(
      `insert into inventory_unit_events (company_id, unit_id, event_type, actor_id, details)
       select $1, unit.id, 'reconciliation_required', $3, jsonb_build_object('errorCode', $4::text)
       from inventory_serialized_units unit
       where unit.company_id = $1 and unit.receipt_id = $2`,
      [companyId, receiptId, actorId, errorCode],
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function getInventoryReceipt({ receiptId, companyIds, locationIds = [], isAdmin = false }) {
  const row = await receiptRow({ query }, { receiptId, companyIds, locationIds, isAdmin });
  return publicReceipt({ query }, row);
}

export async function getSerializedInventoryUnit({ unitId, companyIds, locationIds = [], isAdmin = false }) {
  const unit = await query(
    `select unit.id, unit.company_id, unit.location_id, unit.serial_number,
            unit.receipt_line_id, unit.unit_ordinal, unit.provider_lot_external_id,
            unit.status, unit.created_at, unit.updated_at,
            line.line_index, line.catalog_part_id, line.part_number, line.description, line.uom_code,
            receipt.id as receipt_id, receipt.invoice_run_id, receipt.count_import_id,
            receipt.serialization_batch_id, receipt.created_by,
            receipt.status as receipt_status, receipt.provider, receipt.provider_picking_name,
            receipt.confirmed_at, location.name as location_name,
            creator.display_name as created_by_name,
            label_batch.id as label_batch_id, label_batch.status as label_batch_status,
            label_batch.item_count as label_batch_item_count,
            label_batch.created_at as label_batch_created_at
     from inventory_serialized_units unit
     join inventory_receipt_lines line
       on line.company_id = unit.company_id and line.id = unit.receipt_line_id
     join inventory_receipts receipt
       on receipt.company_id = unit.company_id and receipt.id = unit.receipt_id
     join locations location on location.company_id = unit.company_id and location.id = unit.location_id
     left join user_profiles creator on creator.id = receipt.created_by
     left join inventory_label_batches label_batch
       on label_batch.company_id = receipt.company_id and label_batch.receipt_id = receipt.id
     where unit.id = $1 and unit.company_id = any($2::uuid[])
       and ($4::boolean or unit.location_id = any($3::uuid[]))
     limit 1`,
    [unitId, companyIds, locationIds, isAdmin],
  );
  const row = unit.rows[0];
  if (!row) return null;
  const events = await query(
    `select event.id, event.event_type, event.actor_id, actor.display_name as actor_name,
            event.provider_reference, event.details, event.usage_id, event.workorder_id,
            event.asset_id, workorder.serial as workorder_serial,
            asset.unit_no as asset_unit_no, asset.name as asset_name, event.created_at
     from inventory_unit_events event
     left join user_profiles actor on actor.id = event.actor_id
     left join operational_workorders workorder
       on workorder.company_id = event.company_id and workorder.id = event.workorder_id
     left join assets asset
       on asset.company_id = event.company_id and asset.id = event.asset_id
     where event.company_id = $1 and event.unit_id = $2
     order by event.created_at, event.id`,
    [row.company_id, row.id],
  );
  const source = row.serialization_batch_id ? { type: "manual", id: row.serialization_batch_id }
    : row.count_import_id ? { type: "stock_count", id: row.count_import_id }
      : row.invoice_run_id ? { type: "invoice", id: row.invoice_run_id }
        : { type: "receipt", id: row.receipt_id };
  return {
    id: row.id,
    serialNumber: row.serial_number,
    status: row.status,
    ordinal: Number(row.unit_ordinal),
    receiptLineId: row.receipt_line_id,
    catalogPartId: row.catalog_part_id,
    lineIndex: Number(row.line_index),
    providerLotExternalId: row.provider_lot_external_id || null,
    partNumber: row.part_number,
    description: row.description,
    uomCode: row.uom_code,
    locationId: row.location_id,
    locationName: row.location_name,
    source,
    createdBy: row.created_by ? { id: row.created_by, name: row.created_by_name || "" } : null,
    receipt: {
      id: row.receipt_id,
      status: row.receipt_status,
      provider: row.provider,
      reference: row.provider_picking_name || "",
      confirmedAt: row.confirmed_at || null,
    },
    labelBatch: row.label_batch_id ? {
      id: row.label_batch_id,
      status: row.label_batch_status,
      itemCount: Number(row.label_batch_item_count),
      createdAt: row.label_batch_created_at,
      printUrl: `/api/office/inventory/label-batches/${encodeURIComponent(row.label_batch_id)}/print`,
    } : null,
    events: events.rows.map((event) => ({
      id: event.id,
      type: event.event_type,
      actor: event.actor_id ? { id: event.actor_id, name: event.actor_name || "" } : null,
      providerReference: event.provider_reference || "",
      details: event.details || {},
      usageId: event.usage_id || null,
      workorderId: event.workorder_id || null,
      workorderSerial: event.workorder_serial || "",
      assetId: event.asset_id || null,
      asset: event.asset_id ? {
        id: event.asset_id,
        unitNo: event.asset_unit_no || "",
        name: event.asset_name || "",
      } : null,
      at: event.created_at,
    })),
    qrSvgUrl: `/api/office/inventory/units/${encodeURIComponent(row.id)}/qr.svg`,
    printUrl: `/api/office/inventory/units/${encodeURIComponent(row.id)}/label`,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
