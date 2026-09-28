import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { closePool, getPool, query } from "../../db/pool.js";
import { appendInventoryBatchCostRevision } from "../../db/repositories/inventory-batch-costs.repo.js";
import { moveInventoryStock, placeSerializedInventoryReceipt } from "../../db/repositories/inventory-positions.repo.js";
import { appendInventorySellingPolicy } from "../../db/repositories/inventory-selling-policies.repo.js";
import { postLocalInventoryReceipt } from "../../db/repositories/local-inventory.repo.js";
import {
  createOperationalWorkorder,
  WorkorderLifecycleConflictError,
} from "../../db/repositories/operational-workorders.repo.js";
import {
  createPricingFingerprint,
  readCreatePricing,
} from "../../db/repositories/workorder-create-pricing.repo.js";
import { appendLaborRateVersion } from "../../db/repositories/workorder-labor-pricing.repo.js";

const enabled = process.env.RUN_POSTGRES_INTEGRATION === "1";
const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

after(async () => { if (enabled) await closePool(); });

async function placeSerializedUnit({ companyId, locationId, catalogPartId, unitId, actorId, receiptId, suffix }) {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    await placeSerializedInventoryReceipt(client, {
      companyId,
      locationId,
      catalogPartId,
      uomCode: "ea",
      unitIds: [unitId],
      actorId,
      idempotencyKey: `create-pricing-serial-position-${suffix}`,
      receiptId,
    });
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function createFixture({ aggregateSelection = "batch_cost" } = {}) {
  const suffix = randomUUID().replaceAll("-", "");
  const actorId = randomUUID();
  const companyId = randomUUID();
  const locationId = randomUUID();
  const assetId = randomUUID();
  const laborProductId = randomUUID();
  const serializedPartId = randomUUID();
  const aggregatePartId = randomUUID();
  const serializedReceiptId = randomUUID();
  const serializedReceiptLineId = randomUUID();
  const serializedUnitId = randomUUID();
  const serializedRunId = randomUUID();

  await query("insert into user_profiles(id,display_name) values($1,'Create pricing integration')", [actorId]);
  await query("insert into companies(id,slug,name) values($1,$2,'Create pricing integration')", [companyId, `create-pricing-${suffix}`]);
  await query("insert into locations(id,company_id,name) values($1,$2,'Create pricing shop')", [locationId, companyId]);
  await query(
    "insert into assets(id,company_id,location_id,provider,name,unit_no) values($1,$2,$3,'manual','Create pricing truck',$4)",
    [assetId, companyId, locationId, `CP-${suffix.slice(0, 8)}`],
  );
  await query(
    `insert into local_labor_products(id,company_id,name,normalized_name,code,normalized_code,created_by_user_id)
     values($1,$2,$3,$4,$5,$6,$7)`,
    [laborProductId, companyId, `Create labor ${suffix}`, `create labor ${suffix}`, `CP-${suffix}`, `cp-${suffix}`, actorId],
  );
  const laborRate = await appendLaborRateVersion({
    companyId,
    locationId,
    productId: laborProductId,
    priceKind: "internal_cost",
    expectedVersion: 0,
    amount: "30.0000",
    currency: "USD",
    reason: "Create Workorder integration rate",
    actorId,
    idempotencyKey: `create-pricing-rate-${suffix}`,
    requestHash: digest(`create-pricing-rate-${suffix}`),
  });
  assert.equal(laborRate.kind, "saved");

  await query(
    `insert into parts_catalog(id,company_id,normalized_part_number,part_number,description,uom_code,tracking_mode)
     values($1,$2,$3,$4,'Serialized priced part','ea','serialized'),
           ($5,$2,$6,$7,'Aggregate priced part','ea','quantity')`,
    [serializedPartId, companyId, `SERIAL${suffix}`, `SERIAL-${suffix}`,
      aggregatePartId, `AGGREGATE${suffix}`, `AGGREGATE-${suffix}`],
  );

  await query(
    `insert into invoice_extraction_runs(
       id,company_id,location_id,created_by,reviewed_by,document_hash,file_name,mime_type,
       byte_size,idempotency_key,status,provider,model,prompt_version,reviewed_draft,reviewed_at
     ) values($1,$2,$3,$4,$4,$5,'create-priced-serial.pdf','application/pdf',1,$6,
       'reviewed','integration','integration','integration-v1','{}'::jsonb,now())`,
    [serializedRunId, companyId, locationId, actorId, digest(`serial-document-${suffix}`), `serial-run-${suffix}`],
  );
  await query(
    `insert into inventory_receipts(
       id,company_id,location_id,invoice_run_id,created_by,idempotency_key,provider,
       provider_marker,provider_picking_name,status,confirmed_at
     ) values($1,$2,$3,$4,$5,$6,'local',$7,'Create priced serial receipt','confirmed',now())`,
    [serializedReceiptId, companyId, locationId, serializedRunId, actorId,
      `serial-receipt-${suffix}`, `SERIAL-${suffix}`],
  );
  await query(
    `insert into inventory_receipt_lines(
       id,company_id,receipt_id,line_index,catalog_part_id,product_external_id,part_number,
       description,quantity,uom_code,tracking_mode,unit_cost,line_total,currency,cost_source
     ) values($1,$2,$3,0,$4,$5,$6,'Serialized priced part',1,'ea','serial',37.5,37.5,'USD','invoice_line')`,
    [serializedReceiptLineId, companyId, serializedReceiptId, serializedPartId,
      `local:${serializedPartId}`, `SERIAL-${suffix}`],
  );
  await query(
    `insert into inventory_serialized_units(
       id,company_id,location_id,receipt_id,receipt_line_id,unit_ordinal,serial_number,status,
       condition_code,custody_holder_type,custody_location_id
     ) values($1,$2,$3,$4,$5,1,$6,'in_stock','new','inventory_location',$3)`,
    [serializedUnitId, companyId, locationId, serializedReceiptId, serializedReceiptLineId, `CP-SERIAL-${suffix}`],
  );
  await query(
    `insert into inventory_items(
       company_id,location_id,catalog_part_id,normalized_part_number,part_number,description,
       quantity_on_hand,quantity_reserved,uom_code,source_provider,external_id
     ) values($1,$2,$3,$4,$5,'Serialized priced part',1,0,'ea','local',$6)`,
    [companyId, locationId, serializedPartId, `SERIAL${suffix}`, `SERIAL-${suffix}`, `serial:${suffix}`],
  );
  await placeSerializedUnit({
    companyId,
    locationId,
    catalogPartId: serializedPartId,
    unitId: serializedUnitId,
    actorId,
    receiptId: serializedReceiptId,
    suffix,
  });

  async function receiveAggregateBatch(label, quantity, unitCost, receivedAt) {
    const runId = randomUUID();
    const receiptId = randomUUID();
    const lineId = randomUUID();
    const draft = {
      invoiceNumber: { value: label },
      vendorName: { value: "Create pricing vendor" },
      currency: { value: "USD" },
      lines: [{
        partNumber: { value: `AGGREGATE-${suffix}` },
        quantity: { value: quantity },
        unitPrice: { value: unitCost },
      }],
    };
    await query(
      `insert into invoice_extraction_runs(
         id,company_id,location_id,created_by,reviewed_by,document_hash,file_name,mime_type,
         byte_size,idempotency_key,status,provider,model,prompt_version,reviewed_draft,reviewed_at,created_at
       ) values($1,$2,$3,$4,$4,$5,$6,'application/pdf',1,$7,'reviewed','integration',
         'integration','integration-v1',$8::jsonb,now(),$9)`,
      [runId, companyId, locationId, actorId, digest(`aggregate-document-${label}-${suffix}`), `${label}.pdf`,
        `aggregate-run-${label}-${suffix}`, JSON.stringify(draft), receivedAt],
    );
    const posted = await postLocalInventoryReceipt({
      receiptId,
      runId,
      actorId,
      companyIds: [companyId],
      locationIds: [locationId],
      idempotencyKey: `aggregate-receipt-${label}-${suffix}`,
      requestHash: digest(`aggregate-receipt-${label}-${suffix}`),
      reviewedRunVersion: 1,
      physicalConfirmation: "all_received_undamaged",
      confirmationHash: digest(`aggregate-confirmation-${label}-${suffix}`),
      labelBatchId: null,
      postingRoute: "no_purchase_order",
      noPurchaseOrderReason: "Create Workorder pricing integration fixture",
      lines: [{
        id: lineId,
        lineIndex: 0,
        catalogPartId: aggregatePartId,
        normalizedPartNumber: `AGGREGATE${suffix}`,
        partNumber: `AGGREGATE-${suffix}`,
        description: "Aggregate priced part",
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
    assert.equal(posted.kind, "posted");
    await query(
      "update inventory_aggregate_cost_layers set received_at=$3 where company_id=$1 and receipt_line_id=$2",
      [companyId, lineId, receivedAt],
    );
    return { lineId };
  }

  const oldBatch = await receiveAggregateBatch(`OLD-${suffix}`, 10, 10, "2026-08-01T12:00:00Z");
  const newBatch = await receiveAggregateBatch(`NEW-${suffix}`, 5, 20, "2026-09-01T12:00:00Z");
  const initialAggregateLayers = (await query(
    `select layer.id,layer.receipt_line_id,layer.received_at,placement.position_id
       from inventory_aggregate_cost_layers layer
       join inventory_aggregate_cost_layer_positions placement
         on placement.company_id=layer.company_id and placement.cost_layer_id=layer.id
      where layer.company_id=$1 and layer.location_id=$2 and layer.catalog_part_id=$3
      order by layer.received_at,layer.id`,
    [companyId, locationId, aggregatePartId],
  )).rows;
  assert.equal(initialAggregateLayers.length, 2);
  assert.equal(new Set(initialAggregateLayers.map((row) => row.position_id)).size, 1,
    "both FCFS batches must be physically available at the selected pickup position");
  const aggregatePositionId = initialAggregateLayers[0].position_id;
  const otherPositionId = randomUUID();
  await query(
    `insert into inventory_positions(
       id,company_id,location_id,code,name,kind,usage,can_store,is_pickable,created_by
     ) values($1,$2,$3,$4,'Create pricing overflow bin','bin','storage',true,true,$5)`,
    [otherPositionId, companyId, locationId, `OVERFLOW-${suffix}`, actorId],
  );
  const aggregateItem = (await query(
    `select item.id,balance.version
       from inventory_items item
       join inventory_position_balances balance
         on balance.company_id=item.company_id and balance.inventory_item_id=item.id
      where item.company_id=$1 and item.location_id=$2 and item.catalog_part_id=$3
        and balance.position_id=$4`,
    [companyId, locationId, aggregatePartId, aggregatePositionId],
  )).rows[0];
  const split = await moveInventoryStock({
    partId: aggregatePartId,
    locationId,
    companyIds: [companyId],
    locationIds: [locationId],
    isAdmin: false,
    actorId,
    move: {
      fromPositionId: aggregatePositionId,
      toPositionId: otherPositionId,
      quantity: 9,
      expectedSourceVersion: aggregateItem.version,
      expectedDestinationVersion: null,
      idempotencyKey: `create-pricing-split-${suffix}`,
      reason: "Prove FCFS price parity when an older batch is split across bins",
    },
  });
  assert.equal(split.kind, "moved");
  const aggregateLayers = (await query(
    `select layer.id,layer.receipt_line_id,layer.received_at,placement.position_id,
            placement.quantity_on_hand
       from inventory_aggregate_cost_layers layer
       join inventory_aggregate_cost_layer_positions placement
         on placement.company_id=layer.company_id and placement.cost_layer_id=layer.id
      where layer.company_id=$1 and layer.location_id=$2 and layer.catalog_part_id=$3
        and placement.position_id=$4
      order by layer.received_at,layer.id`,
    [companyId, locationId, aggregatePartId, aggregatePositionId],
  )).rows;
  assert.deepEqual(aggregateLayers.map((row) => Number(row.quantity_on_hand)), [1, 5],
    "the selected bin must retain one old-batch unit and five new-batch units");

  if (aggregateSelection === "selling_price") {
    const policy = await appendInventorySellingPolicy({
      catalogPartId: aggregatePartId,
      locationId,
      expectedVersion: 0,
      method: "markup_percent",
      value: "25",
      currency: null,
      reason: "Create Workorder integration selling policy",
      companyIds: [companyId],
      locationIds: [locationId],
      isAdmin: false,
      actorId,
      idempotencyKey: `create-pricing-policy-${suffix}`,
      requestHash: digest(`create-pricing-policy-${suffix}`),
    });
    assert.equal(policy.kind, "saved");
  }

  const input = {
    companyId,
    locationId,
    assetId,
    createdByUserId: actorId,
    createdByRole: "office",
    concern: "Create Workorder with exact prices",
    officeNotes: "",
    mechanicUserIds: [],
    formData: {
      laborProduct: { productId: laborProductId, name: "Create pricing labor" },
      laborHours: "2.50",
      parts: [
        {
          catalogPartId: serializedPartId,
          partNo: `SERIAL-${suffix}`,
          description: "Serialized priced part",
          qty: "1",
          uomCode: "ea",
          repairOrder: "Install exact serialized part",
          trackingMode: "serialized",
        },
        {
          catalogPartId: aggregatePartId,
          partNo: `AGGREGATE-${suffix}`,
          description: "Aggregate priced part",
          qty: "4",
          uomCode: "ea",
          repairOrder: "Install four FCFS parts",
          trackingMode: "quantity",
          sourcePositionId: aggregatePositionId,
        },
      ],
    },
    inventoryUnitSelections: [{ partIndex: 0, catalogPartId: serializedPartId, unitIds: [serializedUnitId] }],
    inventoryPositionSelections: [{ partIndex: 1, catalogPartId: aggregatePartId, positionId: aggregatePositionId }],
    pricing: {
      parts: [
        { partIndex: 0, selection: "batch_cost" },
        { partIndex: 1, selection: aggregateSelection },
      ],
      labor: { selection: "internal_cost" },
    },
  };

  return {
    suffix,
    actorId,
    companyId,
    locationId,
    assetId,
    laborProductId,
    serializedPartId,
    aggregatePartId,
    serializedReceiptLineId,
    serializedUnitId,
    aggregatePositionId,
    aggregateLayers,
    oldBatch,
    newBatch,
    laborRate,
    input,
  };
}

async function cleanupFixture(fixture) {
  if (!fixture?.companyId) return;
  const { companyId, actorId } = fixture;
  await query("delete from workorder_part_price_snapshot_allocations where company_id=$1", [companyId]).catch(() => {});
  await query("delete from workorder_part_price_snapshots where company_id=$1", [companyId]).catch(() => {});
  await query("delete from workorder_labor_price_snapshots where company_id=$1", [companyId]).catch(() => {});
  await query("delete from inventory_unit_events where company_id=$1", [companyId]).catch(() => {});
  await query("delete from inventory_aggregate_usage_position_allocations where company_id=$1", [companyId]).catch(() => {});
  await query("delete from inventory_aggregate_usage_cost_allocations where company_id=$1", [companyId]).catch(() => {});
  await query("delete from workorder_aggregate_part_usage_events where company_id=$1", [companyId]).catch(() => {});
  await query("delete from workorder_aggregate_part_usages where company_id=$1", [companyId]).catch(() => {});
  await query("delete from workorder_serialized_part_usages where company_id=$1", [companyId]).catch(() => {});
  await query(
    "delete from workorder_status_events where workorder_id in (select id from operational_workorders where company_id=$1)",
    [companyId],
  ).catch(() => {});
  await query("delete from operational_workorders where company_id=$1", [companyId]).catch(() => {});
  await query("delete from workorder_serial_counters where company_id=$1", [companyId]).catch(() => {});
  await query("delete from inventory_part_selling_policy_versions where company_id=$1", [companyId]).catch(() => {});
  await query("delete from labor_rate_versions where company_id=$1", [companyId]).catch(() => {});
  await query("delete from local_labor_products where company_id=$1", [companyId]).catch(() => {});
  await query("delete from inventory_aggregate_cost_layer_revisions where company_id=$1", [companyId]).catch(() => {});
  await query("delete from inventory_position_movements where company_id=$1", [companyId]).catch(() => {});
  await query("delete from inventory_position_operations where company_id=$1", [companyId]).catch(() => {});
  await query("delete from inventory_aggregate_cost_layer_positions where company_id=$1", [companyId]).catch(() => {});
  await query("delete from inventory_aggregate_cost_layers where company_id=$1", [companyId]).catch(() => {});
  await query("delete from inventory_position_balances where company_id=$1", [companyId]).catch(() => {});
  await query("delete from inventory_serialized_units where company_id=$1", [companyId]).catch(() => {});
  await query("delete from inventory_positions where company_id=$1", [companyId]).catch(() => {});
  await query("delete from inventory_stock_movements where company_id=$1", [companyId]).catch(() => {});
  await query("delete from local_inventory_receipt_lines where company_id=$1", [companyId]).catch(() => {});
  await query("delete from local_inventory_receipts where company_id=$1", [companyId]).catch(() => {});
  await query("delete from inventory_receipt_lines where company_id=$1", [companyId]).catch(() => {});
  await query("delete from inventory_receipts where company_id=$1", [companyId]).catch(() => {});
  await query("delete from inventory_items where company_id=$1", [companyId]).catch(() => {});
  await query("delete from invoice_extraction_runs where company_id=$1", [companyId]).catch(() => {});
  await query("delete from assets where company_id=$1", [companyId]).catch(() => {});
  await query("delete from parts_catalog where company_id=$1", [companyId]).catch(() => {});
  await query("delete from locations where company_id=$1", [companyId]).catch(() => {});
  await query("delete from companies where id=$1", [companyId]).catch(() => {});
  await query("delete from user_profiles where id=$1", [actorId]).catch(() => {});
}

async function assertNoCreateSideEffects(fixture) {
  const { companyId, serializedUnitId, aggregatePartId, locationId } = fixture;
  const state = (await query(
    `select
       (select count(*)::int from operational_workorders where company_id=$1) workorders,
       (select count(*)::int from workorder_serialized_part_usages where company_id=$1) serialized_usages,
       (select count(*)::int from workorder_aggregate_part_usages where company_id=$1) aggregate_usages,
       (select count(*)::int from workorder_part_price_snapshots where company_id=$1) part_prices,
       (select count(*)::int from workorder_labor_price_snapshots where company_id=$1) labor_prices,
       (select status from inventory_serialized_units where company_id=$1 and id=$2) serialized_status,
       (select quantity_reserved from inventory_items
         where company_id=$1 and location_id=$3 and catalog_part_id=$4) aggregate_reserved`,
    [companyId, serializedUnitId, locationId, aggregatePartId],
  )).rows[0];
  assert.deepEqual(state, {
    workorders: 0,
    serialized_usages: 0,
    aggregate_usages: 0,
    part_prices: 0,
    labor_prices: 0,
    serialized_status: "in_stock",
    aggregate_reserved: "0.000",
  });
  assert.equal(Number((await query(
    `select coalesce(sum(quantity_reserved),0) quantity_reserved
       from inventory_position_balances where company_id=$1 and catalog_part_id=$2`,
    [companyId, aggregatePartId],
  )).rows[0].quantity_reserved), 0);
}

function persistedPartPrice(row, allocations = []) {
  return {
    selection: row.selection,
    unitPrice: String(row.unit_price),
    baseUnitPrice: row.base_unit_price === null ? null : String(row.base_unit_price),
    manualOverride: row.manual_override,
    quantity: String(row.quantity),
    totalPrice: String(row.total_price),
    currency: row.currency,
    receiptLineId: row.receipt_line_id || null,
    sellingPolicyVersionId: row.selling_policy_version_id || null,
    allocations: allocations.map((allocation) => ({
      costLayerId: allocation.cost_layer_id,
      receiptLineId: allocation.receipt_line_id || null,
      quantity: String(allocation.quantity),
      unitPrice: String(allocation.unit_price),
      totalPrice: String(allocation.total_price),
      currency: allocation.currency,
    })),
  };
}

function persistedLaborPrice(row) {
  return {
    selection: row.selection,
    productId: row.labor_product_id,
    rateVersionId: row.rate_version_id,
    hours: String(row.hours),
    unitPrice: String(row.unit_price),
    baseUnitPrice: row.base_unit_price === null ? null : String(row.base_unit_price),
    manualOverride: row.manual_override,
    totalPrice: String(row.total_price),
    currency: row.currency,
  };
}

test("Create Workorder commits exact serialized, FCFS aggregate, and labor snapshots with preview fingerprint parity", { skip: !enabled }, async () => {
  let fixture;
  try {
    fixture = await createFixture();
    await assert.rejects(
      () => createOperationalWorkorder({ ...fixture.input, pricing: undefined }),
      (error) => error instanceof WorkorderLifecycleConflictError
        && error.code === "WORKORDER_PRICING_REQUIRED",
    );
    await assertNoCreateSideEffects(fixture);
    const preview = await readCreatePricing(fixture.input);
    assert.equal(preview.parts[0].price.receiptLineId, fixture.serializedReceiptLineId);
    assert.equal(preview.parts[0].price.unitPrice, "37.5000");
    assert.equal(preview.parts[0].price.totalPrice, "37.5000");
    assert.deepEqual(preview.parts[1].price.allocations.map((allocation) => ({
      receiptLineId: allocation.receiptLineId,
      quantity: allocation.quantity,
      totalPrice: allocation.totalPrice,
    })), [
      { receiptLineId: fixture.oldBatch.lineId, quantity: "1.000", totalPrice: "10.0000" },
      { receiptLineId: fixture.newBatch.lineId, quantity: "3.000", totalPrice: "60.0000" },
    ]);
    assert.equal(preview.parts[1].price.unitPrice, "17.5000");
    assert.equal(preview.parts[1].price.totalPrice, "70.0000");
    assert.equal(preview.labor.price.rateVersionId, fixture.laborRate.rate.id);
    assert.equal(preview.labor.price.totalPrice, "75.0000");

    const createInput = {
      ...fixture.input,
      pricing: { ...fixture.input.pricing, expectedFingerprint: preview.fingerprint },
    };
    const created = await createOperationalWorkorder(createInput);
    const partRows = (await query(
      "select * from workorder_part_price_snapshots where company_id=$1 and workorder_id=$2 order by serialized_usage_id nulls last",
      [fixture.companyId, created.id],
    )).rows;
    const serializedPriceRow = partRows.find((row) => row.serialized_usage_id);
    const aggregatePriceRow = partRows.find((row) => row.aggregate_usage_id);
    const aggregateAllocations = (await query(
      `select allocation.*
         from workorder_part_price_snapshot_allocations allocation
         join inventory_aggregate_cost_layers layer
           on layer.company_id=allocation.company_id and layer.id=allocation.cost_layer_id
        where allocation.company_id=$1 and allocation.snapshot_id=$2
        order by layer.received_at,layer.id`,
      [fixture.companyId, aggregatePriceRow.id],
    )).rows;
    const laborRow = (await query(
      "select * from workorder_labor_price_snapshots where company_id=$1 and workorder_id=$2",
      [fixture.companyId, created.id],
    )).rows[0];
    const actualFingerprint = createPricingFingerprint(createInput, [
      { partIndex: 0, price: persistedPartPrice(serializedPriceRow) },
      { partIndex: 1, price: persistedPartPrice(aggregatePriceRow, aggregateAllocations) },
    ], { price: persistedLaborPrice(laborRow) });
    assert.equal(actualFingerprint, preview.fingerprint,
      "the immutable snapshots committed from actual reservations must match the reviewed preview evidence");

    assert.equal(partRows.length, 2);
    assert.equal(serializedPriceRow.receipt_line_id, fixture.serializedReceiptLineId);
    assert.equal(serializedPriceRow.total_price, "37.5000");
    assert.equal(aggregatePriceRow.total_price, "70.0000");
    assert.deepEqual(aggregateAllocations.map((allocation) => ({
      receiptLineId: allocation.receipt_line_id,
      quantity: allocation.quantity,
      totalPrice: allocation.total_price,
    })).sort((left, right) => left.quantity.localeCompare(right.quantity)), [
      { receiptLineId: fixture.oldBatch.lineId, quantity: "1.000", totalPrice: "10.0000" },
      { receiptLineId: fixture.newBatch.lineId, quantity: "3.000", totalPrice: "60.0000" },
    ]);
    assert.equal(laborRow.rate_version_id, fixture.laborRate.rate.id);
    assert.equal(laborRow.total_price, "75.0000");

    const atomic = (await query(
      `select
         (select count(*)::int from operational_workorders where company_id=$1 and id=$2) workorders,
         (select count(*)::int from workorder_serialized_part_usages where company_id=$1 and workorder_id=$2 and status='reserved') serialized_usages,
         (select count(*)::int from workorder_aggregate_part_usages where company_id=$1 and workorder_id=$2 and status='reserved') aggregate_usages,
         (select count(*)::int from workorder_part_price_snapshots where company_id=$1 and workorder_id=$2) part_prices,
         (select count(*)::int from workorder_labor_price_snapshots where company_id=$1 and workorder_id=$2) labor_prices`,
      [fixture.companyId, created.id],
    )).rows[0];
    assert.deepEqual(atomic, {
      workorders: 1,
      serialized_usages: 1,
      aggregate_usages: 1,
      part_prices: 2,
      labor_prices: 1,
    });
  } finally {
    await cleanupFixture(fixture);
  }
});

test("Create Workorder saves one-order part and labor overrides with immutable base prices and Activity evidence", { skip: !enabled }, async () => {
  let fixture;
  try {
    fixture = await createFixture();
    const overrideInput = {
      ...fixture.input,
      pricing: {
        parts: [
          { partIndex: 0, selection: "batch_cost", customUnitPrice: "42.2500" },
          { partIndex: 1, selection: "batch_cost", customUnitPrice: "24.0000" },
        ],
        labor: { selection: "internal_cost", customUnitPrice: "45.0000" },
      },
    };
    const preview = await readCreatePricing(overrideInput);
    assert.equal(preview.parts[0].price.baseUnitPrice, "37.5000");
    assert.equal(preview.parts[0].price.unitPrice, "42.2500");
    assert.equal(preview.parts[0].price.manualOverride, true);
    assert.equal(preview.parts[1].price.baseUnitPrice, "17.5000");
    assert.equal(preview.parts[1].price.unitPrice, "24.0000");
    assert.equal(preview.parts[1].price.totalPrice, "96.0000");
    assert.equal(preview.labor.price.baseUnitPrice, "30.0000");
    assert.equal(preview.labor.price.unitPrice, "45.0000");
    assert.equal(preview.labor.price.totalPrice, "112.5000");

    const created = await createOperationalWorkorder({
      ...overrideInput,
      pricing: { ...overrideInput.pricing, expectedFingerprint: preview.fingerprint },
    });
    const partRows = (await query(
      `select case when serialized_usage_id is not null then 0 else 1 end part_index,
              selection,base_unit_price,unit_price,total_price,manual_override
         from workorder_part_price_snapshots
        where company_id=$1 and workorder_id=$2
        order by serialized_usage_id nulls last`,
      [fixture.companyId, created.id],
    )).rows;
    assert.deepEqual(partRows, [
      { part_index: 0, selection: "batch_cost", base_unit_price: "37.5000", unit_price: "42.2500", total_price: "42.2500", manual_override: true },
      { part_index: 1, selection: "batch_cost", base_unit_price: "17.5000", unit_price: "24.0000", total_price: "96.0000", manual_override: true },
    ]);
    const laborRow = (await query(
      `select selection,base_unit_price,unit_price,total_price,manual_override
         from workorder_labor_price_snapshots
        where company_id=$1 and workorder_id=$2`,
      [fixture.companyId, created.id],
    )).rows[0];
    assert.deepEqual(laborRow, {
      selection: "internal_cost",
      base_unit_price: "30.0000",
      unit_price: "45.0000",
      total_price: "112.5000",
      manual_override: true,
    });
    const events = (await query(
      `select field_key,field_label,old_value,new_value,changed_by_user_id
         from workorder_field_events
        where workorder_id=$1 and field_key like 'pricing.%'
        order by field_key`,
      [created.id],
    )).rows;
    assert.deepEqual(events, [
      {
        field_key: "pricing.labor",
        field_label: "Labor price",
        old_value: "$30.00 internal price",
        new_value: "$45.00 custom price",
        changed_by_user_id: fixture.actorId,
      },
      {
        field_key: "pricing.part.0",
        field_label: `${fixture.input.formData.parts[0].partNo} price`,
        old_value: "$37.50 internal price",
        new_value: "$42.25 custom price",
        changed_by_user_id: fixture.actorId,
      },
      {
        field_key: "pricing.part.1",
        field_label: `${fixture.input.formData.parts[1].partNo} price`,
        old_value: "$17.50 internal price",
        new_value: "$24.00 custom price",
        changed_by_user_id: fixture.actorId,
      },
    ]);
  } finally {
    await cleanupFixture(fixture);
  }
});

test("Create pricing preview never leaks batch or labor prices across tenant or shop scope", { skip: !enabled }, async () => {
  let fixture;
  try {
    fixture = await createFixture();
    const otherLocationId = randomUUID();
    await query("insert into locations(id,company_id,name) values($1,$2,'Other create pricing shop')",
      [otherLocationId, fixture.companyId]);
    for (const scope of [
      { companyId: fixture.companyId, locationId: otherLocationId },
      { companyId: randomUUID(), locationId: fixture.locationId },
    ]) {
      const preview = await readCreatePricing({ ...fixture.input, ...scope });
      assert.deepEqual(preview.parts.map((part) => part.status), ["incomplete", "incomplete"]);
      assert.ok(preview.parts.every((part) => part.price === null));
      assert.equal(preview.labor.price, null);
      assert.equal(preview.summary.status, "incomplete");
    }
  } finally {
    await cleanupFixture(fixture);
  }
});

test("stale Create Workorder pricing evidence returns a lifecycle conflict and rolls back the whole create", { skip: !enabled }, async (t) => {
  const variants = [
    {
      name: "labor rate",
      setup: {},
      mutate: async (fixture) => {
        const changed = await appendLaborRateVersion({
          companyId: fixture.companyId,
          locationId: fixture.locationId,
          productId: fixture.laborProductId,
          priceKind: "internal_cost",
          expectedVersion: 1,
          amount: "31.0000",
          currency: "USD",
          reason: "Changed after Create preview",
          actorId: fixture.actorId,
          idempotencyKey: `stale-rate-${fixture.suffix}`,
          requestHash: digest(`stale-rate-${fixture.suffix}`),
        });
        assert.equal(changed.kind, "saved");
      },
    },
    {
      name: "selling policy",
      setup: { aggregateSelection: "selling_price" },
      mutate: async (fixture) => {
        const changed = await appendInventorySellingPolicy({
          catalogPartId: fixture.aggregatePartId,
          locationId: fixture.locationId,
          expectedVersion: 1,
          method: "markup_percent",
          value: "30",
          currency: null,
          reason: "Changed after Create preview",
          companyIds: [fixture.companyId],
          locationIds: [fixture.locationId],
          isAdmin: false,
          actorId: fixture.actorId,
          idempotencyKey: `stale-policy-${fixture.suffix}`,
          requestHash: digest(`stale-policy-${fixture.suffix}`),
        });
        assert.equal(changed.kind, "saved");
      },
    },
    {
      name: "batch cost",
      setup: {},
      mutate: async (fixture) => {
        const changed = await appendInventoryBatchCostRevision({
          costLayerId: fixture.aggregateLayers[0].id,
          expectedVersion: 0,
          unitCost: "11.0000",
          currency: "USD",
          reason: "Changed after Create preview",
          companyIds: [fixture.companyId],
          locationIds: [fixture.locationId],
          isAdmin: false,
          actorId: fixture.actorId,
          idempotencyKey: `stale-cost-${fixture.suffix}`,
          requestHash: digest(`stale-cost-${fixture.suffix}`),
        });
        assert.equal(changed.kind, "saved");
      },
    },
    {
      name: "FCFS batch order",
      setup: {},
      mutate: async (fixture) => {
        await query(
          `update inventory_aggregate_cost_layers
              set received_at=case when receipt_line_id=$2 then '2026-10-01T12:00:00Z'::timestamptz
                                   else '2026-07-01T12:00:00Z'::timestamptz end
            where company_id=$1 and catalog_part_id=$3`,
          [fixture.companyId, fixture.oldBatch.lineId, fixture.aggregatePartId],
        );
      },
    },
  ];

  for (const variant of variants) {
    await t.test(variant.name, async () => {
      let fixture;
      try {
        fixture = await createFixture(variant.setup);
        const preview = await readCreatePricing(fixture.input);
        await variant.mutate(fixture);
        await assert.rejects(
          createOperationalWorkorder({
            ...fixture.input,
            pricing: { ...fixture.input.pricing, expectedFingerprint: preview.fingerprint },
          }),
          (error) => error instanceof WorkorderLifecycleConflictError
            && error.statusCode === 409
            && error.code === "WORKORDER_PRICING_CHANGED",
        );
        await assertNoCreateSideEffects(fixture);
      } finally {
        await cleanupFixture(fixture);
      }
    });
  }
});
