import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { closePool, getPool, query } from "../../db/pool.js";
import {
  consumeAggregateUsagesForApproval,
  markAggregateUsagesPending,
  releaseAggregateUsagesForCancelledWorkorder,
  releaseOrReverseAggregateWorkorderUsage,
  resetAggregateUsagesForRevision,
  reserveAggregateWorkorderUsage,
} from "../../db/repositories/inventory-aggregate-workorder-usage.repo.js";
import { ensureSystemInventoryPosition } from "../../db/repositories/inventory-positions.repo.js";
import { listPartStockMovements } from "../../db/repositories/local-inventory.repo.js";
import { createOperationalWorkorder } from "../../db/repositories/operational-workorders.repo.js";

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
    const inventory = await query(`insert into inventory_items
      (company_id,location_id,catalog_part_id,normalized_part_number,part_number,description,
       quantity_on_hand,quantity_reserved,uom_code,source_provider,external_id)
      values ($1,$2,$3,$4,$5,'Bulk coolant',10,0,'gal','local',$6)`,
    [companyId, locationId, catalogPartId, `COOLANT${suffix}`, `COOLANT-${suffix}`, `aggregate:${suffix}`]);
    const setupClient=await getPool().connect(); let sourcePositionId;
    try{
      await setupClient.query("begin");
      const unassigned=await ensureSystemInventoryPosition(setupClient,{companyId,locationId,systemKey:"unassigned"});
      sourcePositionId=unassigned;
      const item=await setupClient.query(`select id from inventory_items where company_id=$1 and catalog_part_id=$2`,[companyId,catalogPartId]);
      await setupClient.query(`insert into inventory_position_balances(company_id,location_id,position_id,inventory_item_id,catalog_part_id,uom_code,quantity)
        values($1,$2,$3,$4,$5,'gal',10)`,[companyId,locationId,unassigned,item.rows[0].id,catalogPartId]);
      await setupClient.query("commit");
    }finally{setupClient.release();}

    const command = { ...scope, sourcePositionId, quantity: 6, uomCode: "gal", repairOrder: "Fill coolant",
      idempotencyKey: `aggregate-a-${suffix}`, requestHash: digest("a") };
    const replay = await Promise.all([reserveAggregateWorkorderUsage(command), reserveAggregateWorkorderUsage(command)]);
    assert.deepEqual(replay.map((item) => item.kind).sort(), ["replay", "reserved"]);
    const usage = replay.find((item) => item.usage)?.usage;
    assert.deepEqual((await query("select quantity_on_hand,quantity_reserved from inventory_items where company_id=$1 and catalog_part_id=$2", [companyId, catalogPartId])).rows[0],
      { quantity_on_hand: "10.000", quantity_reserved: "6.000" });
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
    await query(`insert into inventory_stock_movements
      (company_id,location_id,catalog_part_id,movement_type,quantity_delta,uom_code,actor_id,reason,idempotency_key)
      values ($1,$2,$3,'adjustment',1,'gal',$4,'Unrelated count correction',$5)`,
    [companyId, locationId, catalogPartId, actorId, `unrelated-count:${suffix}`]);
    const audit = await listPartStockMovements({ catalogPartId, companyIds: [companyId], locationIds: [locationId], isAdmin: false });
    assert.equal(audit.items.length, 2);
    const activity = await listPartStockMovements({ catalogPartId, companyIds: [companyId], locationIds: [locationId], isAdmin: false, view: "workorder" });
    assert.deepEqual(activity.items.map((item) => ({
      type: item.type, quantity: item.quantity, workorderId: item.workorderId,
      workorderSerial: item.workorderSerial,
      assetUnitNo: item.assetUnitNo, repairOrder: item.repairOrder,
    })), [{
      type: "issue", quantity: -6, workorderId,
      workorderSerial: `WO-A-${suffix}`,
      assetUnitNo: `A-${suffix}`, repairOrder: "Fill coolant",
    }]);

    const adjusted = await releaseOrReverseAggregateWorkorderUsage({ ...scope, usageId: usage.id,
      action: "adjust", targetQuantity: 7, reason: "Verified amount", idempotencyKey: `adjust-${suffix}`, requestHash: digest("adjust") });
    assert.equal(adjusted.kind, "adjusted");
    assert.equal((await query("select quantity_on_hand from inventory_items where company_id=$1 and catalog_part_id=$2", [companyId, catalogPartId])).rows[0].quantity_on_hand, "3.000");
    const reversed = await releaseOrReverseAggregateWorkorderUsage({ ...scope, usageId: usage.id,
      action: "reverse", reason: "Approved correction", idempotencyKey: `reverse-${suffix}`, requestHash: digest("reverse") });
    assert.equal(reversed.kind, "reversed");
    assert.equal((await query("select quantity_on_hand from inventory_items where company_id=$1 and catalog_part_id=$2", [companyId, catalogPartId])).rows[0].quantity_on_hand, "10.000");
    const positionState=await query(`select quantity,quantity_reserved from inventory_position_balances where company_id=$1 and catalog_part_id=$2`,[companyId,catalogPartId]);
    assert.deepEqual(positionState.rows[0],{quantity:"10.000",quantity_reserved:"0.000"});
    const evidence = await query(`select event_type,quantity_delta from workorder_aggregate_part_usage_events
      where company_id=$1 and usage_id=$2 order by event_ordinal`, [companyId, usage.id]);
    assert.deepEqual(evidence.rows.map((row) => [row.event_type, row.quantity_delta]), [
      ["reserved", "6.000"], ["installed_pending_approval", "0.000"], ["consumed", "-6.000"],
      ["adjusted", "-1.000"], ["reversed", "7.000"],
    ]);
  } finally {
    await query("delete from inventory_position_movements where company_id=$1",[companyId]).catch(()=>{});
    await query("delete from inventory_position_operations where company_id=$1",[companyId]).catch(()=>{});
    await query("delete from inventory_aggregate_usage_position_allocations where company_id=$1",[companyId]).catch(()=>{});
    await query("delete from inventory_position_balances where company_id=$1",[companyId]).catch(()=>{});
    await query("delete from inventory_positions where company_id=$1",[companyId]).catch(()=>{});
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

test("revision resubmission and cancellation preserve the exact aggregate item in a shared bin", { skip: !runPostgres }, async () => {
  const suffix=randomUUID().replaceAll("-","");const actorId=randomUUID(),companyId=randomUUID(),locationId=randomUUID();
  const assetId=randomUUID(),workorderId=randomUUID(),partA=randomUUID(),partB=randomUUID();
  try{
    await query("insert into user_profiles(id,display_name) values($1,'Aggregate revision')",[actorId]);
    await query("insert into companies(id,slug,name) values($1,$2,'Aggregate revision')",[companyId,`aggregate-revision-${suffix}`]);
    await query("insert into locations(id,company_id,name) values($1,$2,'Revision shop')",[locationId,companyId]);
    await query("insert into assets(id,company_id,location_id,provider,name,unit_no) values($1,$2,$3,'manual','Truck',$4)",[assetId,companyId,locationId,`R-${suffix}`]);
    await query(`insert into operational_workorders(id,company_id,serial,asset_id,location_id,created_by_user_id,concern,status)
      values($1,$2,$3,$4,$5,$6,'Revision lifecycle','in_progress')`,[workorderId,companyId,`WO-R-${suffix}`,assetId,locationId,actorId]);
    await query(`insert into parts_catalog(id,company_id,normalized_part_number,part_number,description,uom_code,tracking_mode)
      values($1,$2,$3,$4,'Part A','ea','quantity'),($5,$2,$6,$7,'Part B','ea','quantity')`,
    [partA,companyId,`A${suffix}`,`A-${suffix}`,partB,`B${suffix}`,`B-${suffix}`]);
    const items=await query(`insert into inventory_items(company_id,location_id,catalog_part_id,normalized_part_number,part_number,description,quantity_on_hand,quantity_reserved,uom_code,source_provider,external_id)
      values($1,$2,$3,$4,$5,'Part A',10,0,'ea','local',$6),($1,$2,$7,$8,$9,'Part B',10,0,'ea','local',$10) returning id,catalog_part_id`,
    [companyId,locationId,partA,`A${suffix}`,`A-${suffix}`,`revision-a:${suffix}`,partB,`B${suffix}`,`B-${suffix}`,`revision-b:${suffix}`]);
    const itemByPart=new Map(items.rows.map((row)=>[row.catalog_part_id,row.id]));
    const setup=await getPool().connect();let positionId;
    try{await setup.query("begin");positionId=await ensureSystemInventoryPosition(setup,{companyId,locationId,systemKey:"unassigned"});
      for(const partId of [partA,partB])await setup.query(`insert into inventory_position_balances(company_id,location_id,position_id,inventory_item_id,catalog_part_id,uom_code,quantity)
        values($1,$2,$3,$4,$5,'ea',10)`,[companyId,locationId,positionId,itemByPart.get(partId),partId]);
      await setup.query("commit");}finally{setup.release();}
    const reserved=await reserveAggregateWorkorderUsage({workorderId,catalogPartId:partA,sourcePositionId:positionId,companyIds:[companyId],locationIds:[locationId],isAdmin:false,actorId,
      quantity:6,uomCode:"ea",repairOrder:"Install A",idempotencyKey:`reserve-${suffix}`,requestHash:digest("revision")});
    assert.equal(reserved.kind,"reserved");
    const client=await getPool().connect();
    try{await client.query("begin");await markAggregateUsagesPending(client,{workorderId,companyId,actorId});
      await resetAggregateUsagesForRevision(client,{workorderId,companyId,actorId});
      await markAggregateUsagesPending(client,{workorderId,companyId,actorId});
      await resetAggregateUsagesForRevision(client,{workorderId,companyId,actorId});
      await releaseAggregateUsagesForCancelledWorkorder(client,{workorderId,companyId,actorId,reason:"Cancelled after revision"});
      await client.query("commit");}finally{client.release();}
    const balances=await query(`select catalog_part_id,quantity,quantity_reserved from inventory_position_balances where company_id=$1 and position_id=$2 order by catalog_part_id`,[companyId,positionId]);
    const byPart=new Map(balances.rows.map((row)=>[row.catalog_part_id,row]));
    assert.deepEqual(byPart.get(partA),{catalog_part_id:partA,quantity:"10.000",quantity_reserved:"0.000"});
    assert.deepEqual(byPart.get(partB),{catalog_part_id:partB,quantity:"10.000",quantity_reserved:"0.000"});
    assert.deepEqual((await query(`select quantity_on_hand,quantity_reserved from inventory_items where id=$1`,[itemByPart.get(partA)])).rows[0],{quantity_on_hand:"10.000",quantity_reserved:"0.000"});
    assert.equal((await query(`select status from workorder_aggregate_part_usages where id=$1`,[reserved.usage.id])).rows[0].status,"released");
    const allocations=await query(`select inventory_item_id,status from inventory_aggregate_usage_position_allocations where company_id=$1 and usage_id=$2`,[companyId,reserved.usage.id]);
    assert.deepEqual(allocations.rows,[{inventory_item_id:itemByPart.get(partA),status:"released"}]);
    const movements=await query(`select from_position_id,to_position_id from inventory_position_movements where company_id=$1 and catalog_part_id=$2 order by event_ordinal`,[companyId,partA]);
    assert.deepEqual(movements.rows,[{from_position_id:positionId,to_position_id:null},{from_position_id:null,to_position_id:positionId}]);
  }finally{
    for(const table of ["inventory_position_movements","inventory_position_operations","inventory_aggregate_usage_position_allocations","inventory_position_balances","inventory_positions","inventory_stock_movements","workorder_aggregate_part_usage_events","workorder_aggregate_part_usages","inventory_items","operational_workorders","assets","parts_catalog","locations","companies"])
      await query(`delete from ${table} where company_id=$1`,[companyId]).catch(()=>{});
    await query("delete from user_profiles where id=$1",[actorId]).catch(()=>{});
  }
});

test("create workorder reserves aggregate stock only from the chosen pickup position", { skip: !runPostgres }, async () => {
  const suffix=randomUUID().replaceAll("-","");
  const actorId=randomUUID(),companyId=randomUUID(),locationId=randomUUID(),assetId=randomUUID(),catalogPartId=randomUUID();
  let chosenPositionId,otherPositionId;
  try {
    await query("insert into user_profiles(id,display_name) values($1,'Create position integration')",[actorId]);
    await query("insert into companies(id,slug,name) values($1,$2,'Create position integration')",[companyId,`create-position-${suffix}`]);
    await query("insert into locations(id,company_id,name) values($1,$2,'Position shop')",[locationId,companyId]);
    await query("insert into assets(id,company_id,location_id,provider,name,unit_no) values($1,$2,$3,'manual','Truck',$4)",[assetId,companyId,locationId,`P-${suffix}`]);
    await query(`insert into parts_catalog(id,company_id,normalized_part_number,part_number,description,uom_code,tracking_mode)
      values($1,$2,$3,$4,'Position filter','ea','quantity')`,[catalogPartId,companyId,`FILTER${suffix}`,`FILTER-${suffix}`]);
    const item=(await query(`insert into inventory_items(company_id,location_id,catalog_part_id,normalized_part_number,part_number,description,quantity_on_hand,quantity_reserved,uom_code,source_provider,external_id)
      values($1,$2,$3,$4,$5,'Position filter',8,0,'ea','local',$6) returning id`,[companyId,locationId,catalogPartId,`FILTER${suffix}`,`FILTER-${suffix}`,`create-position:${suffix}`])).rows[0];
    const setup=await getPool().connect();
    try {
      await setup.query("begin");
      chosenPositionId=await ensureSystemInventoryPosition(setup,{companyId,locationId,systemKey:"unassigned"});
      otherPositionId=await ensureSystemInventoryPosition(setup,{companyId,locationId,systemKey:"receiving"});
      await setup.query(`insert into inventory_position_balances(company_id,location_id,position_id,inventory_item_id,catalog_part_id,uom_code,quantity)
        values($1,$2,$3,$4,$5,'ea',5),($1,$2,$6,$4,$5,'ea',3)`,[companyId,locationId,chosenPositionId,item.id,catalogPartId,otherPositionId]);
      await setup.query("commit");
    } finally { setup.release(); }

    const created=await createOperationalWorkorder({
      companyId,locationId,assetId,createdByUserId:actorId,createdByRole:"office",concern:"Replace filter",officeNotes:"",
      formData:{parts:[{catalogPartId,partNo:`FILTER-${suffix}`,qty:"2",uomCode:"ea",repairOrder:"Replace",trackingMode:"quantity",sourcePositionId:chosenPositionId,sourcePositionPath:"Shelf / Bin"}]},
      inventoryPositionSelections:[{partIndex:0,catalogPartId,positionId:chosenPositionId}],
    });
    assert.equal(created.formData.parts.length,0);
    const allocations=await query(`select position_id,quantity,status from inventory_aggregate_usage_position_allocations where company_id=$1 and usage_id in
      (select id from workorder_aggregate_part_usages where company_id=$1 and workorder_id=$2)`,[companyId,created.id]);
    assert.deepEqual(allocations.rows,[{position_id:chosenPositionId,quantity:"2.000",status:"reserved"}]);
    const balances=await query(`select position_id,quantity_reserved from inventory_position_balances where company_id=$1 and inventory_item_id=$2 order by position_id`,[companyId,item.id]);
    const reservedByPosition=new Map(balances.rows.map((row)=>[row.position_id,row.quantity_reserved]));
    assert.equal(reservedByPosition.get(chosenPositionId),"2.000");
    assert.equal(reservedByPosition.get(otherPositionId),"0.000");
  } finally {
    for(const table of ["inventory_position_movements","inventory_position_operations","inventory_aggregate_usage_position_allocations","inventory_position_balances","inventory_positions","inventory_stock_movements","workorder_aggregate_part_usage_events","workorder_aggregate_part_usages","inventory_items","workorder_status_events","operational_workorders","assets","parts_catalog","locations","companies"])
      await query(`delete from ${table} where company_id=$1`,[companyId]).catch(()=>{});
    await query("delete from user_profiles where id=$1",[actorId]).catch(()=>{});
  }
});
