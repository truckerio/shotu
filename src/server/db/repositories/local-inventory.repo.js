import { randomUUID } from "node:crypto";
import { getPool, query } from "../pool.js";
import { createReceiptLabelBatch, loadReceiptLabelBatch } from "./inventory-labels.repo.js";
import { assertPrimaryPartIdentityAvailable } from "./parts-catalog-edit.repo.js";
import { normalizePartNumber } from "../../modules/parts/part.constants.js";

function publicReceipt(row, lines = [], units = [], labelBatch = null) {
  if (!row) return null;
  return {
    id: row.id,
    invoiceRunId: row.invoice_run_id,
    locationId: row.location_id,
    locationName: row.location_name || "",
    status: row.status,
    lineCount: Number(row.line_count),
    totalQuantity: Number(row.total_quantity),
    postedAt: row.posted_at,
    reversedAt: row.reversed_at || null,
    physicalConfirmation: row.physical_confirmation,
    reviewedRunVersion: Number(row.reviewed_run_version),
    lines: lines.map((line) => ({
      id: line.id,
      lineIndex: Number(line.line_index),
      catalogPartId: line.catalog_part_id,
      partNumber: line.part_number,
      description: line.description,
      quantity: Number(line.quantity),
      uomCode: line.uom_code,
      unitCost: line.unit_cost === null ? null : Number(line.unit_cost),
      lineTotal: line.line_total === null ? null : Number(line.line_total),
    })),
    units: units.map((unit) => ({
      id: unit.id,
      receiptLineId: unit.receipt_line_id,
      lineIndex: Number(unit.line_index),
      ordinal: Number(unit.unit_ordinal),
      serialNumber: unit.serial_number,
      status: unit.status,
      partNumber: unit.part_number,
      description: unit.description,
      createdAt: unit.created_at,
      updatedAt: unit.updated_at,
    })),
    labelBatch,
  };
}

async function loadReceipt(client, companyId, receiptId) {
  const receipt = await client.query(
    `select receipt.*, location.name as location_name
     from local_inventory_receipts receipt
     join locations location on location.company_id = receipt.company_id and location.id = receipt.location_id
     where receipt.company_id = $1 and receipt.id = $2
     limit 1`,
    [companyId, receiptId],
  );
  const lines = await client.query(
    `select * from local_inventory_receipt_lines
     where company_id = $1 and receipt_id = $2
     order by line_index, id`,
    [companyId, receiptId],
  );
  const units = await client.query(
    `select unit.id, unit.receipt_line_id, unit.unit_ordinal, unit.serial_number,
            unit.status, unit.created_at, unit.updated_at,
            line.line_index, line.part_number, line.description
     from inventory_serialized_units unit
     join inventory_receipt_lines line
       on line.company_id = unit.company_id and line.id = unit.receipt_line_id
     where unit.company_id = $1 and unit.receipt_id = $2
     order by line.line_index, unit.unit_ordinal, unit.id`,
    [companyId, receiptId],
  );
  const labelBatch = await loadReceiptLabelBatch(client, { companyId, receiptId });
  return publicReceipt(receipt.rows[0], lines.rows, units.rows, labelBatch);
}

