import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { closePool, getPool, query } from "../../db/pool.js";
import {
  consumeAggregateUsagesForApproval,
  markAggregateUsagesPending,
  releaseOrReverseAggregateWorkorderUsage,
  reserveAggregateWorkorderUsage,
} from "../../db/repositories/inventory-aggregate-workorder-usage.repo.js";

const runPostgres = process.env.RUN_POSTGRES_INTEGRATION === "1";
after(async () => { if (runPostgres) await closePool(); });
const digest = (value) => createHash("sha256").update(value).digest("hex");

test("real PostgreSQL serializes measured reservations and consumes, adjusts, and reverses exactly once", { skip: !runPostgres }, async () => {
  const suffix = randomUUID().replaceAll("-", "");
  const actorId = randomUUID(); const companyId = randomUUID(); const locationId = randomUUID();
  const assetId = randomUUID(); const workorderId = randomUUID(); const catalogPartId = randomUUID();
  const scope = { workorderId, catalogPartId, companyIds: [companyId], locationIds: [locationId], isAdmin: false, actorId };
  try {
    await query("insert into user_profiles (id,display_name) values ($1,'Aggregate integration')", [actorId]);
    await query("insert into companies (id,slug,name) values ($1,$2,'Aggregate integration')", [companyId, `aggregate-${suffix}`]);
    await query("insert into locations (id,company_id,name) values ($1,$2,'Aggregate shop')", [locationId, companyId]);
    await query("insert into assets (id,company_id,location_id,provider,name,unit_no) values ($1,$2,$3,'manual','Truck',$4)", [assetId, companyId, locationId, `A-${suffix}`]);
    await query(`insert into operational_workorders
      (id,company_id,serial,asset_id,location_id,created_by_user_id,concern,status)
      values ($1,$2,$3,$4,$5,$6,'Measured usage','in_progress')`,
    [workorderId, companyId, `WO-A-${suffix}`, assetId, locationId, actorId]);
    await query(`insert into parts_catalog
      (id,company_id,normalized_part_number,part_number,description,uom_code)
      values ($1,$2,$3,$4,'Bulk coolant','gal')`, [catalogPartId, companyId, `COOLANT${suffix}`, `COOLANT-${suffix}`]);
    await query(`insert into inventory_items
      (company_id,location_id,catalog_part_id,normalized_part_number,part_number,description,
       quantity_on_hand,quantity_reserved,uom_code,source_provider,external_id)
      values ($1,$2,$3,$4,$5,'Bulk coolant',10,0,'gal','local',$6)`,
    [companyId, locationId, catalogPartId, `COOLANT${suffix}`, `COOLANT-${suffix}`, `aggregate:${suffix}`]);

    const command = { ...scope, quantity: 6, uomCode: "gal", repairOrder: "Fill coolant",
      idempotencyKey: `aggregate-a-${suffix}`, requestHash: digest("a") };
    const replay = await Promise.all([reserveAggregateWorkorderUsage(command), reserveAggregateWorkorderUsage(command)]);
    assert.deepEqual(replay.map((item) => item.kind).sort(), ["replay", "reserved"]);
    const usage = replay.find((item) => item.usage)?.usage;
    const competing = await reserveAggregateWorkorderUsage({ ...command, idempotencyKey: `aggregate-b-${suffix}`, requestHash: digest("b") });
    assert.equal(competing.kind, "insufficient_stock");

    const client = await getPool().connect();
    try {
      await client.query("begin");
      await markAggregateUsagesPending(client, { workorderId, companyId, actorId });
      await consumeAggregateUsagesForApproval(client, { workorderId, companyId, actorId });
      await client.query("commit");
    } finally { client.release(); }
    assert.deepEqual((await query("select quantity_on_hand,quantity_reserved from inventory_items where company_id=$1 and catalog_part_id=$2", [companyId, catalogPartId])).rows[0],
      { quantity_on_hand: "4.000", quantity_reserved: "0.000" });

    const adjusted = await releaseOrReverseAggregateWorkorderUsage({ ...scope, usageId: usage.id,
      action: "adjust", targetQuantity: 7, reason: "Verified amount", idempotencyKey: `adjust-${suffix}`, requestHash: digest("adjust") });
    assert.equal(adjusted.kind, "adjusted");
    assert.equal((await query("select quantity_on_hand from inventory_items where company_id=$1 and catalog_part_id=$2", [companyId, catalogPartId])).rows[0].quantity_on_hand, "3.000");
    const reversed = await releaseOrReverseAggregateWorkorderUsage({ ...scope, usageId: usage.id,
      action: "reverse", reason: "Approved correction", idempotencyKey: `reverse-${suffix}`, requestHash: digest("reverse") });
    assert.equal(reversed.kind, "reversed");
    assert.equal((await query("select quantity_on_hand from inventory_items where company_id=$1 and catalog_part_id=$2", [companyId, catalogPartId])).rows[0].quantity_on_hand, "10.000");
    const evidence = await query(`select event_type,quantity_delta from workorder_aggregate_part_usage_events
      where company_id=$1 and usage_id=$2 order by event_ordinal`, [companyId, usage.id]);
    assert.deepEqual(evidence.rows.map((row) => [row.event_type, row.quantity_delta]), [
      ["reserved", "6.000"], ["installed_pending_approval", "0.000"], ["consumed", "-6.000"],
      ["adjusted", "-1.000"], ["reversed", "7.000"],
    ]);
  } finally {
    await query("delete from inventory_stock_movements where company_id=$1", [companyId]).catch(() => {});
    await query("delete from workorder_aggregate_part_usage_events where company_id=$1", [companyId]).catch(() => {});
    await query("delete from workorder_aggregate_part_usages where company_id=$1", [companyId]).catch(() => {});
    await query("delete from inventory_items where company_id=$1", [companyId]).catch(() => {});
    await query("delete from operational_workorders where company_id=$1", [companyId]).catch(() => {});
    await query("delete from assets where company_id=$1", [companyId]).catch(() => {});
    await query("delete from parts_catalog where company_id=$1", [companyId]).catch(() => {});
    await query("delete from locations where company_id=$1", [companyId]).catch(() => {});
    await query("delete from companies where id=$1", [companyId]).catch(() => {});
    await query("delete from user_profiles where id=$1", [actorId]).catch(() => {});
  }
});
