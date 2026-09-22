import { randomUUID } from "node:crypto";
import { readApprovalPolicy, canApprovePurchase } from "./purchase-approval-settings.repo.js";
import { getPool, query } from "../pool.js";
import { createReceiptLabelBatch, loadReceiptLabelBatch } from "./inventory-labels.repo.js";
import { placeAggregateInventoryReceipt, placeSerializedInventoryReceipt } from "./inventory-positions.repo.js";
import { assertPrimaryPartIdentityAvailable } from "./parts-catalog-edit.repo.js";
import { normalizePartNumber } from "../../modules/parts/part.constants.js";
import {
  inspectInventoryAuthority,
  recordInventoryAuthorityCutover,
  recordInventoryAuthorityException,
} from "./inventory-authority.repo.js";

const normalizePurchaseNumber = (value) => String(value || "").normalize("NFKC").trim().toLocaleUpperCase("en-US").replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "");

export async function getCatalogTrackingModes({ companyIds, catalogPartIds }) {
  if (!catalogPartIds.length) return [];
  const result = await query("select id, tracking_mode from parts_catalog where company_id=any($1::uuid[]) and id=any($2::uuid[])", [companyIds, catalogPartIds]);
  return result.rows.map((row) => ({ catalogPartId: row.id, trackingMode: row.tracking_mode || null }));
}

export async function findDirectReceiptPart({ catalogPartId, companyIds }) {
  const result = await query(`select id,part_number,normalized_part_number,description,uom_code,tracking_mode,version
    from parts_catalog where id=$1 and company_id=any($2::uuid[])`, [catalogPartId, companyIds]);
  return result.rows[0] || null;
}

export async function findDirectReceiptPurchaseLine({purchaseLineId,companyIds,locationId}) {
  const result=await query(`select l.*,p.version from inventory_purchase_lines l join inventory_purchase_orders o on o.company_id=l.company_id and o.id=l.order_id left join parts_catalog p on p.id=l.catalog_part_id and p.company_id=l.company_id where l.id=$1 and l.company_id=any($2::uuid[]) and o.location_id=$3`,[purchaseLineId,companyIds,locationId]);
  const line=result.rows[0];
  return line?{...line,id:line.catalog_part_id,normalized_part_number:normalizePartNumber(line.part_number)}:null;
}

export async function listPartStockMovements({ catalogPartId, companyIds, locationIds, isAdmin, locationId = null, view = "audit", page = 1 }) {
  const result = await query(`select movement.id,movement.movement_type,movement.quantity_delta,movement.uom_code,
    movement.created_at,movement.receipt_id,movement.workorder_id,location.name as location_name,
    workorder.serial as workorder_serial,
    asset.unit_no as asset_unit_no,
    coalesce(aggregate_usage.repair_order,serialized_usage.repair_order,'') as repair_order
    from inventory_stock_movements movement
    join locations location on location.company_id=movement.company_id and location.id=movement.location_id
    left join operational_workorders workorder
      on workorder.company_id=movement.company_id and workorder.id=movement.workorder_id
    left join assets asset
      on asset.company_id=workorder.company_id and asset.id=workorder.asset_id
    left join workorder_aggregate_part_usages aggregate_usage
      on aggregate_usage.company_id=movement.company_id and aggregate_usage.id=movement.aggregate_usage_id
    left join workorder_serialized_part_usages serialized_usage
      on serialized_usage.company_id=movement.company_id and serialized_usage.id=movement.usage_id
    where movement.catalog_part_id=$1 and movement.company_id=any($2::uuid[])
      and ($4::boolean or movement.location_id=any($3::uuid[]))
      and ($5::uuid is null or movement.location_id=$5)
      and ($6::text='audit' or movement.workorder_id is not null)
    order by movement.created_at desc,movement.id desc limit 26 offset $7`,
  [catalogPartId, companyIds, locationIds, isAdmin, locationId, view, (page - 1) * 25]);
  return { page, hasMore: result.rows.length > 25, items: result.rows.slice(0, 25).map((row) => ({
    id: row.id, type: row.movement_type, quantity: Number(row.quantity_delta), uomCode: row.uom_code,
    occurredAt: row.created_at, receiptId: row.receipt_id, locationName: row.location_name,
    workorderId: row.workorder_id || null, workorderSerial: row.workorder_serial || "",
    assetUnitNo: row.asset_unit_no || "", repairOrder: row.repair_order || "",
  })) };
}

export async function findDirectReceiptOutcome({ companyIds, locationIds, isAdmin, actorId, idempotencyKey }) {
  const client = await getPool().connect();
  try {
    const result = await client.query(`select id,company_id,request_hash from local_inventory_receipts
      where company_id=any($1::uuid[]) and ($3::boolean or location_id=any($2::uuid[]))
        and created_by=$4 and idempotency_key=$5 and source_type='direct'`,
    [companyIds, locationIds, isAdmin, actorId, idempotencyKey]);
    if (!result.rows[0]) return null;
    return { receipt: await loadReceipt(client, result.rows[0].company_id, result.rows[0].id), requestHash: result.rows[0].request_hash };
  } finally { client.release(); }
}