export async function postLocalInventoryReceipt({
  receiptId,
  runId,
  actorId,
  companyIds,
  locationIds = [],
  isAdmin = false,
  idempotencyKey,
  requestHash,
  reviewedRunVersion,
  physicalConfirmation,
  confirmationHash,
  labelBatchId,
  lines,
  createLabelBatch = createReceiptLabelBatch,
}) {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const selected = await client.query(
      `select run.id, run.company_id, run.location_id, run.status, run.version,
              run.reviewed_draft, location.name as location_name
       from invoice_extraction_runs run
       join locations location on location.company_id = run.company_id and location.id = run.location_id
       where run.id = $1 and run.company_id = any($2::uuid[])
         and ($4::boolean or run.location_id = any($3::uuid[]))
       limit 1 for update`,
      [runId, companyIds, locationIds, isAdmin],
    );
    const source = selected.rows[0] || null;
    if (!source) {
      await client.query("rollback");
      return { kind: "not_found" };
    }
    if (source.status !== "reviewed" || !source.reviewed_draft) {
      await client.query("rollback");
      return { kind: "review_required" };
    }
    if (Number(source.version) !== Number(reviewedRunVersion)) {
      await client.query("rollback");
      return { kind: "stale" };
    }
    await client.query(
      "select pg_advisory_xact_lock(hashtext($1))",
      [`local-inventory-receipt:${source.company_id}:${runId}`],
    );
    const existing = await client.query(
      `select id, idempotency_key, request_hash
       from local_inventory_receipts
       where company_id = $1 and invoice_run_id = $2
       limit 1`,
      [source.company_id, runId],
    );
    if (existing.rows[0]) {
      const sameRequest = existing.rows[0].idempotency_key === idempotencyKey
        && existing.rows[0].request_hash === requestHash;
      const receipt = sameRequest
        ? await loadReceipt(client, source.company_id, existing.rows[0].id)
        : null;
      await client.query("commit");
      return sameRequest ? { kind: "replay", receipt } : { kind: "conflict" };
    }
    const providerReceipt = await client.query(
      `select id from inventory_receipts
       where company_id = $1 and invoice_run_id = $2
       limit 1`,
      [source.company_id, runId],
    );
    if (providerReceipt.rows[0]) {
      await client.query("rollback");
      return { kind: "conflict" };
    }

    const preparedLines = [];
    for (const line of lines) {
      await assertPrimaryPartIdentityAvailable(client, source.company_id, line.normalizedPartNumber);
      const catalog = await client.query(
        `insert into parts_catalog (
           company_id, normalized_part_number, part_number, description, uom_code, updated_at
         ) values ($1, $2, $3, $4, $5, now())
         on conflict (company_id, normalized_part_number) do update
         set part_number = case when btrim(parts_catalog.part_number) = '' then excluded.part_number else parts_catalog.part_number end,
             description = case when btrim(parts_catalog.description) = '' then excluded.description else parts_catalog.description end,
             version = parts_catalog.version + case when
               row(parts_catalog.part_number, parts_catalog.description)
               is distinct from row(
                 case when btrim(parts_catalog.part_number) = '' then excluded.part_number else parts_catalog.part_number end,
                 case when btrim(parts_catalog.description) = '' then excluded.description else parts_catalog.description end
               ) then 1 else 0 end,
             updated_at = now()
         returning id`,
        [source.company_id, line.normalizedPartNumber, line.partNumber, line.description, line.uomCode],
      );
      const catalogPartId = catalog.rows[0].id;
      const existingBalance = await client.query(
        `select id, catalog_part_id, source_provider, external_id,
                quantity_on_hand, quantity_reserved,
                provider_updated_at, last_seen_at
         from inventory_items
         where company_id = $1 and location_id = $2
           and normalized_part_number = $3 and uom_code = $4
         limit 1 for update`,
        [source.company_id, source.location_id, line.normalizedPartNumber, line.uomCode],
      );
      if (existingBalance.rows[0]
        && existingBalance.rows[0].source_provider !== "local"
        && Number(existingBalance.rows[0].quantity_reserved) > 0) {
        await client.query("rollback");
        return { kind: "authority_conflict" };
      }
      const previousBalance = existingBalance.rows[0] || null;
      preparedLines.push({
        ...line,
        catalogPartId,
        authorityCutover: previousBalance && previousBalance.source_provider !== "local"
          ? {
            inventoryItemId: previousBalance.id,
            previousSourceProvider: previousBalance.source_provider,
            previousExternalId: previousBalance.external_id,
            previousQuantityOnHand: previousBalance.quantity_on_hand,
            previousQuantityReserved: previousBalance.quantity_reserved,
            previousProviderUpdatedAt: previousBalance.provider_updated_at,
            previousLastSeenAt: previousBalance.last_seen_at,
          }
          : null,
      });
    }

    const totalQuantity = preparedLines.reduce((total, line) => total + line.quantity, 0);
    await client.query(
      `insert into local_inventory_receipts (
         id, company_id, location_id, invoice_run_id, created_by,
         idempotency_key, request_hash, line_count, total_quantity,
         reviewed_run_version, physical_confirmation, confirmation_hash
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [receiptId, source.company_id, source.location_id, runId, actorId,
        idempotencyKey, requestHash, preparedLines.length, totalQuantity,
        reviewedRunVersion, physicalConfirmation, confirmationHash],
    );
    await client.query(
      `insert into inventory_receipts (
         id, company_id, location_id, invoice_run_id, created_by,
         idempotency_key, provider, provider_marker, provider_picking_name,
         status, confirmed_at
       ) values ($1, $2, $3, $4, $5, $6, 'local', $7, 'Local receipt', 'confirmed', now())`,
      [receiptId, source.company_id, source.location_id, runId, actorId,
        idempotencyKey, `LOCAL-REC-${receiptId}`],
    );

    for (const line of preparedLines) {
      const catalogPartId = line.catalogPartId;
      await client.query(
        `insert into local_inventory_receipt_lines (
           id, company_id, receipt_id, line_index, catalog_part_id,
           normalized_part_number, part_number, description, quantity,
           uom_code, unit_cost, line_total
         ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [line.id, source.company_id, receiptId, line.lineIndex, catalogPartId,
          line.normalizedPartNumber, line.partNumber, line.description, line.quantity,
          line.uomCode, line.unitCost, line.lineTotal],
      );
      await client.query(
        `insert into inventory_receipt_lines (
           id, company_id, receipt_id, line_index, catalog_part_id,
           product_external_id, part_number, description, quantity, uom_code, tracking_mode
         ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [line.id, source.company_id, receiptId, line.lineIndex, catalogPartId,
          `local:${catalogPartId}`, line.partNumber, line.description,
          line.quantity, line.uomCode, line.serializedUnits?.length ? "serial" : "aggregate"],
      );
      if (line.authorityCutover) {
        await client.query(
          `insert into inventory_authority_cutovers (
             company_id, location_id, catalog_part_id, inventory_item_id,
             receipt_id, receipt_line_id, previous_source_provider,
             previous_external_id, previous_quantity_on_hand,
             previous_quantity_reserved, previous_provider_updated_at,
             previous_last_seen_at
           ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [source.company_id, source.location_id, catalogPartId,
            line.authorityCutover.inventoryItemId, receiptId, line.id,
            line.authorityCutover.previousSourceProvider,
            line.authorityCutover.previousExternalId,
            line.authorityCutover.previousQuantityOnHand,
            line.authorityCutover.previousQuantityReserved,
            line.authorityCutover.previousProviderUpdatedAt,
            line.authorityCutover.previousLastSeenAt],
        );
      }
      await client.query(
        `insert into inventory_stock_movements (
           company_id, location_id, catalog_part_id, receipt_id, receipt_line_id,
           movement_type, quantity_delta, uom_code, actor_id, reason, idempotency_key
         ) values ($1, $2, $3, $4, $5, 'invoice_receipt', $6, $7, $8, $9, $10)`,
        [source.company_id, source.location_id, catalogPartId, receiptId, line.id,
          line.quantity, line.uomCode, actorId, `Invoice ${runId}`,
          `invoice-receipt:${receiptId}:line:${line.lineIndex}`],
      );
      if (line.serializedUnits?.length) {
        await client.query(
          `insert into inventory_serialized_units (
             id, company_id, location_id, receipt_id, receipt_line_id,
             unit_ordinal, serial_number, status
           )
           select input.id, $1, $2, $3, $4, input.ordinal, input.serial_number, 'in_stock'
           from unnest($5::uuid[], $6::integer[], $7::text[])
             as input(id, ordinal, serial_number)`,
          [source.company_id, source.location_id, receiptId, line.id,
            line.serializedUnits.map((unit) => unit.id),
            line.serializedUnits.map((unit) => unit.ordinal),
            line.serializedUnits.map((unit) => unit.serialNumber)],
        );
        await client.query(
          `insert into inventory_unit_events (company_id, unit_id, event_type, actor_id, details)
           select $1, input.id, 'receipt_recorded', $2, jsonb_build_object('source', 'local_invoice')
           from unnest($3::uuid[]) as input(id)`,
          [source.company_id, actorId, line.serializedUnits.map((unit) => unit.id)],
        );
      }
      const balance = await client.query(
        `insert into inventory_items (
           company_id, location_id, catalog_part_id, normalized_part_number, part_number,
           description, quantity_on_hand, quantity_reserved, uom_code,
           source_provider, external_id, last_seen_at, updated_at
         ) values ($1, $2, $3, $4, $5, $6, $7, 0, $8, 'local', $9, now(), now())
         on conflict (
           company_id,
           (coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid)),
           normalized_part_number,
           uom_code
         ) do update set
           catalog_part_id = excluded.catalog_part_id,
           part_number = excluded.part_number,
           description = excluded.description,
           quantity_on_hand = case
             when inventory_items.source_provider = 'local'
               then inventory_items.quantity_on_hand + excluded.quantity_on_hand
             else excluded.quantity_on_hand
           end,
           quantity_reserved = case
             when inventory_items.source_provider = 'local'
               then inventory_items.quantity_reserved
             else 0
           end,
           source_provider = 'local',
           external_id = excluded.external_id,
           provider_updated_at = null,
           last_seen_at = now(),
           updated_at = now()
         where inventory_items.source_provider = 'local'
            or inventory_items.quantity_reserved = 0
         returning id`,
        [source.company_id, source.location_id, catalogPartId, line.normalizedPartNumber,
          line.partNumber, line.description, line.quantity, line.uomCode,
          `local:${catalogPartId}:${source.location_id}:${line.uomCode}`],
      );
      if (!balance.rows[0]) {
        const error = new Error("Inventory authority changed during receipt confirmation.");
        error.code = "INVENTORY_AUTHORITY_CONFLICT";
        throw error;
      }
    }
    const serializedItems = preparedLines.flatMap((line) => (line.serializedUnits || []).map((unit) => ({
      id: randomUUID(),
      unitId: unit.id,
      ordinal: 0,
      partNumber: line.partNumber,
      description: line.description,
      serialNumber: unit.serialNumber,
      locationName: source.location_name,
    })));
    serializedItems.forEach((item, index) => { item.ordinal = index + 1; });
    if (serializedItems.length) {
      await createLabelBatch(client, {
        batchId: labelBatchId,
        companyId: source.company_id,
        locationId: source.location_id,
        receiptId,
        actorId,
        items: serializedItems,
      });
    }
    const receipt = await loadReceipt(client, source.company_id, receiptId);
    await client.query("commit");
    return { kind: "posted", receipt };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    if (error?.code === "INVENTORY_AUTHORITY_CONFLICT") return { kind: "authority_conflict" };
    if (error?.code === "23505" && [
      "local_inventory_receipts_company_id_created_by_idempotency__key",
      "inventory_receipts_company_id_invoice_run_id_key",
    ].includes(error?.constraint)) {
      return { kind: "conflict" };
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function listLocalInvoiceHistory({ companyIds, locationIds = [], isAdmin = false, queryText = "", status = "", limit = 50, offset = 0 }) {
  const search = `%${String(queryText || "").trim().toLocaleLowerCase("en-US").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
  const result = await query(
    `with filtered as (
     select run.id, run.location_id, location.name as location_name, run.file_name,
            run.status as extraction_status, run.created_at, run.reviewed_at,
            run.error_code, run.retryable,
            coalesce(run.reviewed_draft, run.extracted_draft) #>> '{vendorName,value}' as vendor_name,
            coalesce(run.reviewed_draft, run.extracted_draft) #>> '{invoiceNumber,value}' as invoice_number,
            coalesce(run.reviewed_draft, run.extracted_draft) #>> '{invoiceDate,value}' as invoice_date,
            coalesce(run.reviewed_draft, run.extracted_draft) #>> '{currency,value}' as currency,
            coalesce(run.reviewed_draft, run.extracted_draft) #>> '{total,value}' as invoice_total,
            receipt.id as receipt_id, receipt.status as receipt_status,
            receipt.line_count, receipt.total_quantity, receipt.posted_at,
            label_batch.id as label_batch_id, label_batch.status as label_batch_status,
            label_batch.item_count as label_batch_item_count,
            label_batch.created_at as label_batch_created_at,
            case
              when receipt.status = 'posted' then 'added'
              when receipt.status = 'reversed' then 'reversed'
              when run.status = 'reviewed' then 'reviewed'
              when run.status in ('completed', 'needs_review') then 'needs_review'
              else run.status
            end as inventory_status
     from invoice_extraction_runs run
     join locations location on location.company_id = run.company_id and location.id = run.location_id
     left join local_inventory_receipts receipt
       on receipt.company_id = run.company_id and receipt.invoice_run_id = run.id
     left join inventory_label_batches label_batch
       on label_batch.company_id = receipt.company_id and label_batch.receipt_id = receipt.id
     where run.company_id = any($1::uuid[])
       and ($3::boolean or run.location_id = any($2::uuid[]))
       and ($4 = '' or case
              when receipt.status = 'posted' then 'added'
              when receipt.status = 'reversed' then 'reversed'
              when run.status = 'reviewed' then 'reviewed'
              when run.status in ('completed', 'needs_review') then 'needs_review'
              else run.status
            end = $4)
       and ($5 = '%%' or lower(concat_ws(' ', run.file_name,
            coalesce(run.reviewed_draft, run.extracted_draft) #>> '{vendorName,value}',
            coalesce(run.reviewed_draft, run.extracted_draft) #>> '{invoiceNumber,value}')) like $5 escape '\\')
     ), paged as (
       select *
       from filtered
       order by created_at desc, id desc
       limit $6 offset $7
     )
     select (select count(*)::integer from filtered) as total_count,
            coalesce(
              json_agg(paged order by paged.created_at desc, paged.id desc)
                filter (where paged.id is not null),
              '[]'::json
            ) as items
     from paged`,
    [companyIds, locationIds, isAdmin, status, search, limit, offset],
  );
  const historyItems = result.rows[0]?.items || [];
  return {
    total: Number(result.rows[0]?.total_count || 0),
    items: historyItems.map((row) => ({
    id: row.id,
    locationId: row.location_id,
    locationName: row.location_name,
    fileName: row.file_name,
    vendorName: row.vendor_name || "",
    invoiceNumber: row.invoice_number || "",
    invoiceDate: row.invoice_date || "",
    currency: row.currency || "USD",
    total: row.invoice_total === null || row.invoice_total === "" ? null : Number(row.invoice_total),
    extractionStatus: row.extraction_status,
    inventoryStatus: row.inventory_status,
    errorCode: row.error_code || null,
    retryable: row.retryable === true,
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at || null,
    receipt: row.receipt_id ? {
      id: row.receipt_id,
      status: row.receipt_status,
      lineCount: Number(row.line_count),
      totalQuantity: Number(row.total_quantity),
      postedAt: row.posted_at,
      labelBatch: row.label_batch_id ? {
        id: row.label_batch_id,
        status: row.label_batch_status,
        itemCount: Number(row.label_batch_item_count),
        createdAt: row.label_batch_created_at,
        printUrl: `/api/office/inventory/label-batches/${encodeURIComponent(row.label_batch_id)}/print`,
      } : null,
    } : null,
    })),
  };
}

export async function listLocalInventoryStock({ companyIds, locationIds = [], isAdmin = false, locationId = null, scope = "all", availability = "all", sort = "available_desc", queryText = "", limit = 100, offset = 0 }) {
  const search = `%${String(queryText || "").trim().toLocaleLowerCase("en-US").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
  const normalizedReferencePrefix = `${normalizePartNumber(queryText)}%`;
  const result = await query(
    `with local_balances as (
       select item.company_id, item.catalog_part_id, item.location_id, location.name as location_name,
              item.quantity_on_hand, item.quantity_reserved,
              greatest(item.quantity_on_hand - item.quantity_reserved, 0) as quantity_available,
              item.updated_at
       from inventory_items item
       join locations location on location.company_id = item.company_id and location.id = item.location_id
       where item.company_id = any($1::uuid[])
         and item.source_provider = 'local'
         and ($3::boolean or item.location_id = any($2::uuid[]))
         and ($4::uuid is null or item.location_id = $4)
     ), odoo_balances as (
       select balance.company_id, balance.catalog_part_id, balance.location_id,
              location.name as location_name, balance.quantity_on_hand,
              balance.updated_at
       from odoo_inventory_balances balance
       join locations location
         on location.company_id = balance.company_id and location.id = balance.location_id
       where balance.company_id = any($1::uuid[])
         and ($3::boolean or balance.location_id = any($2::uuid[]))
         and ($4::uuid is null or balance.location_id = $4)
     ), balances as (
       select coalesce(local.company_id, odoo.company_id) as company_id,
              coalesce(local.catalog_part_id, odoo.catalog_part_id) as catalog_part_id,
              coalesce(local.location_id, odoo.location_id) as location_id,
              coalesce(local.location_name, odoo.location_name) as location_name,
              coalesce(local.quantity_on_hand, 0) as quantity_on_hand,
              coalesce(local.quantity_reserved, 0) as quantity_reserved,
              coalesce(local.quantity_available, 0) as quantity_available,
              coalesce(odoo.quantity_on_hand, 0) as odoo_quantity_on_hand,
              greatest(local.updated_at, odoo.updated_at) as updated_at
       from local_balances local
       full outer join odoo_balances odoo
         on odoo.company_id = local.company_id
        and odoo.catalog_part_id = local.catalog_part_id
        and odoo.location_id = local.location_id
     ), stock as (
       select catalog.company_id, catalog.id as catalog_part_id, catalog.part_number,
              catalog.normalized_part_number, catalog.description, catalog.manufacturer, catalog.category,
              catalog.barcode, catalog.uom_code, catalog.version,
              coalesce((select jsonb_agg(reference.reference_number order by lower(reference.reference_number), reference.id)
                from part_reference_numbers reference where reference.company_id=catalog.company_id and reference.catalog_part_id=catalog.id), '[]'::jsonb) as reference_numbers,
              case when exists (
                select 1 from odoo_product_mappings provider
                where provider.company_id = catalog.company_id
                  and provider.catalog_part_id = catalog.id and provider.active = true
              ) then 'odoo' else catalog.source_provider end as source_provider,
              exists (select 1 from odoo_product_mappings ownership where ownership.company_id=catalog.company_id and ownership.catalog_part_id=catalog.id) as provider_managed,
              coalesce(sum(balance.quantity_on_hand), 0) as quantity_on_hand,
              coalesce(sum(balance.quantity_reserved), 0) as quantity_reserved,
              coalesce(sum(balance.quantity_available), 0) as quantity_available,
              coalesce(sum(balance.odoo_quantity_on_hand), 0) as odoo_quantity_on_hand,
              count(*) filter (
                where balance.quantity_on_hand > 0
                   or balance.odoo_quantity_on_hand > 0
              )::integer as location_count,
              coalesce(max(balance.updated_at), catalog.updated_at) as updated_at,
              coalesce(jsonb_agg(jsonb_build_object(
                'locationId', catalog_location.id,
                'locationName', catalog_location.name,
                'quantityOnHand', coalesce(balance.quantity_on_hand, 0),
                'quantityReserved', coalesce(balance.quantity_reserved, 0),
                'quantityAvailable', coalesce(balance.quantity_available, 0),
                'odooQuantityOnHand', coalesce(balance.odoo_quantity_on_hand, 0),
                'updatedAt', coalesce(balance.updated_at, catalog.updated_at)
              ) order by catalog_location.name, catalog_location.id), '[]'::jsonb) as locations
       from parts_catalog catalog
       join locations catalog_location
         on catalog_location.company_id = catalog.company_id and catalog_location.active = true
       left join balances balance
         on balance.company_id = catalog.company_id
        and balance.catalog_part_id = catalog.id
        and balance.location_id = catalog_location.id
       where catalog.company_id = any($1::uuid[])
         and ($3::boolean or catalog_location.id = any($2::uuid[]))
         and ($4::uuid is null or catalog_location.id = $4)
         and (($8 = 'master' and exists (
                select 1 from odoo_product_mappings master_provider
                where master_provider.company_id = catalog.company_id
                  and master_provider.catalog_part_id = catalog.id and master_provider.active = true
              )) or $8 <> 'master')
         and ($5 = '%%'
           or lower(concat_ws(' ', catalog.part_number, catalog.description, catalog.manufacturer, catalog.barcode)) like $5 escape '\\'
           or exists (select 1 from part_reference_numbers reference where reference.company_id=catalog.company_id and reference.catalog_part_id=catalog.id and lower(reference.reference_number) like $5 escape '\\')
           or exists (select 1 from part_reference_numbers reference where reference.company_id=catalog.company_id and reference.catalog_part_id=catalog.id and $11 <> '%' and reference.normalized_reference_number like $11)
           or exists (
             select 1 from odoo_product_mappings provider_search
             where provider_search.company_id = catalog.company_id
               and provider_search.catalog_part_id = catalog.id
               and lower(concat_ws(' ', provider_search.default_code, provider_search.barcode, provider_search.display_name)) like $5 escape '\\'
           ))
       group by catalog.company_id, catalog.id
     ), filtered as (
       select * from stock
       where $9 = 'all'
          or ($9 = 'available' and quantity_available > 0)
          or ($9 = 'reserved' and quantity_on_hand > 0 and quantity_available = 0)
          or ($9 = 'out' and quantity_on_hand = 0)
     )
     select filtered.*,
            count(*) over() as total_count,
            (select count(*) from stock) as all_count,
            (select count(*) from stock where quantity_available > 0) as available_count,
            (select count(*) from stock where quantity_on_hand > 0 and quantity_available = 0) as reserved_count,
            (select count(*) from stock where quantity_on_hand = 0) as out_count
     from filtered
     order by
       case when $10 = 'available_desc' then quantity_available end desc,
       case when $10 = 'reserved_desc' then quantity_reserved end desc,
       case when $10 = 'locations_desc' then location_count end desc,
       case when $10 in ('available_desc', 'reserved_desc', 'locations_desc') then quantity_available end desc,
       lower(part_number), catalog_part_id
     limit $6 offset $7`,
    [companyIds, locationIds, isAdmin, locationId, search, limit, offset, scope, availability, sort, normalizedReferencePrefix],
  );
  const items = result.rows.map((row) => ({
    companyId: row.company_id,
    catalogPartId: row.catalog_part_id,
    partNumber: row.part_number,
    description: row.description || "",
    manufacturer: row.manufacturer || "",
    category: row.category || "",
    barcode: row.barcode || "",
    version: Number(row.version || 1),
    referenceNumbers: row.reference_numbers || [],
    providerManaged: row.provider_managed === true,
    editableFields: row.provider_managed === true ? ["manufacturer", "referenceNumbers"] : ["description", "partNumber", "manufacturer", "category", "barcode", "referenceNumbers"],
    uomCode: row.uom_code,
    sourceProvider: row.source_provider || "",
    quantityOnHand: Number(row.quantity_on_hand),
    quantityReserved: Number(row.quantity_reserved),
    quantityAvailable: Number(row.quantity_available),
    odooQuantityOnHand: Number(row.odoo_quantity_on_hand),
    locationCount: Number(row.location_count || 0),
    updatedAt: row.updated_at,
    locations: row.locations || [],
  }));
  items.total = Number(result.rows[0]?.total_count || 0);
  items.counts = {
    all: Number(result.rows[0]?.all_count || 0),
    available: Number(result.rows[0]?.available_count || 0),
    reserved: Number(result.rows[0]?.reserved_count || 0),
    out: Number(result.rows[0]?.out_count || 0),
  };
  return items;
}
