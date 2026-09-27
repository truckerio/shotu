import { createHash, randomUUID } from "node:crypto";
import { closePool, query } from "../pool.js";
import { postLocalInventoryReceipt } from "../repositories/local-inventory.repo.js";
import { reserveAggregateWorkorderUsage } from "../repositories/inventory-aggregate-workorder-usage.repo.js";
import { appendInventorySellingPolicy } from "../repositories/inventory-selling-policies.repo.js";
import { saveWorkorderPartPriceSnapshot } from "../repositories/workorder-part-pricing.repo.js";

const DEMO_PART_NUMBER = "DEMO-FCFS-FILTER";
const DEMO_WORKORDER_SERIAL = "WO-DEMO-FCFS";
const hash = (value) => createHash("sha256").update(String(value)).digest("hex");

function assertLocalDatabase() {
  const database = new URL(process.env.DATABASE_URL);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname)) {
    throw new Error("Batch-cost demo data may only be seeded into a local database.");
  }
}

async function seed() {
  assertLocalDatabase();
  const context = (await query(
    `select actor.id actor_id,company.id company_id,location.id location_id
     from user_profiles actor
     join user_company_memberships membership on membership.user_id=actor.id and membership.active
     join companies company on company.id=membership.company_id
     join locations location on location.company_id=company.id and location.active
     where actor.display_name='Admin Demo' and location.name='Chino Yard'
     order by membership.created_at limit 1`,
  )).rows[0];
  if (!context) throw new Error("Admin Demo at Chino Yard is required. Run the normal demo-user seeds first.");

  let part = (await query(
    "select * from parts_catalog where company_id=$1 and normalized_part_number=$2",
    [context.company_id, DEMO_PART_NUMBER],
  )).rows[0];
  if (!part) {
    part = (await query(
      `insert into parts_catalog(company_id,normalized_part_number,part_number,description,uom_code,tracking_mode)
       values($1,$2,$2,'Demo FCFS filter — two invoice costs','ea','quantity') returning *`,
      [context.company_id, DEMO_PART_NUMBER],
    )).rows[0];
  }

  await appendInventorySellingPolicy({
    catalogPartId: part.id,
    locationId: null,
    expectedVersion: 0,
    method: "markup_percent",
    value: "25",
    currency: null,
    reason: "Demo company default: 25% markup on each FCFS batch",
    companyIds: [context.company_id],
    locationIds: [context.location_id],
    isAdmin: true,
    actorId: context.actor_id,
    idempotencyKey: "demo-fcfs-company-selling-policy",
    requestHash: hash("demo-fcfs-company-selling-policy"),
  });

  const existingWorkorder = (await query(
    "select id from operational_workorders where company_id=$1 and serial=$2",
    [context.company_id, DEMO_WORKORDER_SERIAL],
  )).rows[0];
  if (existingWorkorder) {
    return { ...context, partId: part.id, workorderId: existingWorkorder.id, replayed: true };
  }

  async function receiveBatch({ label, quantity, unitCost, occurredAt }) {
    const runId = randomUUID();
    const lineId = randomUUID();
    const requestHash = hash(`demo-fcfs:${label}:${quantity}:${unitCost}`);
    const reviewedDraft = {
      invoiceNumber: { value: `DEMO-${label}` },
      vendorName: { value: "Demo Fleet Parts" },
      currency: { value: "USD" },
      lines: [{ partNumber: { value: DEMO_PART_NUMBER }, quantity: { value: quantity }, unitPrice: { value: unitCost } }],
    };
    await query(
      `insert into invoice_extraction_runs(
         id,company_id,location_id,created_by,reviewed_by,document_hash,file_name,mime_type,
         byte_size,idempotency_key,status,provider,model,prompt_version,reviewed_draft,reviewed_at,created_at
       ) values($1,$2,$3,$4,$4,$5,$6,'application/pdf',1,$7,'reviewed','demo','demo','demo-v1',$8,now(),$9)`,
      [runId, context.company_id, context.location_id, context.actor_id, hash(`demo-fcfs-document:${label}`),
        `demo-fcfs-${label.toLowerCase()}.pdf`, `demo-fcfs-extract-${label}`, JSON.stringify(reviewedDraft), occurredAt],
    );
    const receipt = await postLocalInventoryReceipt({
      receiptId: randomUUID(),
      runId,
      actorId: context.actor_id,
      companyIds: [context.company_id],
      locationIds: [context.location_id],
      idempotencyKey: `demo-fcfs-receipt-${label}`,
      requestHash,
      reviewedRunVersion: 1,
      physicalConfirmation: "all_received_undamaged",
      confirmationHash: requestHash,
      labelBatchId: null,
      postingRoute: "no_purchase_order",
      noPurchaseOrderReason: "Batch-cost product demo",
      lines: [{
        id: lineId,
        lineIndex: 0,
        catalogPartId: part.id,
        normalizedPartNumber: DEMO_PART_NUMBER,
        partNumber: DEMO_PART_NUMBER,
        description: "Demo FCFS filter — two invoice costs",
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
    if (receipt.kind !== "posted") throw new Error(`Demo receipt ${label} failed: ${receipt.kind}`);
    await query(
      "update inventory_aggregate_cost_layers set received_at=$3 where company_id=$1 and receipt_line_id=$2",
      [context.company_id, lineId, occurredAt],
    );
  }

  await receiveBatch({ label: "OLD-BATCH", quantity: 1, unitCost: 10, occurredAt: "2026-08-01T12:00:00Z" });
  await receiveBatch({ label: "CURRENT-BATCH", quantity: 5, unitCost: 20, occurredAt: "2026-09-01T12:00:00Z" });

  let asset = (await query(
    "select id from assets where company_id=$1 and location_id=$2 order by created_at limit 1",
    [context.company_id, context.location_id],
  )).rows[0];
  if (!asset) {
    asset = (await query(
      `insert into assets(company_id,location_id,provider,name,unit_no)
       values($1,$2,'manual','Demo FCFS truck','DEMO-FCFS') returning id`,
      [context.company_id, context.location_id],
    )).rows[0];
  }
  const workorderId = randomUUID();
  await query(
    `insert into operational_workorders(id,company_id,serial,asset_id,location_id,created_by_user_id,concern,status)
     values($1,$2,$3,$4,$5,$6,'Demo: four filters span two receipt costs','in_progress')`,
    [workorderId, context.company_id, DEMO_WORKORDER_SERIAL, asset.id, context.location_id, context.actor_id],
  );
  const positionId = (await query(
    `select position.id from inventory_positions position
     join inventory_position_balances balance on balance.company_id=position.company_id and balance.position_id=position.id
     where position.company_id=$1 and position.location_id=$2 and balance.catalog_part_id=$3
     order by position.id limit 1`,
    [context.company_id, context.location_id, part.id],
  )).rows[0]?.id;
  if (!positionId) throw new Error("Demo receipt position was not created.");
  const reserved = await reserveAggregateWorkorderUsage({
    workorderId,
    catalogPartId: part.id,
    sourcePositionId: positionId,
    quantity: 4,
    uomCode: "ea",
    repairOrder: "Replace four filters",
    companyIds: [context.company_id],
    locationIds: [context.location_id],
    isAdmin: true,
    actorId: context.actor_id,
    idempotencyKey: "demo-fcfs-workorder-reservation",
    requestHash: hash("demo-fcfs-workorder-reservation"),
  });
  if (reserved.kind !== "reserved") throw new Error(`Demo reservation failed: ${reserved.kind}`);
  await appendInventorySellingPolicy({
    catalogPartId: part.id,
    locationId: context.location_id,
    expectedVersion: 0,
    method: "markup_percent",
    value: "25",
    currency: null,
    reason: "Demo 25% markup on each FCFS batch",
    companyIds: [context.company_id],
    locationIds: [context.location_id],
    isAdmin: true,
    actorId: context.actor_id,
    idempotencyKey: "demo-fcfs-selling-policy",
    requestHash: hash("demo-fcfs-selling-policy"),
  });
  await saveWorkorderPartPriceSnapshot({
    workorderId,
    usageKind: "aggregate",
    usageId: reserved.usage.id,
    selection: "batch_cost",
    reason: "Demo exact FCFS batch cost",
    companyIds: [context.company_id],
    locationIds: [context.location_id],
    isAdmin: true,
    actorId: context.actor_id,
    idempotencyKey: "demo-fcfs-batch-price",
    requestHash: hash("demo-fcfs-batch-price"),
  });
  await saveWorkorderPartPriceSnapshot({
    workorderId,
    usageKind: "aggregate",
    usageId: reserved.usage.id,
    selection: "selling_price",
    reason: "Demo 25% FCFS selling price",
    companyIds: [context.company_id],
    locationIds: [context.location_id],
    isAdmin: true,
    actorId: context.actor_id,
    idempotencyKey: "demo-fcfs-selling-price",
    requestHash: hash("demo-fcfs-selling-price"),
  });
  return { ...context, partId: part.id, workorderId, replayed: false };
}

try {
  const result = await seed();
  console.log(JSON.stringify({
    ...result,
    partNumber: DEMO_PART_NUMBER,
    workorderSerial: DEMO_WORKORDER_SERIAL,
    inventoryUrl: `http://localhost:4173/?adminView=inventory&inventorySection=stock&stockMode=part`,
    workorderUrl: `http://localhost:4173/?workorder=${result.workorderId}&section=parts`,
  }, null, 2));
} finally {
  await closePool();
}
