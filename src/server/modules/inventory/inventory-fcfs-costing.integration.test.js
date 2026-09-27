import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { closePool, getPool, query } from "../../db/pool.js";
import { postLocalInventoryReceipt } from "../../db/repositories/local-inventory.repo.js";
import {
  listAggregateWorkorderUsages,
  markAggregateUsagesPending,
  consumeAggregateUsagesForApproval,
  reserveAggregateWorkorderUsage,
} from "../../db/repositories/inventory-aggregate-workorder-usage.repo.js";
import { appendInventorySellingPolicy, getInventorySellingPolicy } from "../../db/repositories/inventory-selling-policies.repo.js";
import { appendInventoryBatchCostRevision } from "../../db/repositories/inventory-batch-costs.repo.js";
import { saveWorkorderPartPriceSnapshot } from "../../db/repositories/workorder-part-pricing.repo.js";

const enabled = process.env.RUN_POSTGRES_INTEGRATION === "1";
const hash = (value) => createHash("sha256").update(String(value)).digest("hex");
after(async () => { if (enabled) await closePool(); });

test("two inbound invoice batches allocate FCFS and preserve a transparent mixed Workorder price", { skip: !enabled }, async () => {
  const suffix = randomUUID().replaceAll("-", "");
  const actorId = randomUUID();
  const companyId = randomUUID();
  const locationId = randomUUID();
  const otherLocationId = randomUUID();
  const assetId = randomUUID();
  const partId = randomUUID();
  const workorderId = randomUUID();

  await query("insert into user_profiles(id,display_name) values($1,'FCFS demo manager')", [actorId]);
  await query("insert into companies(id,slug,name) values($1,$2,'FCFS demo company')", [companyId, `fcfs-${suffix}`]);
  await query("insert into locations(id,company_id,name) values($1,$2,'FCFS demo shop')", [locationId, companyId]);
  await query("insert into locations(id,company_id,name) values($1,$2,'Other FCFS demo shop')", [otherLocationId, companyId]);
  await query("insert into assets(id,company_id,location_id,provider,name,unit_no) values($1,$2,$3,'manual','FCFS demo truck',$4)", [assetId, companyId, locationId, `FCFS-${suffix.slice(0, 6)}`]);
  await query(
    `insert into parts_catalog(id,company_id,normalized_part_number,part_number,description,uom_code,tracking_mode)
     values($1,$2,$3,$4,'FCFS demo filter','ea','quantity')`,
    [partId, companyId, `FCFSFILTER${suffix}`, `FCFS-FILTER-${suffix}`],
  );

  async function receiveInvoiceBatch({ invoiceNumber, quantity, unitCost, occurredAt, targetLocationId = locationId }) {
    const runId = randomUUID();
    const receiptId = randomUUID();
    const lineId = randomUUID();
    const requestHash = hash(`${invoiceNumber}:${quantity}:${unitCost}`);
    const draft = {
      invoiceNumber: { value: invoiceNumber },
      vendorName: { value: "FCFS Demo Supplier" },
      currency: { value: "USD" },
      lines: [{ partNumber: { value: `FCFS-FILTER-${suffix}` }, quantity: { value: quantity }, unitPrice: { value: unitCost } }],
    };
    await query(
      `insert into invoice_extraction_runs(
         id,company_id,location_id,created_by,reviewed_by,document_hash,file_name,mime_type,
         byte_size,idempotency_key,status,provider,model,prompt_version,reviewed_draft,reviewed_at,created_at
       ) values($1,$2,$3,$4,$4,$5,$6,'application/pdf',1,$7,'reviewed','demo','demo','demo-v1',$8,now(),$9)`,
      [runId, companyId, targetLocationId, actorId, hash(`document:${invoiceNumber}`), `${invoiceNumber}.pdf`,
        `extract-${suffix}-${invoiceNumber}`, JSON.stringify(draft), occurredAt],
    );
    const result = await postLocalInventoryReceipt({
      receiptId,
      runId,
      actorId,
      companyIds: [companyId],
      locationIds: [targetLocationId],
      idempotencyKey: `post-${suffix}-${invoiceNumber}`,
      requestHash,
      reviewedRunVersion: 1,
      physicalConfirmation: "all_received_undamaged",
      confirmationHash: requestHash,
      labelBatchId: null,
      postingRoute: "no_purchase_order",
      noPurchaseOrderReason: "FCFS costing demo invoice",
      lines: [{
        id: lineId,
        lineIndex: 0,
        catalogPartId: partId,
        normalizedPartNumber: `FCFSFILTER${suffix}`,
        partNumber: `FCFS-FILTER-${suffix}`,
        description: "FCFS demo filter",
        quantity,
        acceptedQuantity: quantity,
        uomCode: "ea",
        trackingMode: "quantity",
        currency: "USD",
        unitCost,
        lineTotal: quantity * unitCost,
        costSource: "invoice_line",
        serializedUnits: [],
      }],
    });
    assert.equal(result.kind, "posted");
    await query(
      `update inventory_aggregate_cost_layers set received_at=$3
       where company_id=$1 and receipt_line_id=$2`,
      [companyId, lineId, occurredAt],
    );
    return { receiptId, lineId };
  }

  const otherLocationBatch = await receiveInvoiceBatch({
    invoiceNumber: `DEMO-OTHER-${suffix}`,
    quantity: 7,
    unitCost: 1,
    occurredAt: "2026-07-01T12:00:00Z",
    targetLocationId: otherLocationId,
  });
  const older = await receiveInvoiceBatch({ invoiceNumber: `DEMO-OLD-${suffix}`, quantity: 1, unitCost: 10, occurredAt: "2026-08-01T12:00:00Z" });
  const current = await receiveInvoiceBatch({ invoiceNumber: `DEMO-NEW-${suffix}`, quantity: 5, unitCost: 20, occurredAt: "2026-09-01T12:00:00Z" });

  await query(
    `insert into operational_workorders(id,company_id,serial,asset_id,location_id,created_by_user_id,concern,status)
     values($1,$2,$3,$4,$5,$6,'Use four FCFS filters','in_progress')`,
    [workorderId, companyId, `WO-FCFS-${suffix}`, assetId, locationId, actorId],
  );
  const positionId = (await query(
    `select position.id from inventory_positions position
     join inventory_position_balances balance on balance.company_id=position.company_id and balance.position_id=position.id
     where position.company_id=$1 and position.location_id=$2 and balance.catalog_part_id=$3 order by position.id limit 1`,
    [companyId, locationId, partId],
  )).rows[0].id;
  const reserved = await reserveAggregateWorkorderUsage({
    workorderId,
    catalogPartId: partId,
    sourcePositionId: positionId,
    quantity: 4,
    uomCode: "ea",
    repairOrder: "Replace filters",
    companyIds: [companyId],
    locationIds: [locationId],
    isAdmin: false,
    actorId,
    idempotencyKey: `reserve-${suffix}`,
    requestHash: hash(`reserve-${suffix}`),
  });
  assert.equal(reserved.kind, "reserved");

  const usages = await listAggregateWorkorderUsages({ workorderId, companyId, locationId });
  assert.deepEqual(usages[0].costAllocations.map((allocation) => ({
    receiptLineId: allocation.receiptLineId,
    quantity: allocation.quantity,
    unitCost: allocation.unitCost,
    receiptReference: allocation.receiptReference,
  })), [
    { receiptLineId: older.lineId, quantity: "1.000", unitCost: "10.0000", receiptReference: `DEMO-OLD-${suffix}` },
    { receiptLineId: current.lineId, quantity: "3.000", unitCost: "20.0000", receiptReference: `DEMO-NEW-${suffix}` },
  ]);
  assert.ok(usages[0].costAllocations.every((allocation) => allocation.receiptLineId !== otherLocationBatch.lineId));

  const companyBatches = await getInventorySellingPolicy({
    catalogPartId: partId,
    companyIds: [companyId],
    locationIds: [locationId],
    isAdmin: false,
  });
  assert.deepEqual(companyBatches.availableBatches.map((batch) => ({
    receiptLineId: batch.receiptLineId,
    availableQuantity: batch.availableQuantity,
    placementStatus: batch.placementStatus,
    positionedQuantity: batch.placements.reduce((sum, placement) => sum + Number(placement.quantity), 0),
  })), [
    { receiptLineId: older.lineId, availableQuantity: "0", placementStatus: "exact", positionedQuantity: 1 },
    { receiptLineId: current.lineId, availableQuantity: "2", placementStatus: "exact", positionedQuantity: 5 },
  ]);
  assert.ok(companyBatches.availableBatches.every((batch) => batch.locationId === locationId));

  const allCompanyBatches = await getInventorySellingPolicy({
    catalogPartId: partId,
    companyIds: [companyId],
    locationIds: [locationId],
    isAdmin: true,
  });
  assert.deepEqual(
    allCompanyBatches.availableBatches.map((batch) => ({ receiptLineId: batch.receiptLineId, locationId: batch.locationId })),
    [
      { receiptLineId: otherLocationBatch.lineId, locationId: otherLocationId },
      { receiptLineId: older.lineId, locationId },
      { receiptLineId: current.lineId, locationId },
    ],
  );
  const positionedAllocations = await query(
    `select position_id,quantity from inventory_aggregate_usage_cost_allocations
     where company_id=$1 and usage_id=$2 order by cost_layer_id`,
    [companyId, reserved.usage.id],
  );
  assert.equal(positionedAllocations.rows.length, 2);
  assert.ok(positionedAllocations.rows.every((allocation) => allocation.position_id === positionId));

  const olderLayer = companyBatches.availableBatches.find((batch) => batch.receiptLineId === older.lineId);
  const corrected = await appendInventoryBatchCostRevision({
    costLayerId: olderLayer.costLayerId,
    expectedVersion: 0,
    unitCost: "12.0000",
    currency: "USD",
    reason: "Correct the older receipt batch",
    companyIds: [companyId],
    locationIds: [locationId],
    isAdmin: false,
    actorId,
    idempotencyKey: `batch-correction-${suffix}`,
    requestHash: hash(`batch-correction-${suffix}`),
  });
  assert.equal(corrected.revision.version, 1);
  const correctedUsages = await listAggregateWorkorderUsages({ workorderId, companyId, locationId });
  assert.deepEqual(correctedUsages[0].costAllocations.map((allocation) => allocation.unitCost), ["12.0000", "20.0000"]);

  const scope = { companyIds: [companyId], locationIds: [locationId], isAdmin: false, actorId };
  const batchPrice = await saveWorkorderPartPriceSnapshot({
    ...scope,
    workorderId,
    usageKind: "aggregate",
    usageId: reserved.usage.id,
    selection: "batch_cost",
    reason: "Use exact FCFS receipt costs",
    idempotencyKey: `batch-price-${suffix}`,
    requestHash: hash(`batch-price-${suffix}`),
  });
  assert.equal(batchPrice.snapshot.totalPrice, "72.0000");
  assert.equal(batchPrice.snapshot.unitPrice, "18.0000");
  assert.deepEqual(batchPrice.snapshot.allocations.map((allocation) => allocation.totalPrice), ["12.0000", "60.0000"]);

  await appendInventorySellingPolicy({
    catalogPartId: partId,
    locationId,
    expectedVersion: 0,
    method: "markup_percent",
    value: "25",
    currency: null,
    reason: "FCFS demo markup",
    companyIds: [companyId],
    locationIds: [locationId],
    isAdmin: false,
    actorId,
    idempotencyKey: `selling-policy-${suffix}`,
    requestHash: hash(`selling-policy-${suffix}`),
  });
  const sellingPrice = await saveWorkorderPartPriceSnapshot({
    ...scope,
    workorderId,
    usageKind: "aggregate",
    usageId: reserved.usage.id,
    selection: "selling_price",
    reason: "Use FCFS markup selling price",
    idempotencyKey: `selling-price-${suffix}`,
    requestHash: hash(`selling-price-${suffix}`),
  });
  assert.equal(sellingPrice.snapshot.totalPrice, "90.0000");
  assert.equal(sellingPrice.snapshot.unitPrice, "22.5000");

  await appendInventoryBatchCostRevision({
    costLayerId: olderLayer.costLayerId,
    expectedVersion: 1,
    unitCost: "13.0000",
    currency: "USD",
    reason: "Second correction after pricing",
    companyIds: [companyId],
    locationIds: [locationId],
    isAdmin: false,
    actorId,
    idempotencyKey: `batch-correction-second-${suffix}`,
    requestHash: hash(`batch-correction-second-${suffix}`),
  });
  const repricedUsages = await listAggregateWorkorderUsages({ workorderId, companyId, locationId });
  assert.deepEqual(repricedUsages[0].costAllocations.map((allocation) => allocation.unitCost), ["13.0000", "20.0000"]);
  assert.equal(repricedUsages[0].price.totalPrice, "90.0000");
  assert.deepEqual(repricedUsages[0].price.allocations.map((allocation) => allocation.totalPrice), ["15.0000", "75.0000"]);

  const transaction = await getPool().connect();
  try {
    await transaction.query("begin");
    await markAggregateUsagesPending(transaction, { workorderId, companyId, actorId });
    await consumeAggregateUsagesForApproval(transaction, { workorderId, companyId, actorId });
    await transaction.query("commit");
  } finally {
    transaction.release();
  }
  const policy = await getInventorySellingPolicy({ catalogPartId: partId, companyIds: [companyId], locationIds: [locationId], locationId });
  assert.deepEqual(policy.availableBatches.map((batch) => ({ receiptLineId: batch.receiptLineId, onHandQuantity: batch.onHandQuantity, positioned: batch.placements.map((placement) => placement.quantity) })), [
    { receiptLineId: current.lineId, onHandQuantity: "2.000", positioned: ["2.000"] },
  ]);
});