function publicReceipt(row, lines = [], units = [], labelBatch = null) {
  if (!row) return null;
  return {
    id: row.id,
    invoiceRunId: row.invoice_run_id,
    sourceType: row.source_type || "invoice",
    sourceReference: row.source_reference || "",
    postingRoute: row.posting_route || (row.source_type === "direct" ? "no_purchase_order" : "no_purchase_order"),
    noPurchaseOrderReason: row.no_purchase_order_reason || "",
    locationId: row.location_id,
    locationName: row.location_name || "",
    status: row.status,
    lineCount: Number(row.line_count),
    totalQuantity: Number(row.total_quantity),
    postedAt: row.posted_at,
    reversedAt: row.reversed_at || null,
    physicalConfirmation: row.physical_confirmation,
    disposition: row.disposition || "accepted",
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
      currency: line.currency || null,
      trackingMode: line.catalog_tracking_mode || null,
      costSource: line.cost_source || "unknown",
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
    `select local_line.*,generic_line.catalog_tracking_mode,generic_line.currency,
            generic_line.unit_cost as batch_unit_cost,generic_line.line_total as batch_line_total,generic_line.cost_source
     from local_inventory_receipt_lines local_line
     join inventory_receipt_lines generic_line on generic_line.company_id=local_line.company_id and generic_line.id=local_line.id
     where local_line.company_id = $1 and local_line.receipt_id = $2
     order by local_line.line_index, local_line.id`,
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
  direct = null,
  postingRoute = null,
  noPurchaseOrderReason = "",
  allocationPlan = [],
  receiptOutcomes = [],
  approval = null,
}) {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const selected = direct ? await client.query(
      `select id as location_id, company_id, name as location_name from locations
       where id=$1 and company_id=any($2::uuid[]) and ($4::boolean or id=any($3::uuid[]))
       limit 1 for key share`,
      [direct.locationId, companyIds, locationIds, isAdmin],
    ) : await client.query(
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
    if (!direct && (source.status !== "reviewed" || !source.reviewed_draft)) {
      await client.query("rollback");
      return { kind: "review_required" };
    }
    if (!direct && Number(source.version) !== Number(reviewedRunVersion)) {
      await client.query("rollback");
      return { kind: "stale" };
    }
    await client.query(
      "select pg_advisory_xact_lock(hashtext($1))",
      [direct ? `direct-receipt:${source.company_id}:${actorId}:${idempotencyKey}` : `local-inventory-receipt:${source.company_id}:${runId}`],
    );
    const existing = await client.query(
       `select id, idempotency_key, request_hash
       from local_inventory_receipts
       where company_id = $1 and created_by=$2 and idempotency_key=$3
       limit 1`,
      [source.company_id, actorId, idempotencyKey],
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
    let approvalRequest = null;
    if (approval) {
      approvalRequest = (await client.query(`select * from inventory_direct_receipt_approval_requests
        where company_id=$1 and location_id=$2 and id=$3 limit 1 for update`,
      [source.company_id,source.location_id,approval.requestId])).rows[0];
      const policy = await readApprovalPolicy(client, source.company_id, true);
      if (!approvalRequest || approvalRequest.status !== 'pending'
        || Number(approvalRequest.version) !== Number(approval.expectedVersion)
        || approvalRequest.request_hash !== requestHash || approvalRequest.submitted_by !== actorId
        || !policy || !await canApprovePurchase(client, source.company_id, approval.approverActorId, policy)) {
        await client.query("rollback");
        return { kind: "approval_stale" };
      }
    } else if (direct && !direct.purchaseLineId && !direct.purchaseOrderId) {
      const policy = await readApprovalPolicy(client, source.company_id, true);
      if (policy && !await canApprovePurchase(client, source.company_id, actorId, policy)) {
        await client.query("rollback");
        return { kind: "approval_forbidden" };
      }
    }
    const requestedTargetIds = [...new Set(lines.filter((line) => Number(line.acceptedQuantity ?? line.quantity) > 0 && line.targetPositionId).map((line) => line.targetPositionId))];
    if (requestedTargetIds.length) {
      const targets = await client.query(`select id from inventory_positions where company_id=$1 and location_id=$2 and id=any($3::uuid[])
        and is_active and can_store and is_pickable and usage='storage' and system_key is null for update`, [source.company_id, source.location_id, requestedTargetIds]);
      if (targets.rowCount !== requestedTargetIds.length) { await client.query("rollback"); return { kind: "target_position_invalid" }; }
    }
    const providerReceipt = await client.query(
      `select id from inventory_receipts
       where company_id = $1 and invoice_run_id = $2 and provider = 'odoo'
       limit 1`,
      [source.company_id, runId],
    );
    if (providerReceipt.rows[0]) {
      await client.query("rollback");
      return { kind: "conflict" };
    }

    let purchaseRequest = null;
    if (direct?.purchaseRequestId) {
      const result=await client.query('select * from inventory_purchase_requests where company_id=$1 and location_id=$2 and id=$3 for update',[source.company_id,source.location_id,direct.purchaseRequestId]);
      purchaseRequest=result.rows[0];
      if(!purchaseRequest||!['approved','added'].includes(purchaseRequest.status)||purchaseRequest.receipt_id||purchaseRequest.version!==direct.expectedRequestVersion||lines.length!==1||
        (purchaseRequest.catalog_part_id&&purchaseRequest.catalog_part_id!==lines[0].catalogPartId)||purchaseRequest.uom_code!==lines[0].uomCode||Number(purchaseRequest.quantity)!==lines[0].quantity) {
        await client.query('rollback');return {kind:'request_conflict'};
      }
    }
    let purchaseLine = null;
    if (direct?.purchaseLineId) {
      const selectedPurchase = await client.query(`select line.*,po.status,po.location_id from inventory_purchase_lines line
        join inventory_purchase_orders po on po.company_id=line.company_id and po.id=line.order_id
        where line.company_id=$1 and line.id=$2 and po.location_id=$3 for update of po,line`,
      [source.company_id,direct.purchaseLineId,source.location_id]);
      purchaseLine=selectedPurchase.rows[0];
      if (!purchaseLine || !['ordered','partially_received'].includes(purchaseLine.status) || lines.length!==1 ||
        (lines[0].catalogPartId && purchaseLine.catalog_part_id!==lines[0].catalogPartId) || purchaseLine.uom_code!==lines[0].uomCode ||
        Number(purchaseLine.quantity)-Number(purchaseLine.received_quantity)-Number(purchaseLine.cancelled_quantity)<lines[0].quantity) {
        await client.query('rollback');return {kind:'purchase_conflict'};
      }
    }
    if(purchaseLine && !lines[0].catalogPartId) {
      const line=lines[0];
      if(purchaseLine.tracking_mode!==line.trackingMode){await client.query('rollback');return {kind:'catalog_changed'};}
      const normalized=normalizePartNumber(purchaseLine.part_number);
      await client.query('select pg_advisory_xact_lock(hashtext($1))',[`purchase-part:${source.company_id}:${normalized}`]);
      let part=(await client.query('select * from parts_catalog where company_id=$1 and normalized_part_number=$2 for update',[source.company_id,normalized])).rows[0];
      if(!part){
        await assertPrimaryPartIdentityAvailable(client,source.company_id,normalized);
        part=(await client.query(`insert into parts_catalog(company_id,part_number,normalized_part_number,description,uom_code,tracking_mode) values($1,$2,$3,$4,$5,$6) on conflict(company_id,normalized_part_number) do nothing returning *`,[source.company_id,purchaseLine.part_number,normalized,purchaseLine.description,purchaseLine.uom_code,line.trackingMode])).rows[0];
        if(!part)part=(await client.query('select * from parts_catalog where company_id=$1 and normalized_part_number=$2 for update',[source.company_id,normalized])).rows[0];
      }
      if(!part||part.uom_code!==line.uomCode||part.tracking_mode!==line.trackingMode||(purchaseLine.catalog_part_id&&purchaseLine.catalog_part_id!==part.id)){await client.query('rollback');return {kind:'catalog_changed'};}
      line.catalogPartId=part.id;line.expectedPartVersion=part.version;
      await client.query('update inventory_purchase_lines set catalog_part_id=$3 where company_id=$1 and id=$2',[source.company_id,purchaseLine.id,part.id]);
    }
    const preparedLines = [];
    for (const line of lines) {
      let catalogPartId;
      let effectiveLine = line;
      if (line.catalogPartId) {
        if (direct) await client.query("select id from parts_catalog where company_id=$1 and id=$2 for update", [source.company_id, line.catalogPartId]);
        const selectedCatalog = await client.query(
          `select id,normalized_part_number,part_number,description,uom_code,tracking_mode,version from parts_catalog
           where company_id=$1 and id=$2 limit 1 for key share`,
          [source.company_id, line.catalogPartId],
        );
        const selected = selectedCatalog.rows[0];
        if (!selected || selected.uom_code !== line.uomCode) {
          await client.query("rollback");
          return { kind: "catalog_changed" };
        }
        if (direct && (Number(selected.version) !== Number(line.expectedPartVersion) || selected.tracking_mode !== line.trackingMode)) {
          await client.query("rollback");
          return { kind: "catalog_changed" };
        }
        catalogPartId = selected.id;
        effectiveLine = { ...line, normalizedPartNumber: selected.normalized_part_number, partNumber: selected.part_number, description: line.description || selected.description };
      } else {
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
        catalogPartId = catalog.rows[0].id;
      }
      const authorityClaim = await inspectInventoryAuthority(client, {
        companyId: source.company_id,
        locationId: source.location_id,
        catalogPartId,
        normalizedPartNumber: effectiveLine.normalizedPartNumber,
        uomCode: effectiveLine.uomCode,
      });
      if (authorityClaim.kind !== "claimable") {
        await recordInventoryAuthorityException(client, {
          claim: authorityClaim,
          companyId: source.company_id,
          locationId: source.location_id,
          catalogPartId,
          normalizedPartNumber: effectiveLine.normalizedPartNumber,
          uomCode: effectiveLine.uomCode,
        });
        await client.query(direct?.purchaseLineId ? "rollback" : "commit");
        return { kind: authorityClaim.kind === "reservation_blocked" ? "authority_conflict" : "authority_unmatched" };
      }
      preparedLines.push({
        ...effectiveLine,
        catalogPartId,
        authorityClaim,
      });
    }

    if (!direct && receiptOutcomes.length) {
      const prior = await client.query(`select line.line_index,sum(coalesce(delivery_line.usable_quantity,line.quantity))::numeric as quantity
        from local_inventory_receipt_lines line
        join local_inventory_receipts receipt on receipt.company_id=line.company_id and receipt.id=line.receipt_id
        left join inventory_purchase_delivery_lines delivery_line on delivery_line.company_id=line.company_id and delivery_line.receipt_line_id=line.id
        where receipt.company_id=$1 and receipt.invoice_run_id=$2 and receipt.status='posted'
        group by line.line_index`, [source.company_id, runId]);
      const priorByIndex = new Map(prior.rows.map((row) => [Number(row.line_index), Number(row.quantity)]));
      for (const outcome of receiptOutcomes) {
        const invoiceLine = source.reviewed_draft?.lines?.[outcome.invoiceLineIndex];
        const invoiceQuantity = Number(invoiceLine?.quantity?.value);
        if (!Number.isFinite(invoiceQuantity)
          || (priorByIndex.get(outcome.invoiceLineIndex) || 0) + Number(outcome.usableQuantity) > invoiceQuantity) {
          await client.query("rollback");
          return { kind: "invoice_quantity_conflict" };
        }
      }
    }

    if (direct?.purchaseLineId && purchaseLine) {
      direct.purchaseOrderId = purchaseLine.order_id;
      receiptOutcomes = [{
        purchaseLineId: purchaseLine.id, receiptLineId: preparedLines[0].id, catalogPartId: preparedLines[0].catalogPartId,
        partNumber: preparedLines[0].partNumber, uomCode: preparedLines[0].uomCode,
        actualQuantity: preparedLines[0].quantity, usableQuantity: direct.disposition === 'held' ? 0 : preparedLines[0].quantity,
        heldQuantity: direct.disposition === 'held' ? preparedLines[0].quantity : 0, rejectedQuantity: 0, notReceivedQuantity: 0,
        outcome: direct.disposition === 'held' ? 'damaged' : 'accepted', notes: direct.damageDetails || '', holdLocation: direct.holdLocation || '',
      }];
    }
    if (!direct && postingRoute === "no_purchase_order") {
      receiptOutcomes = receiptOutcomes.map((outcome) => ({ ...outcome, purchaseLineId: null }));
    }
    const preparedByIndex = new Map(preparedLines.map((line) => [line.lineIndex, line]));
    const purchaseInvoiceAllocations = [];
    const purchaseLineById = new Map();
    const usesPurchaseOrder = (!direct && postingRoute === "purchase_order") || Boolean(direct?.purchaseOrderId);
    const purchaseLineIds = usesPurchaseOrder ? [...new Set([
      ...allocationPlan.map((allocation) => allocation.purchaseLineId),
      ...receiptOutcomes.map((outcome) => outcome.purchaseLineId).filter(Boolean),
    ])].sort() : [];
    if (((!direct && postingRoute === "purchase_order") || direct?.purchaseOrderId) && purchaseLineIds.length) {
      const selected = await client.query(`select l.*,o.status,o.version as order_version,o.location_id,o.number as order_number,s.name as supplier_name,
        coalesce(p.id,l.catalog_part_id) as effective_catalog_part_id,
        coalesce(p.uom_code,l.uom_code) as effective_uom_code,
        coalesce(p.tracking_mode,l.tracking_mode) as effective_tracking_mode
        from inventory_purchase_lines l join inventory_purchase_orders o on o.company_id=l.company_id and o.id=l.order_id
        join inventory_suppliers s on s.company_id=o.company_id and s.id=o.supplier_id
        left join parts_catalog p on p.company_id=l.company_id and p.id=l.catalog_part_id
        where l.company_id=$1 and l.id=any($2::uuid[]) and o.location_id=$3
        order by l.id for update of o,l`, [source.company_id, purchaseLineIds, source.location_id]);
      for (const row of selected.rows) purchaseLineById.set(row.id, row);
      if (purchaseLineById.size !== purchaseLineIds.length) { await client.query("rollback"); return { kind: "purchase_conflict" }; }
      if (direct?.purchaseOrderId) {
        const orders = [...new Set(selected.rows.map((row) => row.order_id))];
        const order = selected.rows[0];
        if (orders.length !== 1 || orders[0] !== direct.purchaseOrderId
          || (direct.expectedOrderVersion !== undefined && Number(order?.order_version) !== Number(direct.expectedOrderVersion))
          || !['ordered','partially_received'].includes(order?.status)) {
          await client.query("rollback"); return { kind: "purchase_conflict" };
        }
        for (const outcome of receiptOutcomes) {
          const purchase = purchaseLineById.get(outcome.purchaseLineId);
          const receiptLine = preparedLines.find((line) => line.id === outcome.receiptLineId);
          const outstanding = purchase ? Number(purchase.quantity)-Number(purchase.received_quantity)-Number(purchase.cancelled_quantity) : -1;
          if (!purchase || purchase.catalog_part_id !== outcome.catalogPartId || purchase.effective_uom_code !== outcome.uomCode
            || (receiptLine && purchase.effective_tracking_mode !== receiptLine.trackingMode)
            || Number(outcome.usableQuantity) > outstanding) {
            await client.query("rollback"); return { kind: "purchase_conflict" };
          }
        }
      }
    }
    if (!direct && allocationPlan.length) {
      const seen = new Set();
      const allocatedByInvoiceLine = new Map();
      for (const allocation of [...allocationPlan].sort((a, b) => a.purchaseLineId.localeCompare(b.purchaseLineId))) {
        const key = `${allocation.invoiceLineIndex}:${allocation.purchaseLineId}`;
        if (seen.has(key) || allocatedByInvoiceLine.has(allocation.invoiceLineIndex) || !preparedByIndex.has(allocation.invoiceLineIndex)) {
          await client.query("rollback");
          return { kind: "purchase_conflict" };
        }
        seen.add(key);
        const line = preparedByIndex.get(allocation.invoiceLineIndex);
        const purchase = purchaseLineById.get(allocation.purchaseLineId);
        const outstanding = purchase ? Number(purchase.quantity) - Number(purchase.received_quantity) - Number(purchase.cancelled_quantity) : 0;
        const nextAllocated = (allocatedByInvoiceLine.get(allocation.invoiceLineIndex) || 0) + Number(allocation.quantity);
        if (nextAllocated > Number(line.quantity)) {
          await client.query("rollback");
          return { kind: "purchase_conflict" };
        }
        allocatedByInvoiceLine.set(allocation.invoiceLineIndex, nextAllocated);
        const reviewedPo = source.reviewed_draft?.purchaseOrderNumber?.value || "";
        const reviewedVendor = source.reviewed_draft?.vendorName?.value || "";
        if (!purchase || !['ordered','partially_received'].includes(purchase.status) || Number(allocation.quantity) > outstanding
          || normalizePurchaseNumber(purchase.order_number) !== normalizePurchaseNumber(reviewedPo)
          || String(purchase.supplier_name).trim().toLocaleLowerCase("en-US") !== String(reviewedVendor).trim().toLocaleLowerCase("en-US")
          || (purchase.catalog_part_id && purchase.catalog_part_id !== line.catalogPartId)
          || purchase.effective_uom_code !== line.uomCode
          || purchase.effective_tracking_mode !== line.trackingMode
          || normalizePartNumber(purchase.part_number) !== line.normalizedPartNumber) {
          await client.query("rollback");
          return { kind: "purchase_conflict" };
        }
        if (!purchase.catalog_part_id && line.catalogPartId) {
          await client.query("update inventory_purchase_lines set catalog_part_id=$3 where company_id=$1 and id=$2", [source.company_id, purchase.id, line.catalogPartId]);
        }
        purchaseInvoiceAllocations.push({ ...allocation, purchaseLine: purchase });
      }
    }

    if (!direct && postingRoute === "purchase_order" && receiptOutcomes.length) {
      for (const outcome of [...receiptOutcomes].sort((a, b) => String(a.purchaseLineId || "").localeCompare(String(b.purchaseLineId || "")))) {
        if (!outcome.purchaseLineId) { await client.query("rollback"); return { kind: "purchase_conflict" }; }
        const purchase = purchaseLineById.get(outcome.purchaseLineId);
        const reviewedPo = source.reviewed_draft?.purchaseOrderNumber?.value || "";
        const reviewedVendor = source.reviewed_draft?.vendorName?.value || "";
        if (!purchase || !['ordered','partially_received','received'].includes(purchase.status)
          || normalizePurchaseNumber(purchase.order_number) !== normalizePurchaseNumber(reviewedPo)
          || String(purchase.supplier_name).trim().toLocaleLowerCase("en-US") !== String(reviewedVendor).trim().toLocaleLowerCase("en-US")
          || (purchase.catalog_part_id && purchase.catalog_part_id !== outcome.catalogPartId)
          || purchase.effective_uom_code !== outcome.uomCode
          || normalizePartNumber(purchase.part_number) !== normalizePartNumber(outcome.partNumber)) {
          await client.query("rollback");
          return { kind: "purchase_conflict" };
        }
      }
    }

    const totalQuantity = preparedLines.reduce((total, line) => total + line.quantity, 0);
    await client.query(
      `insert into local_inventory_receipts (
         id, company_id, location_id, invoice_run_id, created_by,
         idempotency_key, request_hash, line_count, total_quantity,
         reviewed_run_version, physical_confirmation, confirmation_hash, source_type, source_reference,
         posting_route, no_purchase_order_reason
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
      [receiptId, source.company_id, source.location_id, runId, actorId,
        idempotencyKey, requestHash, preparedLines.length, totalQuantity,
        reviewedRunVersion, physicalConfirmation, confirmationHash, direct ? "direct" : "invoice", direct?.reference || "",
        direct?.purchaseOrderId || direct?.purchaseLineId ? "purchase_order" : (direct ? "no_purchase_order" : (postingRoute || "no_purchase_order")), direct?.purchaseOrderId || direct?.purchaseLineId ? "" : (direct ? direct.noPurchaseOrderReason : (noPurchaseOrderReason || "No purchase order supplied."))],
    );
    await client.query(
      `insert into inventory_receipts (
         id, company_id, location_id, invoice_run_id, created_by,
         idempotency_key, provider, provider_marker, provider_picking_name,
         status, confirmed_at
       ) values ($1, $2, $3, $4, $5, $6, $8, $7, 'Local receipt', 'confirmed', now())`,
      [receiptId, source.company_id, source.location_id, runId, actorId,
        idempotencyKey, `LOCAL-REC-${receiptId}`, direct ? "local_direct" : "local"],
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
           product_external_id, part_number, description, quantity, uom_code, tracking_mode,
           catalog_tracking_mode, currency, unit_cost, line_total, cost_source
         ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
        [line.id, source.company_id, receiptId, line.lineIndex, catalogPartId,
          `local:${catalogPartId}`, line.partNumber, line.description,
          line.quantity, line.uomCode, line.trackingMode === "serialized" ? "serial" : "aggregate",
          line.trackingMode, line.currency, line.unitCost, line.lineTotal, line.costSource || "unknown"],
      );
      const acceptedQuantity = line.acceptedQuantity ?? line.quantity;
      if (line.serializedUnits?.length) {
        await client.query(
          `insert into inventory_serialized_units (
             id, company_id, location_id, receipt_id, receipt_line_id,
             unit_ordinal, serial_number, status, condition_code, custody_holder_type, custody_location_id
           )
           select input.id, $1, $2, $3, $4, input.ordinal, input.serial_number, input.status, input.condition_code, 'inventory_location', $2
           from unnest($5::uuid[], $6::integer[], $7::text[], $8::text[], $9::text[])
             as input(id, ordinal, serial_number, condition_code, status)`,
          [source.company_id, source.location_id, receiptId, line.id,
            line.serializedUnits.map((unit) => unit.id),
            line.serializedUnits.map((unit) => unit.ordinal),
            line.serializedUnits.map((unit) => unit.serialNumber),
            line.serializedUnits.map((unit) => unit.conditionCode || "unknown"),
            line.serializedUnits.map((unit) => unit.status || "in_stock")],
        );
        await client.query(
          `insert into inventory_unit_events (company_id, unit_id, event_type, actor_id, details)
           select $1, input.id, 'receipt_recorded', $2, jsonb_build_object('source', $4::text, 'status', input.status)
           from unnest($3::uuid[], $5::text[]) as input(id,status)`,
          [source.company_id, actorId, line.serializedUnits.map((unit) => unit.id), direct ? "local_direct" : "local_invoice",
            line.serializedUnits.map((unit) => unit.status || "in_stock")],
        );
      }
      if (acceptedQuantity > 0) {
      await recordInventoryAuthorityCutover(client, {
        claim: line.authorityClaim,
        companyId: source.company_id,
        locationId: source.location_id,
        catalogPartId,
        receiptId,
        receiptLineId: line.id,
      });
      await client.query(
        `insert into inventory_stock_movements (
           company_id, location_id, catalog_part_id, receipt_id, receipt_line_id,
           movement_type, quantity_delta, uom_code, actor_id, reason, idempotency_key
         ) values ($1, $2, $3, $4, $5, $11, $6, $7, $8, $9, $10)`,
        [source.company_id, source.location_id, catalogPartId, receiptId, line.id,
          acceptedQuantity, line.uomCode, actorId, direct ? `Direct receipt${direct.reference ? `: ${direct.reference}` : ""}` : `Invoice ${runId}`,
          `invoice-receipt:${receiptId}:line:${line.lineIndex}`, direct ? "direct_receipt" : "invoice_receipt"],
      );
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
          line.partNumber, line.description, acceptedQuantity, line.uomCode,
          `local:${catalogPartId}:${source.location_id}:${line.uomCode}`],
      );
      if (!balance.rows[0]) {
        const error = new Error("Inventory authority changed during receipt confirmation.");
        error.code = "INVENTORY_AUTHORITY_CONFLICT";
        throw error;
      }
      const placement = {
        companyId: source.company_id, locationId: source.location_id, catalogPartId, uomCode: line.uomCode,
        actorId, idempotencyKey: `position:${direct ? "direct" : "invoice"}-receipt:${receiptId}:${line.lineIndex}`,
        requestHash, receiptId, reason: direct ? `Direct receipt ${receiptId}` : `Invoice ${runId}`,
        ...((line.targetPositionId || direct?.targetPositionId) ? { targetPositionId: line.targetPositionId || direct.targetPositionId } : {}),
      };
      // Held delivery remains in the stock-task custody bucket, outside usable stock.
      if (direct?.disposition === "held") continue;
      const availableUnitIds = (line.serializedUnits || []).filter((unit) => (unit.status || "in_stock") === "in_stock").map((unit) => unit.id);
      if (availableUnitIds.length) await placeSerializedInventoryReceipt(client, {
        ...placement, unitIds: availableUnitIds,
      });
      else await placeAggregateInventoryReceipt(client, {
        ...placement, inventoryItemId: balance.rows[0].id, quantity: acceptedQuantity,
      });
      }
    }
    for (const allocation of purchaseInvoiceAllocations) {
      const receiptLineId = preparedByIndex.get(allocation.invoiceLineIndex)?.id;
      if (!receiptLineId) { await client.query("rollback"); return { kind: "purchase_conflict" }; }
      const planned = await client.query(`insert into inventory_purchase_invoice_allocations
        (company_id,invoice_run_id,invoice_line_index,purchase_line_id,receipt_line_id,quantity,status,request_hash,created_by,posted_at)
        values($1,$2,$3,$4,$5,$6,'posted',$7,$8,now())
        returning id`, [source.company_id, runId, allocation.invoiceLineIndex, allocation.purchaseLineId, receiptLineId,
        allocation.quantity, requestHash, actorId]);
      if (!planned.rows[0]) { await client.query("rollback"); return { kind: "conflict" }; }
      await client.query(`insert into inventory_purchase_receipt_allocations(company_id,purchase_line_id,receipt_line_id,quantity)
        values($1,$2,$3,$4)`, [source.company_id, allocation.purchaseLineId, receiptLineId, allocation.quantity]);
      await client.query(`update inventory_purchase_lines set received_quantity=received_quantity+$3 where company_id=$1 and id=$2`,
        [source.company_id, allocation.purchaseLineId, allocation.quantity]);
      await client.query(`insert into inventory_purchase_events(company_id,order_id,actor_id,action,details) values($1,$2,$3,'receive',$4)`,
        [source.company_id, allocation.purchaseLine.order_id, actorId, JSON.stringify({ receiptId, quantity: allocation.quantity, invoiceRunId: runId })]);
    }
    if (direct?.purchaseOrderId) {
      for (const outcome of receiptOutcomes) {
        if (Number(outcome.usableQuantity) <= 0) continue;
        await client.query(`insert into inventory_purchase_receipt_allocations(company_id,purchase_line_id,receipt_line_id,quantity)
          values($1,$2,$3,$4)`, [source.company_id, outcome.purchaseLineId, outcome.receiptLineId, outcome.usableQuantity]);
        await client.query(`update inventory_purchase_lines set received_quantity=received_quantity+$3
          where company_id=$1 and id=$2`, [source.company_id, outcome.purchaseLineId, outcome.usableQuantity]);
      }
      await client.query(`insert into inventory_purchase_events(company_id,order_id,actor_id,action,details)
        values($1,$2,$3,'receive',$4)`, [source.company_id, direct.purchaseOrderId, actorId,
        JSON.stringify({ receiptId, outcomes: receiptOutcomes.map(({ purchaseLineId, usableQuantity, heldQuantity, rejectedQuantity, notReceivedQuantity, outcome }) =>
          ({ purchaseLineId, usableQuantity, heldQuantity, rejectedQuantity, notReceivedQuantity, outcome })) })]);
    }
    if (receiptOutcomes.length && (!direct || direct.purchaseOrderId)) {
      const orderIds = [...new Set(receiptOutcomes.map((outcome) => purchaseLineById.get(outcome.purchaseLineId)?.order_id).filter(Boolean))];
      if ((postingRoute === "purchase_order" || direct?.purchaseOrderId) && orderIds.length !== 1) { await client.query("rollback"); return { kind: "purchase_conflict" }; }
      const deliveryId = randomUUID();
      await client.query(`insert into inventory_purchase_deliveries
        (id,company_id,order_id,invoice_run_id,location_id,received_by,idempotency_key,request_hash,reference,notes)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [deliveryId, source.company_id, orderIds[0] || null, direct ? null : runId, source.location_id,
        actorId, idempotencyKey, requestHash, direct?.reference || source.reviewed_draft?.invoiceNumber?.value || "", direct ? "Purchase order delivery" : `Invoice ${runId}`]);
      for (const outcome of receiptOutcomes) {
        const mapOutcome = outcome.outcome === "wrong" ? "wrong_item"
          : outcome.outcome === "short" ? "accepted"
            : outcome.outcome === "over" ? "overage"
              : outcome.outcome;
        if (Number(outcome.actualQuantity) > 0) {
          await client.query(`insert into inventory_purchase_delivery_lines
            (company_id,delivery_id,purchase_line_id,invoice_line_index,receipt_line_id,outcome,expected_quantity,actual_quantity,
             usable_quantity,held_quantity,rejected_quantity,uom_code,reason)
            values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, [source.company_id, deliveryId,
            outcome.purchaseLineId || null, direct ? null : outcome.invoiceLineIndex, outcome.receiptLineId, mapOutcome, outcome.actualQuantity, outcome.actualQuantity,
            outcome.usableQuantity, outcome.heldQuantity, outcome.rejectedQuantity, outcome.uomCode,
            [outcome.notes, outcome.holdLocation ? `Hold: ${outcome.holdLocation}` : ""].filter(Boolean).join(" — ").slice(0,500)]);
        }
        if (Number(outcome.notReceivedQuantity) > 0) {
          await client.query(`insert into inventory_purchase_delivery_lines
            (company_id,delivery_id,purchase_line_id,invoice_line_index,receipt_line_id,outcome,expected_quantity,actual_quantity,
             usable_quantity,held_quantity,rejected_quantity,uom_code,reason)
            values($1,$2,$3,$4,null,'shortage',$5,0,0,0,0,$6,$7)`, [source.company_id, deliveryId,
            outcome.purchaseLineId || null, direct ? null : outcome.invoiceLineIndex, outcome.notReceivedQuantity, outcome.uomCode, outcome.notes]);
        }
      }
    }
    const affectedPurchaseOrderIds = [...new Set([
      ...purchaseInvoiceAllocations.map((allocation) => allocation.purchaseLine.order_id),
      ...receiptOutcomes.map((outcome) => purchaseLineById.get(outcome.purchaseLineId)?.order_id).filter(Boolean),
    ])];
    for (const orderId of affectedPurchaseOrderIds) {
      await client.query(`update inventory_purchase_orders purchase_order set
        status=case
          when summary.open_quantity=0 then 'received'
          when summary.received_quantity>0 then 'partially_received'
          else 'ordered'
        end,
        version=version+1,updated_at=now()
        from (select coalesce(sum(received_quantity),0) received_quantity,
          coalesce(sum(quantity-received_quantity-cancelled_quantity),0) open_quantity
          from inventory_purchase_lines where company_id=$1 and order_id=$2) summary
        where purchase_order.company_id=$1 and purchase_order.id=$2
          and purchase_order.status not in ('cancelled','closed_with_discrepancy')`, [source.company_id, orderId]);
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
    if (direct?.disposition==='held') {
      await client.query("update local_inventory_receipts set disposition='held' where company_id=$1 and id=$2",[source.company_id,receiptId]);
      const line=preparedLines[0];
      const held=await client.query(`insert into inventory_stock_tasks(company_id,location_id,catalog_part_id,kind,status,quantity,uom_code,reason,holder,created_by) values($1,$2,$3,'damage','inspection',$4,$5,$6,$7,$8) returning id`,[source.company_id,source.location_id,line.catalogPartId,line.quantity,line.uomCode,direct.damageDetails,direct.holdLocation,actorId]);
      await client.query('update inventory_stock_movements set stock_task_id=$3 where company_id=$1 and receipt_id=$2',[source.company_id,receiptId,held.rows[0].id]);
      await client.query(`update inventory_items set quantity_on_hand=quantity_on_hand-$4,updated_at=now() where company_id=$1 and location_id=$2 and catalog_part_id=$3 and source_provider='local' and uom_code=$5`,[source.company_id,source.location_id,line.catalogPartId,line.quantity,line.uomCode]);
      await client.query(`insert into inventory_stock_movements(company_id,location_id,catalog_part_id,receipt_id,receipt_line_id,movement_type,quantity_delta,uom_code,actor_id,reason,idempotency_key) values($1,$2,$3,$4,$5,'adjustment',$6,$7,$8,$9,$10)`,[source.company_id,source.location_id,line.catalogPartId,receiptId,line.id,-line.quantity,line.uomCode,actorId,direct.damageDetails,`receipt-hold:${receiptId}`]);
      await client.query('update inventory_stock_movements set stock_task_id=$3 where company_id=$1 and receipt_id=$2 and stock_task_id is null',[source.company_id,receiptId,held.rows[0].id]);
      await client.query(`insert into inventory_stock_task_units(company_id,task_id,unit_id) select company_id,$3,id from inventory_serialized_units where company_id=$1 and receipt_id=$2`,[source.company_id,receiptId,held.rows[0].id]);
      await client.query(`update inventory_serialized_units set status='removed',condition_code='needs_repair',custody_external_reference=$3,custody_version=custody_version+1 where company_id=$1 and receipt_id=$2`,[source.company_id,receiptId,direct.holdLocation]);
      await client.query(`insert into inventory_stock_task_events(company_id,task_id,actor_id,action,details) values($1,$2,$3,'damaged_delivery',$4)`,[source.company_id,held.rows[0].id,actorId,JSON.stringify({receiptId,reason:direct.damageDetails})]);
    }
    if (purchaseRequest) {
      const saved=await client.query(`update inventory_purchase_requests set status='added',receipt_id=$2,catalog_part_id=$3,
        added_by=$4,added_at=now(),updated_at=now(),version=version+1 where id=$1 returning *`,[purchaseRequest.id,receiptId,preparedLines[0].catalogPartId,actorId]);
      await client.query('insert into inventory_purchase_request_events(company_id,request_id,actor_id,action,details) values($1,$2,$3,$4,$5)',[source.company_id,purchaseRequest.id,actorId,'request_add',JSON.stringify(saved.rows[0])]);
    }
    const receipt = await loadReceipt(client, source.company_id, receiptId);
    if (approvalRequest) {
      await client.query(`update inventory_direct_receipt_approval_requests set status='approved',receipt_id=$3,
        decision_by=$4,decision_reason=$5,decided_at=now(),version=version+1,updated_at=now()
        where company_id=$1 and id=$2`, [source.company_id,approvalRequest.id,receiptId,approval.approverActorId,approval.reason || null]);
      await client.query(`insert into inventory_direct_receipt_approval_events(company_id,request_id,actor_id,action,details)
        values($1,$2,$3,'approve',$4)`, [source.company_id,approvalRequest.id,approval.approverActorId,JSON.stringify({ receiptId })]);
    }
    await client.query("commit");
    return { kind: "posted", receipt };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    if (error?.code === "INVENTORY_AUTHORITY_CONFLICT") return { kind: "authority_conflict" };
    if (error?.code === "INVENTORY_RECEIPT_POSITION_INVALID") return { kind: "target_position_invalid" };
    if (error?.code === "23505" && error?.constraint === "inventory_serialized_units_company_id_serial_number_key") return { kind: "serial_conflict" };
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
     left join lateral (
       select latest.* from local_inventory_receipts latest
       where latest.company_id = run.company_id and latest.invoice_run_id = run.id
       order by latest.posted_at desc, latest.id desc
       limit 1
     ) receipt on true
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
              item.bin_location,
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
              coalesce(local.bin_location, '') as bin_location,
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
              catalog.barcode, catalog.uom_code, catalog.inventory_display_uom_code, catalog.tracking_mode, catalog.uom_locked_at, catalog.version,
              coalesce((select mapping.display_name from odoo_product_mappings mapping
                where mapping.company_id = catalog.company_id and mapping.catalog_part_id = catalog.id
                order by mapping.active desc, mapping.updated_at desc, mapping.external_id limit 1), '') as odoo_name,
              coalesce((select jsonb_agg(reference.reference_number order by lower(reference.reference_number), reference.id)
                from part_reference_numbers reference where reference.company_id=catalog.company_id and reference.catalog_part_id=catalog.id), '[]'::jsonb) as reference_numbers,
              case when exists (
                select 1 from odoo_product_mappings provider
                where provider.company_id = catalog.company_id
                  and provider.catalog_part_id = catalog.id and provider.active = true
              ) then 'odoo' else catalog.source_provider end as source_provider,
              exists (select 1 from odoo_product_mappings ownership where ownership.company_id=catalog.company_id and ownership.catalog_part_id=catalog.id) as provider_managed,
              exists (select 1 from inventory_replenishment_alerts alert where alert.company_id=catalog.company_id and alert.catalog_part_id=catalog.id and alert.resolved_at is null) as low_stock,
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
                'binLocation', coalesce(balance.bin_location, ''),
                'quantityOnHand', coalesce(balance.quantity_on_hand, 0),
                'quantityReserved', coalesce(balance.quantity_reserved, 0),
                'quantityAvailable', coalesce(balance.quantity_available, 0),
                'odooQuantityOnHand', coalesce(balance.odoo_quantity_on_hand, 0),
                'minimumAvailable', (select policy.minimum_available from inventory_stocking_policies policy where policy.company_id=catalog.company_id and policy.location_id=catalog_location.id and policy.catalog_part_id=catalog.id),
                'targetQuantity', (select policy.target_quantity from inventory_stocking_policies policy where policy.company_id=catalog.company_id and policy.location_id=catalog_location.id and policy.catalog_part_id=catalog.id),
                'alertEnabled', coalesce((select policy.alert_enabled from inventory_stocking_policies policy where policy.company_id=catalog.company_id and policy.location_id=catalog_location.id and policy.catalog_part_id=catalog.id), false),
                'policyVersion', (select policy.version from inventory_stocking_policies policy where policy.company_id=catalog.company_id and policy.location_id=catalog_location.id and policy.catalog_part_id=catalog.id),
                'lowStock', exists(select 1 from inventory_replenishment_alerts alert where alert.company_id=catalog.company_id and alert.location_id=catalog_location.id and alert.catalog_part_id=catalog.id and alert.resolved_at is null),
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
             select 1 from inventory_serialized_units exact_unit
             join inventory_receipt_lines exact_line on exact_line.company_id=exact_unit.company_id and exact_line.id=exact_unit.receipt_line_id
             where exact_unit.company_id=catalog.company_id and exact_line.catalog_part_id=catalog.id
               and ($3::boolean or coalesce(exact_unit.custody_location_id,exact_unit.location_id)=any($2::uuid[]))
               and ($4::uuid is null or coalesce(exact_unit.custody_location_id,exact_unit.location_id)=$4)
               and lower(exact_unit.serial_number) like $5 escape '\\'
           )
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
       case when $10 = 'low_stock_first' then low_stock end desc,
       case when $10 = 'low_stock_first' and low_stock then quantity_available end asc,
       case when $10 = 'available_desc' then quantity_available end desc,
       case when $10 = 'reserved_desc' then quantity_reserved end desc,
       case when $10 = 'locations_desc' then location_count end desc,
       case when $10 in ('available_desc', 'low_stock_first', 'reserved_desc', 'locations_desc') then quantity_available end desc,
       lower(part_number), catalog_part_id
     limit $6 offset $7`,
    [companyIds, locationIds, isAdmin, locationId, search, limit, offset, scope, availability, sort, normalizedReferencePrefix],
  );
  const items = result.rows.map((row) => ({
    companyId: row.company_id,
    catalogPartId: row.catalog_part_id,
    partNumber: row.part_number,
    description: row.description || "",
    odooName: row.odoo_name || "",
    manufacturer: row.manufacturer || "",
    category: row.category || "",
    barcode: row.barcode || "",
    version: Number(row.version || 1),
    referenceNumbers: row.reference_numbers || [],
    providerManaged: row.provider_managed === true,
    uomLocked: row.uom_locked_at !== null,
    trackingMode: row.tracking_mode || null,
    lowStock: row.low_stock === true,
    editableFields: row.provider_managed === true ? ["description", "manufacturer", "uomCode", "trackingMode", "referenceNumbers"] : ["description", "partNumber", "manufacturer", "category", "barcode", "uomCode", "trackingMode", "referenceNumbers"],
    uomCode: row.inventory_display_uom_code || row.uom_code,
    canonicalUomCode: row.uom_code,
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
