import test,{after} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {closePool,getPool,query} from "../../db/pool.js";
import {ensureSystemInventoryPosition,insertInventoryPosition,moveInventoryStock,createPositionCount,savePositionCountObservation,addPositionCountFoundPart,applyPositionCountCorrection,getPositionCount,savePositionCountIdentity,patchInventoryPosition,getPartPositions,listPositionStock,placeAggregateInventoryReceipt,returnExactInventoryUnitToPosition} from "../../db/repositories/inventory-positions.repo.js";

const run=process.env.RUN_POSTGRES_INTEGRATION==="1";
after(async()=>{if(run)await closePool();});
const deferred=()=>{let resolve;const promise=new Promise((done)=>{resolve=done;});return{promise,resolve};};
async function waitUntilBlocked(pid){for(let attempt=0;attempt<100;attempt+=1){const result=await query("select cardinality(pg_blocking_pids($1)) blocked",[pid]);if(result.rows[0].blocked>0)return;await new Promise((resolve)=>setTimeout(resolve,10));}throw new Error("Expected writer to wait on the count position lock.");}

test("real PostgreSQL conserves moves and applies a watermark-safe aggregate count",{skip:!run},async()=>{
  const suffix=randomUUID().replaceAll("-","");const actorId=randomUUID(),companyId=randomUUID(),locationId=randomUUID(),partId=randomUUID();
  const scope={actorId,companyIds:[companyId],locationIds:[locationId],isAdmin:false,locationId};
  try{
    await query("insert into user_profiles(id,display_name) values($1,'Position integration')",[actorId]);
    await query("insert into companies(id,slug,name) values($1,$2,'Position integration')",[companyId,`position-${suffix}`]);
    await query("insert into locations(id,company_id,name) values($1,$2,'Position shop')",[locationId,companyId]);
    await query(`insert into parts_catalog(id,company_id,normalized_part_number,part_number,description,uom_code,tracking_mode)
      values($1,$2,$3,$4,'Position part','ea','quantity')`,[partId,companyId,`POS${suffix}`,`POS-${suffix}`]);
    const item=await query(`insert into inventory_items(company_id,location_id,catalog_part_id,normalized_part_number,part_number,description,quantity_on_hand,quantity_reserved,uom_code,source_provider,external_id)
      values($1,$2,$3,$4,$5,'Position part',10,0,'ea','local',$6) returning id`,[companyId,locationId,partId,`POS${suffix}`,`POS-${suffix}`,`position:${suffix}`]);
    const client=(await import("../../db/pool.js")).getPool();const setup=await client.connect();let sourceId;
    try{await setup.query("begin");sourceId=await ensureSystemInventoryPosition(setup,{companyId,locationId,systemKey:"unassigned"});
      await setup.query(`insert into inventory_position_balances(company_id,location_id,position_id,inventory_item_id,catalog_part_id,uom_code,quantity)
        values($1,$2,$3,$4,$5,'ea',10)`,[companyId,locationId,sourceId,item.rows[0].id,partId]);await setup.query("commit");}finally{setup.release();}
    const group=await insertInventoryPosition({...scope,parentId:null,code:"W1",name:"Warehouse",kind:"warehouse",usage:null,canStore:false,isPickable:false,idempotencyKey:`group-${suffix}`});
    const area=await insertInventoryPosition({...scope,parentId:group.position.id,code:"RECEIVING-AREA",name:"Receiving area",kind:"area",usage:null,canStore:false,isPickable:false,idempotencyKey:`area-${suffix}`});
    const subarea=await insertInventoryPosition({...scope,parentId:area.position.id,code:"INSPECTION-AREA",name:"Inspection area",kind:"area",usage:null,canStore:false,isPickable:false,idempotencyKey:`subarea-${suffix}`});
    assert.equal(subarea.kind,"created");
    assert.equal(subarea.position.path,"Warehouse / Receiving area / Inspection area");
    const aisle=await insertInventoryPosition({...scope,parentId:subarea.position.id,code:"A1",name:"Aisle 1",kind:"aisle",usage:null,canStore:false,isPickable:false,idempotencyKey:`aisle-${suffix}`});
    const shelf=await insertInventoryPosition({...scope,parentId:aisle.position.id,code:"A1-S1",name:"Shelf 1",kind:"shelf",usage:null,canStore:false,isPickable:false,idempotencyKey:`shelf-${suffix}`});
    const bin=await insertInventoryPosition({...scope,parentId:shelf.position.id,code:"A1-S1-B1",name:"Bin 1",kind:"bin",usage:"storage",canStore:true,isPickable:true,idempotencyKey:`bin-${suffix}`});
    assert.equal(bin.position.path,"Warehouse / Receiving area / Inspection area / Aisle 1 / Shelf 1 / Bin 1");
    const invalidChild=await insertInventoryPosition({...scope,parentId:bin.position.id,code:"INVALID-AISLE",name:"Invalid aisle",kind:"aisle",usage:null,canStore:false,isPickable:false,idempotencyKey:`invalid-child-${suffix}`});
    assert.equal(invalidChild.kind,"invalid_parent_kind");
    const moved=await moveInventoryStock({...scope,partId,move:{fromPositionId:sourceId,toPositionId:bin.position.id,quantity:4,expectedSourceVersion:1,expectedDestinationVersion:null,idempotencyKey:`move-${suffix}`,reason:"Put away"}});
    assert.equal(moved.kind,"moved");
    assert.equal((await query("select quantity_on_hand from inventory_items where id=$1",[item.rows[0].id])).rows[0].quantity_on_hand,"10.000");
    assert.deepEqual(await listPositionStock({...scope,positionId:group.position.id,scope:"direct"}),{scope:"direct",parts:[]});
    const subtreeStock=await listPositionStock({...scope,positionId:group.position.id,scope:"subtree"});
    assert.deepEqual(subtreeStock.parts,[{id:partId,partNumber:`POS-${suffix}`,description:"Position part",uomCode:"ea",trackingMode:"quantity",
      directQuantity:0,descendantQuantity:4,subtreeQuantity:4,directReserved:0,descendantReserved:0,subtreeReserved:0,
      placements:[{positionId:bin.position.id,code:"A1-S1-B1",name:"Bin 1",kind:"bin",depth:5,
        pathCodes:["W1","RECEIVING-AREA","INSPECTION-AREA","A1","A1-S1","A1-S1-B1"],
        pathNames:["Warehouse","Receiving area","Inspection area","Aisle 1","Shelf 1","Bin 1"],
        pathKinds:["warehouse","area","area","aisle","shelf","bin"],quantity:4,reserved:0}]}]);
    const binStock=await listPositionStock({...scope,positionId:bin.position.id,scope:"direct"});
    assert.equal(binStock.parts[0].directQuantity,4);assert.equal(binStock.parts[0].descendantQuantity,0);
    assert.deepEqual(binStock.parts[0].placements[0].pathCodes,["A1-S1-B1"]);
    await query("update parts_catalog set tracking_mode=null where id=$1",[partId]);
    const legacySubtreeStock=await listPositionStock({...scope,positionId:group.position.id,scope:"subtree"});
    assert.equal(legacySubtreeStock.parts[0].subtreeQuantity,4);
    await query("update parts_catalog set tracking_mode='quantity' where id=$1",[partId]);
    const count=await createPositionCount({...scope,positionId:bin.position.id,idempotencyKey:`count-${suffix}`});
    const line=count.count.lines[0];
    await savePositionCountObservation({...scope,countId:count.count.id,lineId:line.id,expectedVersion:line.version,observedQuantity:3,idempotencyKey:`observe-${suffix}`});
    const refreshed=await getPositionCount({...scope,countId:count.count.id});
    const applied=await applyPositionCountCorrection({...scope,isAdmin:true,countId:count.count.id,expectedVersion:refreshed.version,idempotencyKey:`apply-${suffix}`,reason:"Physical count"});
    assert.equal(applied.kind,"applied");
    assert.equal((await query("select quantity_on_hand from inventory_items where id=$1",[item.rows[0].id])).rows[0].quantity_on_hand,"9.000");
    const invalid=await moveInventoryStock({...scope,partId,move:{fromPositionId:sourceId,toPositionId:bin.position.id,quantity:.5,expectedSourceVersion:2,expectedDestinationVersion:2,idempotencyKey:`fraction-${suffix}`,reason:"Invalid fraction"}});
    assert.equal(invalid.kind,"unsupported_uom");
  }finally{
    for(const table of ["inventory_position_count_commands","inventory_position_count_unit_snapshots","inventory_position_count_lines","inventory_position_count_sessions","inventory_position_movements","inventory_position_operations","inventory_aggregate_usage_position_allocations","inventory_position_balances","inventory_position_admin_commands","inventory_position_reconciliation_exceptions","inventory_positions","inventory_stock_movements","inventory_items","parts_catalog","locations","companies"])
      await query(`delete from ${table} where company_id=$1`,[companyId]).catch(()=>{});
    await query("delete from user_profiles where id=$1",[actorId]).catch(()=>{});
  }
});

test("a new SKU invalidates the whole count, restart supersedes it, and open counts block archive",{skip:!run},async()=>{
  const suffix=randomUUID().replaceAll("-","");const actorId=randomUUID(),companyId=randomUUID(),locationId=randomUUID(),partA=randomUUID(),partB=randomUUID();
  const scope={actorId,companyIds:[companyId],locationIds:[locationId],isAdmin:false,locationId};
  try{
    await query("insert into user_profiles(id,display_name) values($1,'Position recount')",[actorId]);
    await query("insert into companies(id,slug,name) values($1,$2,'Position recount')",[companyId,`position-recount-${suffix}`]);
    await query("insert into locations(id,company_id,name) values($1,$2,'Recount shop')",[locationId,companyId]);
    await query(`insert into parts_catalog(id,company_id,normalized_part_number,part_number,description,uom_code,tracking_mode)
      values($1,$2,$3,$4,'Count A','ea','quantity'),($5,$2,$6,$7,'Count B','ea','quantity')`,
    [partA,companyId,`CA${suffix}`,`CA-${suffix}`,partB,`CB${suffix}`,`CB-${suffix}`]);
    const items=await query(`insert into inventory_items(company_id,location_id,catalog_part_id,normalized_part_number,part_number,description,quantity_on_hand,quantity_reserved,uom_code,source_provider,external_id)
      values($1,$2,$3,$4,$5,'Count A',10,0,'ea','local',$6),($1,$2,$7,$8,$9,'Count B',10,0,'ea','local',$10) returning id,catalog_part_id`,
    [companyId,locationId,partA,`CA${suffix}`,`CA-${suffix}`,`count-a:${suffix}`,partB,`CB${suffix}`,`CB-${suffix}`,`count-b:${suffix}`]);
    const itemByPart=new Map(items.rows.map((row)=>[row.catalog_part_id,row.id]));
    const bin=await insertInventoryPosition({...scope,parentId:null,code:"COUNT-BIN",name:"Count Bin",kind:"bin",usage:"storage",canStore:true,isPickable:true,idempotencyKey:`bin-${suffix}`});
    const empty=await insertInventoryPosition({...scope,parentId:null,code:"EMPTY-BIN",name:"Empty Bin",kind:"bin",usage:"storage",canStore:true,isPickable:true,idempotencyKey:`empty-${suffix}`});
    const setup=await (await import("../../db/pool.js")).getPool().connect();let sourceId;
    try{await setup.query("begin");sourceId=await ensureSystemInventoryPosition(setup,{companyId,locationId,systemKey:"unassigned"});
      await setup.query(`insert into inventory_position_balances(company_id,location_id,position_id,inventory_item_id,catalog_part_id,uom_code,quantity)
        values($1,$2,$3,$4,$5,'ea',6),($1,$2,$6,$4,$5,'ea',4),($1,$2,$3,$7,$8,'ea',10)`,
      [companyId,locationId,sourceId,itemByPart.get(partA),partA,bin.position.id,itemByPart.get(partB),partB]);await setup.query("commit");}finally{setup.release();}
    const count=await createPositionCount({...scope,positionId:bin.position.id,idempotencyKey:`count-${suffix}`});
    const line=count.count.lines[0];
    await savePositionCountObservation({...scope,countId:count.count.id,lineId:line.id,expectedVersion:line.version,observedQuantity:3,idempotencyKey:`observe-${suffix}`});
    const moved=await moveInventoryStock({...scope,partId:partB,move:{fromPositionId:sourceId,toPositionId:bin.position.id,quantity:2,expectedSourceVersion:1,expectedDestinationVersion:null,idempotencyKey:`move-b-${suffix}`,reason:"Move new SKU during count"}});
    assert.equal(moved.kind,"moved");
    const refreshed=await getPositionCount({...scope,countId:count.count.id});
    const apply=await applyPositionCountCorrection({...scope,isAdmin:true,countId:count.count.id,expectedVersion:refreshed.version,idempotencyKey:`apply-${suffix}`,reason:"Count with concurrent SKU"});
    assert.equal(apply.kind,"needs_recount");
    assert.equal((await query(`select quantity from inventory_position_balances where company_id=$1 and position_id=$2 and inventory_item_id=$3`,[companyId,bin.position.id,itemByPart.get(partA)])).rows[0].quantity,"4.000");
    assert.equal((await query(`select quantity_on_hand from inventory_items where id=$1`,[itemByPart.get(partA)])).rows[0].quantity_on_hand,"10.000");
    const restarted=await createPositionCount({...scope,positionId:bin.position.id,idempotencyKey:`restart-${suffix}`});
    assert.equal(restarted.count.lines.length,2);
    const old=await getPositionCount({...scope,countId:count.count.id});
    assert.equal(old.status,"superseded");
    const emptyCount=await createPositionCount({...scope,positionId:empty.position.id,idempotencyKey:`empty-count-${suffix}`});
    assert.equal(emptyCount.count.status,"open");
    assert.equal((await applyPositionCountCorrection({...scope,isAdmin:true,countId:emptyCount.count.id,expectedVersion:emptyCount.count.version,idempotencyKey:`empty-apply-${suffix}`,reason:"Certified empty"})).kind,"applied");
    const emptyEvidence=await getPositionCount({...scope,countId:emptyCount.count.id});
    assert.equal(emptyEvidence.status,"applied");assert.equal(emptyEvidence.applyReason,"Certified empty");assert.equal(emptyEvidence.appliedBy.id,actorId);
    const archive=await patchInventoryPosition({...scope,positionId:empty.position.id,expectedVersion:empty.position.version,isActive:false});
    assert.equal(archive.kind,"updated");
    const assetId=randomUUID(),workorderId=randomUUID();
    await query("insert into assets(id,company_id,location_id,provider,name,unit_no) values($1,$2,$3,'manual','Legacy truck',$4)",[assetId,companyId,locationId,`L-${suffix}`]);
    await query(`insert into operational_workorders(id,company_id,serial,asset_id,location_id,created_by_user_id,concern,status)
      values($1,$2,$3,$4,$5,$6,'Legacy allocation','in_progress')`,[workorderId,companyId,`WO-L-${suffix}`,assetId,locationId,actorId]);
    const request=await query(`insert into workorder_part_requests(workorder_id,catalog_part_id,raw_query,part_number,normalized_part_number,description,quantity,uom_code,approval_status)
      values($1,$2,'Count A',$3,$4,'Count A',1,'ea','approved') returning id`,[workorderId,partA,`CA-${suffix}`,`CA${suffix}`]);
    await query(`insert into part_allocations(part_request_id,source_type,status,quantity,location_id,inventory_item_id,uom_code)
      values($1,'inventory','reserved',1,$2,$3,'ea')`,[request.rows[0].id,locationId,itemByPart.get(partA)]);
    const gated=await moveInventoryStock({...scope,partId:partA,move:{fromPositionId:sourceId,toPositionId:bin.position.id,quantity:1,expectedSourceVersion:1,expectedDestinationVersion:1,idempotencyKey:`gated-${suffix}`,reason:"Must be gated"}});
    assert.equal(gated.kind,"reconciliation_required");
    const publicState=await getPartPositions({...scope,partId:partA});
    assert.equal(publicState.reconciliationRequired,true);
    assert.ok(publicState.reconciliationReasons.includes("active_legacy_allocation"));
    assert.ok(publicState.positions.every((position)=>position.available===0));
  }finally{
    for(const table of ["inventory_position_count_commands","inventory_position_count_unit_snapshots","inventory_position_count_lines","inventory_position_count_sessions","inventory_position_movements","inventory_position_operations","inventory_aggregate_usage_position_allocations","inventory_position_balances","inventory_position_admin_commands","inventory_position_reconciliation_exceptions","inventory_positions","part_allocations","workorder_part_requests","inventory_stock_movements","inventory_items","operational_workorders","assets","parts_catalog","locations","companies"])
      await query(`delete from ${table} where company_id=$1`,[companyId]).catch(()=>{});
    await query("delete from user_profiles where id=$1",[actorId]).catch(()=>{});
  }
});

test("count apply and a same-position move serialize without deadlock or double adjustment",{skip:!run},async()=>{
  const suffix=randomUUID().replaceAll("-","");const actorId=randomUUID(),companyId=randomUUID(),locationId=randomUUID(),partId=randomUUID();
  const scope={actorId,companyIds:[companyId],locationIds:[locationId],isAdmin:false,locationId};
  try{
    await query("insert into user_profiles(id,display_name) values($1,'Position race')",[actorId]);
    await query("insert into companies(id,slug,name) values($1,$2,'Position race')",[companyId,`position-race-${suffix}`]);
    await query("insert into locations(id,company_id,name) values($1,$2,'Race shop')",[locationId,companyId]);
    await query(`insert into parts_catalog(id,company_id,normalized_part_number,part_number,description,uom_code,tracking_mode)
      values($1,$2,$3,$4,'Race part','ea','quantity')`,[partId,companyId,`RACE${suffix}`,`RACE-${suffix}`]);
    const item=await query(`insert into inventory_items(company_id,location_id,catalog_part_id,normalized_part_number,part_number,description,quantity_on_hand,quantity_reserved,uom_code,source_provider,external_id)
      values($1,$2,$3,$4,$5,'Race part',10,0,'ea','local',$6) returning id`,[companyId,locationId,partId,`RACE${suffix}`,`RACE-${suffix}`,`race:${suffix}`]);
    const bin=await insertInventoryPosition({...scope,parentId:null,code:"RACE-BIN",name:"Race Bin",kind:"bin",usage:"storage",canStore:true,isPickable:true,idempotencyKey:`bin-${suffix}`});
    const setup=await (await import("../../db/pool.js")).getPool().connect();let sourceId;
    try{await setup.query("begin");sourceId=await ensureSystemInventoryPosition(setup,{companyId,locationId,systemKey:"unassigned"});
      await setup.query(`insert into inventory_position_balances(company_id,location_id,position_id,inventory_item_id,catalog_part_id,uom_code,quantity)
        values($1,$2,$3,$4,$5,'ea',6),($1,$2,$6,$4,$5,'ea',4)`,[companyId,locationId,sourceId,item.rows[0].id,partId,bin.position.id]);await setup.query("commit");}finally{setup.release();}
    const count=await createPositionCount({...scope,positionId:bin.position.id,idempotencyKey:`count-${suffix}`});const line=count.count.lines[0];
    await savePositionCountObservation({...scope,countId:count.count.id,lineId:line.id,expectedVersion:line.version,observedQuantity:3,idempotencyKey:`observe-${suffix}`});
    const refreshed=await getPositionCount({...scope,countId:count.count.id});
    const applyInput={...scope,isAdmin:true,countId:count.count.id,expectedVersion:refreshed.version,idempotencyKey:`apply-${suffix}`,reason:"Race count"};
    const race=Promise.all([
      applyPositionCountCorrection(applyInput),
      moveInventoryStock({...scope,partId,move:{fromPositionId:sourceId,toPositionId:bin.position.id,quantity:1,expectedSourceVersion:1,expectedDestinationVersion:1,idempotencyKey:`move-${suffix}`,reason:"Race move"}}),
    ]);
    let timer;
    const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error("Position count/move deadlock")),7000);});
    const [applied,moved]=await Promise.race([race,timeout]).finally(()=>clearTimeout(timer));
    assert.ok((applied.kind==="applied"&&moved.kind==="stale")||(applied.kind==="needs_recount"&&moved.kind==="moved")||(applied.kind==="stock_busy"&&moved.kind==="moved"));
    if(applied.kind==="stock_busy")assert.equal((await applyPositionCountCorrection(applyInput)).kind,"needs_recount");
    const physical=await query(`select sum(quantity)::text total from inventory_position_balances where company_id=$1 and inventory_item_id=$2`,[companyId,item.rows[0].id]);
    const accounted=await query(`select quantity_on_hand::text total from inventory_items where id=$1`,[item.rows[0].id]);
    assert.equal(physical.rows[0].total,accounted.rows[0].total);
  }finally{
    for(const table of ["inventory_position_count_commands","inventory_position_count_unit_snapshots","inventory_position_count_lines","inventory_position_count_sessions","inventory_position_movements","inventory_position_operations","inventory_aggregate_usage_position_allocations","inventory_position_balances","inventory_position_admin_commands","inventory_position_reconciliation_exceptions","inventory_positions","inventory_stock_movements","inventory_items","parts_catalog","locations","companies"])
      await query(`delete from ${table} where company_id=$1`,[companyId]).catch(()=>{});
    await query("delete from user_profiles where id=$1",[actorId]).catch(()=>{});
  }
});

test("count locks serialize new-SKU receipts and exact returns, and exact writers keep one lock order",{skip:!run},async()=>{
  const suffix=randomUUID().replaceAll("-","");
  const actorId=randomUUID(),companyId=randomUUID(),locationId=randomUUID();
  const aggregatePartId=randomUUID(),newPartId=randomUUID(),exactPartId=randomUUID();
  const receiptRunId=randomUUID(),receiptId=randomUUID(),receiptLineId=randomUUID();
  const unitIds=[randomUUID(),randomUUID(),randomUUID()];
  const scope={actorId,companyIds:[companyId],locationIds:[locationId],isAdmin:false,locationId};
  let releaseApply;
  try{
    await query("insert into user_profiles(id,display_name) values($1,'Position writer race')",[actorId]);
    await query("insert into companies(id,slug,name) values($1,$2,'Position writer race')",[companyId,`position-writer-${suffix}`]);
    await query("insert into locations(id,company_id,name) values($1,$2,'Writer race shop')",[locationId,companyId]);
    await query(`insert into parts_catalog(id,company_id,normalized_part_number,part_number,description,uom_code,tracking_mode)
      values($1,$2,$3,$4,'Counted aggregate','ea','quantity'),
        ($5,$2,$6,$7,'New receipt aggregate','ea','quantity'),
        ($8,$2,$9,$10,'Exact writer','ea','serialized')`,
    [aggregatePartId,companyId,`AGG${suffix}`,`AGG-${suffix}`,newPartId,`NEW${suffix}`,`NEW-${suffix}`,exactPartId,`EXACT${suffix}`,`EXACT-${suffix}`]);
    const items=await query(`insert into inventory_items(company_id,location_id,catalog_part_id,normalized_part_number,part_number,description,quantity_on_hand,quantity_reserved,uom_code,source_provider,external_id)
      values($1,$2,$3,$4,$5,'Counted aggregate',4,0,'ea','local',$6),
        ($1,$2,$7,$8,$9,'Exact writer',3,0,'ea','local',$10) returning id,catalog_part_id`,
    [companyId,locationId,aggregatePartId,`AGG${suffix}`,`AGG-${suffix}`,`aggregate:${suffix}`,exactPartId,`EXACT${suffix}`,`EXACT-${suffix}`,`exact:${suffix}`]);
    const itemByPart=new Map(items.rows.map((row)=>[row.catalog_part_id,row.id]));
    await query(`insert into invoice_extraction_runs(id,company_id,location_id,created_by,reviewed_by,document_hash,file_name,mime_type,byte_size,idempotency_key,status,provider,model,prompt_version,reviewed_draft,reviewed_at)
      values($1,$2,$3,$4,$4,$5,'position-race.pdf','application/pdf',1,$6,'reviewed','local-test','local-test','local-v1','{}'::jsonb,now())`,
    [receiptRunId,companyId,locationId,actorId,`${suffix}${suffix}`,`run-${suffix}`]);
    await query(`insert into inventory_receipts(id,company_id,location_id,invoice_run_id,created_by,idempotency_key,provider,provider_marker,provider_picking_name,status,confirmed_at)
      values($1,$2,$3,$4,$5,$6,'local',$7,'Position race receipt','confirmed',now())`,
    [receiptId,companyId,locationId,receiptRunId,actorId,`receipt-${suffix}`,`LOCAL-${suffix}`]);
    await query(`insert into inventory_receipt_lines(id,company_id,receipt_id,line_index,catalog_part_id,product_external_id,part_number,description,quantity,uom_code,tracking_mode)
      values($1,$2,$3,0,$4,$5,$6,'Exact writer',3,'ea','serial')`,
    [receiptLineId,companyId,receiptId,exactPartId,`local:${exactPartId}`,`EXACT-${suffix}`]);
    await query(`insert into inventory_serialized_units(id,company_id,location_id,receipt_id,receipt_line_id,unit_ordinal,serial_number,status,condition_code,custody_holder_type,custody_location_id)
      select input.id,$1,$2,$3,$4,input.ordinal,input.serial,'in_stock','new','inventory_location',$2
      from unnest($5::uuid[],$6::int[],$7::text[]) input(id,ordinal,serial)`,
    [companyId,locationId,receiptId,receiptLineId,unitIds,[1,2,3],unitIds.map((_,index)=>`SER-${suffix}-${index+1}`)]);
    const setup=await getPool().connect();let unassignedId,receivingId;
    try{
      await setup.query("begin");
      unassignedId=await ensureSystemInventoryPosition(setup,{companyId,locationId,systemKey:"unassigned"});
      receivingId=await ensureSystemInventoryPosition(setup,{companyId,locationId,systemKey:"receiving"});
      await setup.query(`insert into inventory_position_balances(company_id,location_id,position_id,inventory_item_id,catalog_part_id,uom_code,quantity)
        values($1,$2,$3,$4,$5,'ea',4)`,[companyId,locationId,unassignedId,itemByPart.get(aggregatePartId),aggregatePartId]);
      await setup.query("update inventory_serialized_units set current_position_id=$3 where company_id=$1 and id=$2",[companyId,unitIds[1],receivingId]);
      await setup.query("commit");
    }finally{setup.release();}

    const firstCount=await createPositionCount({...scope,positionId:unassignedId,idempotencyKey:`count-new-${suffix}`});
    const firstLine=firstCount.count.lines[0];
    await savePositionCountObservation({...scope,countId:firstCount.count.id,lineId:firstLine.id,expectedVersion:firstLine.version,observedQuantity:firstLine.expectedQuantity,idempotencyKey:`observe-new-${suffix}`});
    const firstRefreshed=await getPositionCount({...scope,countId:firstCount.count.id});
    const firstEntered=deferred();releaseApply=deferred();
    const firstApply=applyPositionCountCorrection({...scope,isAdmin:true,countId:firstCount.count.id,expectedVersion:firstRefreshed.version,idempotencyKey:`apply-new-${suffix}`,reason:"Serialize new receipt"},{afterPreflight:async()=>{firstEntered.resolve();await releaseApply.promise;}});
    await firstEntered.promise;
    const receiptWriter=await getPool().connect();
    const receiptPid=(await receiptWriter.query("select pg_backend_pid() pid")).rows[0].pid;
    const receiptWrite=(async()=>{try{
      await receiptWriter.query("begin");
      const inserted=await receiptWriter.query(`insert into inventory_items(company_id,location_id,catalog_part_id,normalized_part_number,part_number,description,quantity_on_hand,quantity_reserved,uom_code,source_provider,external_id)
        values($1,$2,$3,$4,$5,'New receipt aggregate',2,0,'ea','local',$6) returning id`,
      [companyId,locationId,newPartId,`NEW${suffix}`,`NEW-${suffix}`,`new:${suffix}`]);
      await placeAggregateInventoryReceipt(receiptWriter,{companyId,locationId,inventoryItemId:inserted.rows[0].id,catalogPartId:newPartId,uomCode:"ea",quantity:2,actorId,idempotencyKey:`new-receipt-${suffix}`,systemKey:"unassigned"});
      await receiptWriter.query("commit");return inserted.rows[0].id;
    }catch(error){await receiptWriter.query("rollback").catch(()=>{});throw error;}finally{receiptWriter.release();}})();
    await waitUntilBlocked(receiptPid);
    releaseApply.resolve();releaseApply=null;
    assert.equal((await firstApply).kind,"applied");
    const newItemId=await receiptWrite;
    assert.equal((await query("select quantity from inventory_position_balances where company_id=$1 and position_id=$2 and inventory_item_id=$3",[companyId,unassignedId,newItemId])).rows[0].quantity,"2.000");

    const secondCount=await createPositionCount({...scope,positionId:unassignedId,idempotencyKey:`count-return-${suffix}`});
    for(const line of secondCount.count.lines)await savePositionCountObservation({...scope,countId:secondCount.count.id,lineId:line.id,expectedVersion:line.version,observedQuantity:line.expectedQuantity,idempotencyKey:`observe-return-${line.id}`});
    const secondRefreshed=await getPositionCount({...scope,countId:secondCount.count.id});
    const secondEntered=deferred();releaseApply=deferred();
    const secondApply=applyPositionCountCorrection({...scope,isAdmin:true,countId:secondCount.count.id,expectedVersion:secondRefreshed.version,idempotencyKey:`apply-return-${suffix}`,reason:"Serialize exact return"},{afterPreflight:async()=>{secondEntered.resolve();await releaseApply.promise;}});
    await secondEntered.promise;
    const returnWriter=await getPool().connect();
    const returnPid=(await returnWriter.query("select pg_backend_pid() pid")).rows[0].pid;
    const exactReturn=(async()=>{try{
      await returnWriter.query("begin");
      await returnExactInventoryUnitToPosition(returnWriter,{companyId,locationId,catalogPartId:exactPartId,uomCode:"ea",unitId:unitIds[0],actorId,idempotencyKey:`exact-return-${suffix}`,reason:"Exact count race"});
      await returnWriter.query("commit");
    }catch(error){await returnWriter.query("rollback").catch(()=>{});throw error;}finally{returnWriter.release();}})();
    await waitUntilBlocked(returnPid);
    releaseApply.resolve();releaseApply=null;
    assert.equal((await secondApply).kind,"applied");
    await exactReturn;
    assert.equal((await query("select current_position_id from inventory_serialized_units where id=$1",[unitIds[0]])).rows[0].current_position_id,unassignedId);

    const moveEntered=deferred(),releaseMove=deferred();
    const exactMove=moveInventoryStock({...scope,partId:exactPartId,move:{fromPositionId:receivingId,toPositionId:unassignedId,unitIds:[unitIds[1]],unitVersions:{},idempotencyKey:`exact-move-${suffix}`,reason:"Exact lock order"}},{afterItemLock:async()=>{moveEntered.resolve();await releaseMove.promise;}});
    await moveEntered.promise;
    const orderedReturnWriter=await getPool().connect();
    const orderedReturnPid=(await orderedReturnWriter.query("select pg_backend_pid() pid")).rows[0].pid;
    const orderedReturn=(async()=>{try{
      await orderedReturnWriter.query("begin");
      await returnExactInventoryUnitToPosition(orderedReturnWriter,{companyId,locationId,catalogPartId:exactPartId,uomCode:"ea",unitId:unitIds[2],actorId,idempotencyKey:`ordered-return-${suffix}`,reason:"Exact lock order"});
      await orderedReturnWriter.query("commit");
    }catch(error){await orderedReturnWriter.query("rollback").catch(()=>{});throw error;}finally{orderedReturnWriter.release();}})();
    await waitUntilBlocked(orderedReturnPid);
    releaseMove.resolve();
    let timer;
    await Promise.race([Promise.all([exactMove,orderedReturn]),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error("Exact move/return lock-order deadlock")),7000);})]).finally(()=>clearTimeout(timer));
    const finalUnits=await query("select id,current_position_id from inventory_serialized_units where company_id=$1 and id=any($2::uuid[]) order by id",[companyId,unitIds]);
    assert.ok(finalUnits.rows.every((unit)=>unit.current_position_id===unassignedId));
  }finally{
    releaseApply?.resolve();
    for(const table of ["inventory_position_count_commands","inventory_position_count_unit_snapshots","inventory_position_count_lines","inventory_position_count_sessions","inventory_position_movements","inventory_position_operations","inventory_aggregate_usage_position_allocations","inventory_position_balances","inventory_position_admin_commands","inventory_position_reconciliation_exceptions","inventory_positions","inventory_unit_events","inventory_serialized_units","inventory_receipt_lines","inventory_receipts","inventory_stock_movements","inventory_items","invoice_extraction_runs","parts_catalog","locations","companies"])
      await query(`delete from ${table} where company_id=$1`,[companyId]).catch(()=>{});
    await query("delete from user_profiles where id=$1",[actorId]).catch(()=>{});
  }
});

test("serialized position counts require exact identities and reject stale custody without stock mutation",{skip:!run},async()=>{
  const suffix=randomUUID().replaceAll("-","");const actorId=randomUUID(),companyId=randomUUID(),locationId=randomUUID(),partId=randomUUID(),otherCompanyId=randomUUID(),otherLocationId=randomUUID(),otherPartId=randomUUID();
  const runId=randomUUID(),receiptId=randomUUID(),lineId=randomUUID(),unitIds=[randomUUID(),randomUUID(),randomUUID()];
  const serials=unitIds.map((_,index)=>`COUNT-${suffix}-${index+1}`);const scope={actorId,companyIds:[companyId],locationIds:[locationId],isAdmin:false,locationId};
  try{
    await query("insert into user_profiles(id,display_name) values($1,'Serialized counter')",[actorId]);
    await query("insert into companies(id,slug,name) values($1,$2,'Serialized count')",[companyId,`serial-count-${suffix}`]);
    await query("insert into locations(id,company_id,name) values($1,$2,'Serialized shop')",[locationId,companyId]);
    await query("insert into companies(id,slug,name) values($1,$2,'Other serialized company')",[otherCompanyId,`other-serial-${suffix}`]);
    await query("insert into locations(id,company_id,name) values($1,$2,'Other serialized shop')",[otherLocationId,otherCompanyId]);
    await query(`insert into parts_catalog(id,company_id,normalized_part_number,part_number,description,uom_code,tracking_mode)
      values($1,$2,$3,$4,'Serialized count part','ea','serialized')`,[partId,companyId,`SC${suffix}`,`SC-${suffix}`]);
    await query(`insert into invoice_extraction_runs(id,company_id,location_id,created_by,reviewed_by,document_hash,file_name,mime_type,byte_size,idempotency_key,status,provider,model,prompt_version,reviewed_draft,reviewed_at)
      values($1,$2,$3,$4,$4,$5,'serial-count.pdf','application/pdf',1,$6,'reviewed','local-test','local-test','local-v1','{}'::jsonb,now())`,[runId,companyId,locationId,actorId,`${suffix}${suffix}`,`run-${suffix}`]);
    await query(`insert into inventory_receipts(id,company_id,location_id,invoice_run_id,created_by,idempotency_key,provider,provider_marker,provider_picking_name,status,confirmed_at)
      values($1,$2,$3,$4,$5,$6,'local',$7,'Serialized count receipt','confirmed',now())`,[receiptId,companyId,locationId,runId,actorId,`receipt-${suffix}`,`LOCAL-${suffix}`]);
    await query(`insert into inventory_receipt_lines(id,company_id,receipt_id,line_index,catalog_part_id,product_external_id,part_number,description,quantity,uom_code,tracking_mode)
      values($1,$2,$3,0,$4,$5,$6,'Serialized count part',3,'ea','serial')`,[lineId,companyId,receiptId,partId,`local:${partId}`,`SC-${suffix}`]);
    await query(`insert into inventory_serialized_units(id,company_id,location_id,receipt_id,receipt_line_id,unit_ordinal,serial_number,status,condition_code,custody_holder_type,custody_location_id)
      select input.id,$1,$2,$3,$4,input.ordinal,input.serial,'in_stock','new','inventory_location',$2 from unnest($5::uuid[],$6::int[],$7::text[]) input(id,ordinal,serial)`,[companyId,locationId,receiptId,lineId,unitIds,[1,2,3],serials]);
    const otherRun=randomUUID(),otherReceipt=randomUUID(),otherLine=randomUUID(),otherUnit=randomUUID(),otherSerial=`CROSS-${suffix}`;
    await query(`insert into parts_catalog(id,company_id,normalized_part_number,part_number,description,uom_code,tracking_mode) values($1,$2,$3,$4,'Cross-company part','ea','serialized')`,[otherPartId,otherCompanyId,`CROSS${suffix}`,`CROSS-${suffix}`]);
    await query(`insert into invoice_extraction_runs(id,company_id,location_id,created_by,reviewed_by,document_hash,file_name,mime_type,byte_size,idempotency_key,status,provider,model,prompt_version,reviewed_draft,reviewed_at)
      values($1,$2,$3,$4,$4,$5,'cross-count.pdf','application/pdf',1,$6,'reviewed','local-test','local-test','local-v1','{}'::jsonb,now())`,[otherRun,otherCompanyId,otherLocationId,actorId,`${suffix}${suffix}`,`cross-run-${suffix}`]);
    await query(`insert into inventory_receipts(id,company_id,location_id,invoice_run_id,created_by,idempotency_key,provider,provider_marker,provider_picking_name,status,confirmed_at)
      values($1,$2,$3,$4,$5,$6,'local',$7,'Cross receipt','confirmed',now())`,[otherReceipt,otherCompanyId,otherLocationId,otherRun,actorId,`cross-receipt-${suffix}`,`CROSS-${suffix}`]);
    await query(`insert into inventory_receipt_lines(id,company_id,receipt_id,line_index,catalog_part_id,product_external_id,part_number,description,quantity,uom_code,tracking_mode)
      values($1,$2,$3,0,$4,$5,$6,'Cross-company part',1,'ea','serial')`,[otherLine,otherCompanyId,otherReceipt,otherPartId,`local:${otherPartId}`,`CROSS-${suffix}`]);
    await query(`insert into inventory_serialized_units(id,company_id,location_id,receipt_id,receipt_line_id,unit_ordinal,serial_number,status,condition_code,custody_holder_type,custody_location_id)
      values($1,$2,$3,$4,$5,1,$6,'in_stock','new','inventory_location',$3)`,[otherUnit,otherCompanyId,otherLocationId,otherReceipt,otherLine,otherSerial]);
    const countPosition=await insertInventoryPosition({...scope,parentId:null,code:"COUNT-SERIAL",name:"Serial count",kind:"bin",usage:"storage",canStore:true,isPickable:true,idempotencyKey:`serial-bin-${suffix}`});
    const otherPosition=await insertInventoryPosition({...scope,parentId:null,code:"OTHER-SERIAL",name:"Other serial",kind:"bin",usage:"storage",canStore:true,isPickable:true,idempotencyKey:`other-bin-${suffix}`});
    await query(`update inventory_serialized_units set current_position_id=case when id=$4 then $5::uuid else $3::uuid end where company_id=$1 and id=any($2::uuid[])`,[companyId,unitIds,countPosition.position.id,unitIds[2],otherPosition.position.id]);
    const started=await createPositionCount({...scope,positionId:countPosition.position.id,idempotencyKey:`serial-count-${suffix}`});
    assert.equal(started.count.lines.length,0);assert.equal(started.count.serialGroups[0].expectedCount,2);
    assert.equal((await savePositionCountIdentity({...scope,countId:started.count.id,serialNumber:"missing",inputMode:"manual",expectedVersion:started.count.version,idempotencyKey:`missing-${suffix}`})).kind,"serial_not_found");
    assert.equal((await savePositionCountIdentity({...scope,countId:started.count.id,serialNumber:otherSerial,inputMode:"scanner",expectedVersion:started.count.version,idempotencyKey:`cross-${suffix}`})).kind,"serial_not_found");
    assert.equal((await savePositionCountIdentity({...scope,countId:started.count.id,serialNumber:serials[2],inputMode:"scanner",expectedVersion:started.count.version,idempotencyKey:`wrong-${suffix}`})).kind,"serial_wrong_position");
    const first=await savePositionCountIdentity({...scope,countId:started.count.id,serialNumber:serials[0],inputMode:"scanner",expectedVersion:started.count.version,idempotencyKey:`scan-1-${suffix}`});
    assert.equal(first.kind,"observed");assert.equal(first.alreadyObserved,false);
    const afterFirst=await getPositionCount({...scope,countId:started.count.id});
    assert.equal((await applyPositionCountCorrection({...scope,isAdmin:true,countId:started.count.id,expectedVersion:afterFirst.version,idempotencyKey:`incomplete-${suffix}`,reason:"Incomplete serial count"})).kind,"incomplete");
    assert.equal((await query("select count(*)::int count from inventory_position_operations where company_id=$1 and count_session_id=$2",[companyId,started.count.id])).rows[0].count,0);
    const replay=await savePositionCountIdentity({...scope,countId:started.count.id,serialNumber:serials[0],inputMode:"scanner",expectedVersion:started.count.version,idempotencyKey:`scan-1-${suffix}`});
    assert.equal(replay.kind,"replay");
    const duplicate=await savePositionCountIdentity({...scope,countId:started.count.id,serialNumber:serials[0],inputMode:"manual",expectedVersion:afterFirst.version,idempotencyKey:`scan-duplicate-${suffix}`});
    assert.equal(duplicate.kind,"observed");assert.equal(duplicate.alreadyObserved,true);
    const afterDuplicate=await getPositionCount({...scope,countId:started.count.id});
    await savePositionCountIdentity({...scope,countId:started.count.id,serialNumber:serials[1],inputMode:"scanner",expectedVersion:afterDuplicate.version,idempotencyKey:`scan-2-${suffix}`});
    const observed=await getPositionCount({...scope,countId:started.count.id});assert.equal(observed.serialGroups[0].observedCount,2);
    await query("update inventory_serialized_units set custody_version=custody_version+1,updated_at=now()+interval '1 second' where company_id=$1 and id=$2",[companyId,unitIds[1]]);
    assert.equal((await applyPositionCountCorrection({...scope,isAdmin:true,countId:started.count.id,expectedVersion:observed.version,idempotencyKey:`stale-apply-${suffix}`,reason:"Serial count"})).kind,"needs_recount");
    assert.equal((await query("select count(*)::int count from inventory_position_operations where company_id=$1 and count_session_id=$2",[companyId,started.count.id])).rows[0].count,0);
    const restarted=await createPositionCount({...scope,positionId:countPosition.position.id,idempotencyKey:`serial-restart-${suffix}`});let version=restarted.count.version;
    for(let index=0;index<2;index+=1){await savePositionCountIdentity({...scope,countId:restarted.count.id,serialNumber:serials[index],inputMode:index?"manual":"scanner",expectedVersion:version,idempotencyKey:`rescan-${index}-${suffix}`});version=(await getPositionCount({...scope,countId:restarted.count.id})).version;}
    assert.equal((await applyPositionCountCorrection({...scope,isAdmin:true,countId:restarted.count.id,expectedVersion:version,idempotencyKey:`serial-apply-${suffix}`,reason:"Exact serial count"})).kind,"applied");
    const applied=await getPositionCount({...scope,countId:restarted.count.id});assert.equal(applied.status,"applied");assert.equal(applied.applyReason,"Exact serial count");
  }finally{
    for(const table of ["inventory_position_count_commands","inventory_position_count_unit_snapshots","inventory_position_count_lines","inventory_position_count_sessions","inventory_position_movements","inventory_position_operations","inventory_position_balances","inventory_positions","inventory_unit_events","inventory_serialized_units","inventory_receipt_lines","inventory_receipts","inventory_stock_movements","inventory_items","invoice_extraction_runs","parts_catalog","locations","companies"])
      await query(`delete from ${table} where company_id=$1`,[companyId]).catch(()=>{});
    for(const table of ["inventory_unit_events","inventory_serialized_units","inventory_receipt_lines","inventory_receipts","inventory_stock_movements","inventory_items","invoice_extraction_runs","parts_catalog","locations","companies"])
      await query(`delete from ${table} where company_id=$1`,[otherCompanyId]).catch(()=>{});
    await query("delete from user_profiles where id=$1",[actorId]).catch(()=>{});
  }
});

test("a serialized identity arriving after count start commits a restartable recount without stock mutation",{skip:!run},async()=>{
  const suffix=randomUUID().replaceAll("-","");const actorId=randomUUID(),companyId=randomUUID(),locationId=randomUUID();
  const aggregatePartId=randomUUID(),serialPartId=randomUUID(),inventoryItemId=randomUUID(),runId=randomUUID(),receiptId=randomUUID(),receiptLineId=randomUUID();
  const countedUnitId=randomUUID(),arrivingUnitId=randomUUID();
  const scope={actorId,companyIds:[companyId],locationIds:[locationId],isAdmin:false,locationId};
  try{
    await query("insert into user_profiles(id,display_name) values($1,'Arrival counter')",[actorId]);
    await query("insert into companies(id,slug,name) values($1,$2,'Arrival count')",[companyId,`arrival-count-${suffix}`]);
    await query("insert into locations(id,company_id,name) values($1,$2,'Arrival shop')",[locationId,companyId]);
    await query(`insert into parts_catalog(id,company_id,normalized_part_number,part_number,description,uom_code,tracking_mode) values
      ($1,$2,$3,$4,'Aggregate arrival part','ea','quantity'),($5,$2,$6,$7,'Serialized arrival part','ea','serialized')`,
    [aggregatePartId,companyId,`ARRAGG${suffix}`,`ARR-AGG-${suffix}`,serialPartId,`ARRSER${suffix}`,`ARR-SER-${suffix}`]);
    await query(`insert into inventory_items(id,company_id,location_id,catalog_part_id,normalized_part_number,part_number,description,quantity_on_hand,quantity_reserved,uom_code,source_provider,external_id)
      values($1,$2,$3,$4,$5,$6,'Aggregate arrival part',2,0,'ea','local',$7)`,
    [inventoryItemId,companyId,locationId,aggregatePartId,`ARRAGG${suffix}`,`ARR-AGG-${suffix}`,`arrival-item:${suffix}`]);
    await query(`insert into invoice_extraction_runs(id,company_id,location_id,created_by,reviewed_by,document_hash,file_name,mime_type,byte_size,idempotency_key,status,provider,model,prompt_version,reviewed_draft,reviewed_at)
      values($1,$2,$3,$4,$4,$5,'arrival-count.pdf','application/pdf',1,$6,'reviewed','local-test','local-test','local-v1','{}'::jsonb,now())`,
    [runId,companyId,locationId,actorId,`${suffix}${suffix}`,`arrival-run-${suffix}`]);
    await query(`insert into inventory_receipts(id,company_id,location_id,invoice_run_id,created_by,idempotency_key,provider,provider_marker,provider_picking_name,status,confirmed_at)
      values($1,$2,$3,$4,$5,$6,'local',$7,'Arrival count receipt','confirmed',now())`,
    [receiptId,companyId,locationId,runId,actorId,`arrival-receipt-${suffix}`,`ARRIVAL-${suffix}`]);
    await query(`insert into inventory_receipt_lines(id,company_id,receipt_id,line_index,catalog_part_id,product_external_id,part_number,description,quantity,uom_code,tracking_mode)
      values($1,$2,$3,0,$4,$5,$6,'Serialized arrival part',2,'ea','serial')`,
    [receiptLineId,companyId,receiptId,serialPartId,`local:${serialPartId}`,`ARR-SER-${suffix}`]);
    await query(`insert into inventory_serialized_units(id,company_id,location_id,receipt_id,receipt_line_id,unit_ordinal,serial_number,status,condition_code,custody_holder_type,custody_location_id)
      values($1,$2,$3,$4,$5,1,$6,'in_stock','new','inventory_location',$3),($7,$2,$3,$4,$5,2,$8,'in_stock','new','inventory_location',$3)`,
    [countedUnitId,companyId,locationId,receiptId,receiptLineId,`ARRIVAL-${suffix}-1`,arrivingUnitId,`ARRIVAL-${suffix}-2`]);
    const countPosition=await insertInventoryPosition({...scope,parentId:null,code:"ARRIVAL-COUNT",name:"Arrival count",kind:"bin",usage:"storage",canStore:true,isPickable:true,idempotencyKey:`arrival-count-bin-${suffix}`});
    const sourcePosition=await insertInventoryPosition({...scope,parentId:null,code:"ARRIVAL-SOURCE",name:"Arrival source",kind:"bin",usage:"storage",canStore:true,isPickable:true,idempotencyKey:`arrival-source-bin-${suffix}`});
    await query(`update inventory_serialized_units set current_position_id=case when id=$3 then $4::uuid else $5::uuid end where company_id=$1 and id=any($2::uuid[])`,
    [companyId,[countedUnitId,arrivingUnitId],countedUnitId,countPosition.position.id,sourcePosition.position.id]);
    await query(`insert into inventory_position_balances(company_id,location_id,position_id,inventory_item_id,catalog_part_id,uom_code,quantity)
      values($1,$2,$3,$4,$5,'ea',2)`,[companyId,locationId,countPosition.position.id,inventoryItemId,aggregatePartId]);

    const started=await createPositionCount({...scope,positionId:countPosition.position.id,idempotencyKey:`arrival-count-${suffix}`});
    assert.equal(started.count.lines.length,1);assert.equal(started.count.serialGroups[0].expectedCount,1);
    const moved=await moveInventoryStock({...scope,partId:serialPartId,move:{fromPositionId:sourcePosition.position.id,toPositionId:countPosition.position.id,
      unitIds:[arrivingUnitId],unitVersions:{},idempotencyKey:`arrival-move-${suffix}`,reason:"Post-start arrival"}});
    assert.equal(moved.kind,"moved");
    const before=await query(`select
      (select count(*)::int from inventory_position_operations where company_id=$1 and count_session_id=$2) operations,
      (select count(*)::int from inventory_position_movements where company_id=$1) position_movements,
      (select count(*)::int from inventory_stock_movements where company_id=$1) stock_movements`,[companyId,started.count.id]);
    const idempotencyKey=`arrival-scan-${suffix}`;
    const scanned=await savePositionCountIdentity({...scope,countId:started.count.id,serialNumber:`ARRIVAL-${suffix}-2`,inputMode:"scanner",expectedVersion:started.count.version,idempotencyKey});
    assert.equal(scanned.kind,"needs_recount");
    const recount=await getPositionCount({...scope,countId:started.count.id});
    assert.equal(recount.status,"needs_recount");assert.equal(recount.version,started.count.version+1);assert.equal(recount.lines[0].status,"needs_recount");
    const after=await query(`select
      (select count(*)::int from inventory_position_operations where company_id=$1 and count_session_id=$2) operations,
      (select count(*)::int from inventory_position_movements where company_id=$1) position_movements,
      (select count(*)::int from inventory_stock_movements where company_id=$1) stock_movements`,[companyId,started.count.id]);
    assert.deepEqual(after.rows[0],before.rows[0]);
    assert.deepEqual((await query(`select item.quantity_on_hand,balance.quantity from inventory_items item join inventory_position_balances balance
      on balance.company_id=item.company_id and balance.inventory_item_id=item.id and balance.position_id=$2 where item.company_id=$1 and item.id=$3`,[companyId,countPosition.position.id,inventoryItemId])).rows[0],{quantity_on_hand:"2.000",quantity:"2.000"});
    assert.equal((await query(`select count(*)::int count from inventory_position_count_commands where company_id=$1 and session_id=$2 and action='observe_identity'`,[companyId,started.count.id])).rows[0].count,1);
    assert.equal((await savePositionCountIdentity({...scope,countId:started.count.id,serialNumber:`ARRIVAL-${suffix}-2`,inputMode:"scanner",expectedVersion:started.count.version,idempotencyKey})).kind,"replay");
    assert.equal((await getPositionCount({...scope,countId:started.count.id})).version,recount.version);
    const restarted=await createPositionCount({...scope,positionId:countPosition.position.id,idempotencyKey:`arrival-restart-${suffix}`});
    assert.equal(restarted.kind,"created");assert.equal(restarted.count.serialGroups[0].expectedCount,2);
    assert.equal((await getPositionCount({...scope,countId:started.count.id})).status,"superseded");
  }finally{
    for(const table of ["inventory_position_count_commands","inventory_position_count_unit_snapshots","inventory_position_count_lines","inventory_position_count_sessions","inventory_position_movements","inventory_position_operations","inventory_position_balances","inventory_positions","inventory_unit_events","inventory_serialized_units","inventory_receipt_lines","inventory_receipts","inventory_stock_movements","inventory_items","invoice_extraction_runs","parts_catalog","locations","companies"])
      await query(`delete from ${table} where company_id=$1`,[companyId]).catch(()=>{});
    await query("delete from user_profiles where id=$1",[actorId]).catch(()=>{});
  }
});

test("count observations enforce whole quantity and measured UOM precision",{skip:!run},async()=>{
  const suffix=randomUUID().replaceAll("-","");const actorId=randomUUID(),companyId=randomUUID(),locationId=randomUUID();const quantityPart=randomUUID(),measuredPart=randomUUID();
  const scope={actorId,companyIds:[companyId],locationIds:[locationId],isAdmin:false,locationId};
  try{
    await query("insert into user_profiles(id,display_name) values($1,'Precision counter')",[actorId]);
    await query("insert into companies(id,slug,name) values($1,$2,'Precision count')",[companyId,`precision-${suffix}`]);
    await query("insert into locations(id,company_id,name) values($1,$2,'Precision shop')",[locationId,companyId]);
    await query(`insert into parts_catalog(id,company_id,normalized_part_number,part_number,description,uom_code,tracking_mode) values
      ($1,$2,$3,$4,'Whole part','ea','quantity'),($5,$2,$6,$7,'Measured part','l','measured_bulk')`,[quantityPart,companyId,`WHOLE${suffix}`,`WHOLE-${suffix}`,measuredPart,`MEASURED${suffix}`,`MEASURED-${suffix}`]);
    const items=await query(`insert into inventory_items(company_id,location_id,catalog_part_id,normalized_part_number,part_number,description,quantity_on_hand,quantity_reserved,uom_code,source_provider,external_id) values
      ($1,$2,$3,$4,$5,'Whole part',2,0,'ea','local',$6),($1,$2,$7,$8,$9,'Measured part',2,0,'l','local',$10) returning id,catalog_part_id`,
      [companyId,locationId,quantityPart,`WHOLE${suffix}`,`WHOLE-${suffix}`,`whole:${suffix}`,measuredPart,`MEASURED${suffix}`,`MEASURED-${suffix}`,`measured:${suffix}`]);
    const ids=new Map(items.rows.map((row)=>[row.catalog_part_id,row.id]));const position=await insertInventoryPosition({...scope,parentId:null,code:"PRECISION",name:"Precision",kind:"bin",usage:"storage",canStore:true,isPickable:true,idempotencyKey:`precision-bin-${suffix}`});
    await query(`insert into inventory_position_balances(company_id,location_id,position_id,inventory_item_id,catalog_part_id,uom_code,quantity) values
      ($1,$2,$3,$4,$5,'ea',2),($1,$2,$3,$6,$7,'l',2)`,[companyId,locationId,position.position.id,ids.get(quantityPart),quantityPart,ids.get(measuredPart),measuredPart]);
    const count=await createPositionCount({...scope,positionId:position.position.id,idempotencyKey:`precision-count-${suffix}`});const byPart=new Map(count.count.lines.map((line)=>[line.partId,line]));
    const whole=byPart.get(quantityPart),measured=byPart.get(measuredPart);
    assert.equal((await savePositionCountObservation({...scope,countId:count.count.id,lineId:whole.id,expectedVersion:whole.version,observedQuantity:1.5,idempotencyKey:`whole-bad-${suffix}`})).kind,"unsupported_uom");
    assert.equal((await savePositionCountObservation({...scope,countId:count.count.id,lineId:measured.id,expectedVersion:measured.version,observedQuantity:1.2345,idempotencyKey:`measured-bad-${suffix}`})).kind,"unsupported_uom");
    await savePositionCountObservation({...scope,countId:count.count.id,lineId:whole.id,expectedVersion:whole.version,observedQuantity:2,idempotencyKey:`whole-good-${suffix}`});
    await savePositionCountObservation({...scope,countId:count.count.id,lineId:measured.id,expectedVersion:measured.version,observedQuantity:1.234,idempotencyKey:`measured-good-${suffix}`});
    const observed=await getPositionCount({...scope,countId:count.count.id});assert.equal(observed.lines.find((line)=>line.partId===measuredPart).difference,-0.766);assert.equal(observed.lines.find((line)=>line.partId===measuredPart).observedBy.id,actorId);
    const applyInput={...scope,isAdmin:true,countId:count.count.id,expectedVersion:observed.version,idempotencyKey:`precision-apply-${suffix}`,reason:"Precision count"};
    await assert.rejects(()=>applyPositionCountCorrection(applyInput,{afterPreflight:async()=>{throw new Error("injected count failure");}}),/injected count failure/);
    assert.equal((await query("select count(*)::int count from inventory_position_operations where company_id=$1 and count_session_id=$2",[companyId,count.count.id])).rows[0].count,0);
    assert.equal((await getPositionCount({...scope,countId:count.count.id})).status,"open");
    assert.equal((await applyPositionCountCorrection(applyInput)).kind,"applied");
  }finally{
    for(const table of ["inventory_position_count_commands","inventory_position_count_unit_snapshots","inventory_position_count_lines","inventory_position_count_sessions","inventory_position_movements","inventory_position_operations","inventory_position_balances","inventory_positions","inventory_stock_movements","inventory_items","parts_catalog","locations","companies"])
      await query(`delete from ${table} where company_id=$1`,[companyId]).catch(()=>{});
    await query("delete from user_profiles where id=$1",[actorId]).catch(()=>{});
  }
});

test("a multi-item count releases partial locks when a receipt owns the inverse item order",{skip:!run},async()=>{
  const suffix=randomUUID().replaceAll("-","");const actorId=randomUUID(),companyId=randomUUID(),locationId=randomUUID();
  const partIds=[randomUUID(),randomUUID()];const itemIds=[randomUUID(),randomUUID()].sort();
  const scope={actorId,companyIds:[companyId],locationIds:[locationId],isAdmin:false,locationId};
  let writer;
  try{
    await query("insert into user_profiles(id,display_name) values($1,'Inverse receipt race')",[actorId]);
    await query("insert into companies(id,slug,name) values($1,$2,'Inverse receipt race')",[companyId,`inverse-receipt-${suffix}`]);
    await query("insert into locations(id,company_id,name) values($1,$2,'Inverse receipt shop')",[locationId,companyId]);
    await query(`insert into parts_catalog(id,company_id,normalized_part_number,part_number,description,uom_code,tracking_mode)
      values($1,$2,$3,$4,'Low item','ea','quantity'),($5,$2,$6,$7,'High item','ea','quantity')`,
    [partIds[0],companyId,`LOW${suffix}`,`LOW-${suffix}`,partIds[1],`HIGH${suffix}`,`HIGH-${suffix}`]);
    await query(`insert into inventory_items(id,company_id,location_id,catalog_part_id,normalized_part_number,part_number,description,quantity_on_hand,quantity_reserved,uom_code,source_provider,external_id)
      values($1,$3,$4,$5,$6,$7,'Low item',2,0,'ea','local',$8),($2,$3,$4,$9,$10,$11,'High item',2,0,'ea','local',$12)`,
    [itemIds[0],itemIds[1],companyId,locationId,partIds[0],`LOW${suffix}`,`LOW-${suffix}`,`low:${suffix}`,partIds[1],`HIGH${suffix}`,`HIGH-${suffix}`,`high:${suffix}`]);
    const setup=await getPool().connect();let positionId;
    try{await setup.query("begin");positionId=await ensureSystemInventoryPosition(setup,{companyId,locationId,systemKey:"unassigned"});
      await setup.query(`insert into inventory_position_balances(company_id,location_id,position_id,inventory_item_id,catalog_part_id,uom_code,quantity)
        values($1,$2,$3,$4,$5,'ea',2),($1,$2,$3,$6,$7,'ea',2)`,[companyId,locationId,positionId,itemIds[0],partIds[0],itemIds[1],partIds[1]]);await setup.query("commit");}finally{setup.release();}
    const count=await createPositionCount({...scope,positionId,idempotencyKey:`inverse-count-${suffix}`});
    for(const line of count.count.lines)await savePositionCountObservation({...scope,countId:count.count.id,lineId:line.id,expectedVersion:line.version,observedQuantity:line.expectedQuantity,idempotencyKey:`inverse-observe-${line.id}`});
    const refreshed=await getPositionCount({...scope,countId:count.count.id});
    const applyInput={...scope,isAdmin:true,countId:count.count.id,expectedVersion:refreshed.version,idempotencyKey:`inverse-apply-${suffix}`,reason:"Inverse receipt count"};
    writer=await getPool().connect();await writer.query("begin");await writer.query("set local lock_timeout='2s'");
    await writer.query("select id from inventory_items where company_id=$1 and id=$2 for update",[companyId,itemIds[1]]);
    const started=Date.now();const busy=await applyPositionCountCorrection(applyInput);
    assert.equal(busy.kind,"stock_busy");assert.ok(Date.now()-started<1000,"count lock conflict should return promptly");
    assert.equal((await query("select count(*)::int count from inventory_position_operations where company_id=$1 and count_session_id=$2",[companyId,count.count.id])).rows[0].count,0);
    await writer.query("select id from inventory_items where company_id=$1 and id=$2 for update",[companyId,itemIds[0]]);
    await writer.query("update inventory_items set quantity_on_hand=quantity_on_hand+1,updated_at=now() where company_id=$1 and id=$2",[companyId,itemIds[1]]);
    await placeAggregateInventoryReceipt(writer,{companyId,locationId,inventoryItemId:itemIds[1],catalogPartId:partIds[1],uomCode:"ea",quantity:1,actorId,idempotencyKey:`inverse-receipt-${suffix}`,systemKey:"unassigned"});
    await writer.query("commit");writer.release();writer=null;
    assert.equal((await applyPositionCountCorrection(applyInput)).kind,"needs_recount");
    const totals=await query(`select item.id,item.quantity_on_hand,balance.quantity from inventory_items item join inventory_position_balances balance
      on balance.company_id=item.company_id and balance.inventory_item_id=item.id and balance.position_id=$2 where item.company_id=$1 order by item.id`,[companyId,positionId]);
    assert.deepEqual(totals.rows.map((row)=>[row.quantity_on_hand,row.quantity]),[["2.000","2.000"],["3.000","3.000"]]);
  }finally{
    if(writer){await writer.query("rollback").catch(()=>{});writer.release();}
    for(const table of ["inventory_position_count_commands","inventory_position_count_unit_snapshots","inventory_position_count_lines","inventory_position_count_sessions","inventory_position_movements","inventory_position_operations","inventory_aggregate_usage_position_allocations","inventory_position_balances","inventory_position_admin_commands","inventory_position_reconciliation_exceptions","inventory_positions","inventory_stock_movements","inventory_items","parts_catalog","locations","companies"])
      await query(`delete from ${table} where company_id=$1`,[companyId]).catch(()=>{});
    await query("delete from user_profiles where id=$1",[actorId]).catch(()=>{});
  }
});

test("a position-busy count releases its counted item so the receipt can finish",{skip:!run},async()=>{
  const suffix=randomUUID().replaceAll("-","");const actorId=randomUUID(),companyId=randomUUID(),locationId=randomUUID();
  const countedPartId=randomUUID(),unrelatedPartId=randomUUID(),countedItemId=randomUUID(),unrelatedItemId=randomUUID();
  const scope={actorId,companyIds:[companyId],locationIds:[locationId],isAdmin:false,locationId};
  let writer,releaseCount;
  try{
    await query("insert into user_profiles(id,display_name) values($1,'Position busy race')",[actorId]);
    await query("insert into companies(id,slug,name) values($1,$2,'Position busy race')",[companyId,`position-busy-${suffix}`]);
    await query("insert into locations(id,company_id,name) values($1,$2,'Position busy shop')",[locationId,companyId]);
    await query(`insert into parts_catalog(id,company_id,normalized_part_number,part_number,description,uom_code,tracking_mode)
      values($1,$2,$3,$4,'Counted item','ea','quantity'),($5,$2,$6,$7,'Unrelated item','ea','quantity')`,
    [countedPartId,companyId,`COUNTED${suffix}`,`COUNTED-${suffix}`,unrelatedPartId,`UNRELATED${suffix}`,`UNRELATED-${suffix}`]);
    await query(`insert into inventory_items(id,company_id,location_id,catalog_part_id,normalized_part_number,part_number,description,quantity_on_hand,quantity_reserved,uom_code,source_provider,external_id)
      values($1,$3,$4,$5,$6,$7,'Counted item',2,0,'ea','local',$8),($2,$3,$4,$9,$10,$11,'Unrelated item',1,0,'ea','local',$12)`,
    [countedItemId,unrelatedItemId,companyId,locationId,countedPartId,`COUNTED${suffix}`,`COUNTED-${suffix}`,`counted:${suffix}`,unrelatedPartId,`UNRELATED${suffix}`,`UNRELATED-${suffix}`,`unrelated:${suffix}`]);
    const setup=await getPool().connect();let positionId;
    try{await setup.query("begin");positionId=await ensureSystemInventoryPosition(setup,{companyId,locationId,systemKey:"unassigned"});
      await setup.query(`insert into inventory_position_balances(company_id,location_id,position_id,inventory_item_id,catalog_part_id,uom_code,quantity)
        values($1,$2,$3,$4,$5,'ea',2)`,[companyId,locationId,positionId,countedItemId,countedPartId]);await setup.query("commit");}finally{setup.release();}
    const count=await createPositionCount({...scope,positionId,idempotencyKey:`position-busy-count-${suffix}`});const line=count.count.lines[0];
    await savePositionCountObservation({...scope,countId:count.count.id,lineId:line.id,expectedVersion:line.version,observedQuantity:line.expectedQuantity,idempotencyKey:`position-busy-observe-${suffix}`});
    const refreshed=await getPositionCount({...scope,countId:count.count.id});
    const applyInput={...scope,isAdmin:true,countId:count.count.id,expectedVersion:refreshed.version,idempotencyKey:`position-busy-apply-${suffix}`,reason:"Position busy count"};
    writer=await getPool().connect();const writerPid=(await writer.query("select pg_backend_pid() pid")).rows[0].pid;
    await writer.query("begin");await writer.query("set local lock_timeout='2s'");
    await writer.query("select id from inventory_items where company_id=$1 and id=$2 for update",[companyId,unrelatedItemId]);
    await writer.query("select id from inventory_positions where company_id=$1 and id=$2 for update",[companyId,positionId]);
    const entered=deferred();releaseCount=deferred();
    const applying=applyPositionCountCorrection(applyInput,{afterItemLocks:async()=>{entered.resolve();await releaseCount.promise;}});
    await entered.promise;
    const writerFinishing=(async()=>{
      await writer.query("select id from inventory_items where company_id=$1 and id=$2 for update",[companyId,countedItemId]);
      await writer.query("update inventory_items set quantity_on_hand=quantity_on_hand+1,updated_at=now() where company_id=$1 and id=$2",[companyId,countedItemId]);
      await placeAggregateInventoryReceipt(writer,{companyId,locationId,inventoryItemId:countedItemId,catalogPartId:countedPartId,uomCode:"ea",quantity:1,actorId,idempotencyKey:`position-busy-receipt-${suffix}`,systemKey:"unassigned"});
      await writer.query("commit");writer.release();writer=null;
    })();
    await waitUntilBlocked(writerPid);releaseCount.resolve();releaseCount=null;
    assert.equal((await applying).kind,"stock_busy");
    await writerFinishing;
    assert.equal((await applyPositionCountCorrection(applyInput)).kind,"needs_recount");
    assert.deepEqual((await query(`select item.quantity_on_hand,balance.quantity from inventory_items item join inventory_position_balances balance
      on balance.company_id=item.company_id and balance.inventory_item_id=item.id where item.company_id=$1 and item.id=$2`,[companyId,countedItemId])).rows[0],{quantity_on_hand:"3.000",quantity:"3.000"});
  }finally{
    releaseCount?.resolve();
    if(writer){await writer.query("rollback").catch(()=>{});writer.release();}
    for(const table of ["inventory_position_count_commands","inventory_position_count_unit_snapshots","inventory_position_count_lines","inventory_position_count_sessions","inventory_position_movements","inventory_position_operations","inventory_aggregate_usage_position_allocations","inventory_position_balances","inventory_position_admin_commands","inventory_position_reconciliation_exceptions","inventory_positions","inventory_stock_movements","inventory_items","parts_catalog","locations","companies"])
      await query(`delete from ${table} where company_id=$1`,[companyId]).catch(()=>{});
    await query("delete from user_profiles where id=$1",[actorId]).catch(()=>{});
  }
});

test("a found aggregate part applies as a count adjustment without fabricating purchasing or receipt history",{skip:!run},async()=>{
  const suffix=randomUUID().replaceAll("-","");const actorId=randomUUID(),companyId=randomUUID(),locationId=randomUUID(),partId=randomUUID();
  const scope={actorId,companyIds:[companyId],locationIds:[locationId],isAdmin:false,locationId};
  try{
    await query("insert into user_profiles(id,display_name) values($1,'Found count integration')",[actorId]);
    await query("insert into companies(id,slug,name) values($1,$2,'Found count integration')",[companyId,`found-count-${suffix}`]);
    await query("insert into locations(id,company_id,name) values($1,$2,'Found count shop')",[locationId,companyId]);
    await query(`insert into parts_catalog(id,company_id,normalized_part_number,part_number,description,uom_code,tracking_mode)
      values($1,$2,$3,$4,'Found count part','ea','quantity')`,[partId,companyId,`FOUND${suffix}`,`FOUND-${suffix}`]);
    const setup=await getPool().connect();let positionId;
    try{await setup.query("begin");positionId=await ensureSystemInventoryPosition(setup,{companyId,locationId,systemKey:"unassigned"});await setup.query("commit");}finally{setup.release();}
    const started=await createPositionCount({...scope,positionId,idempotencyKey:`found-start-${suffix}`});
    assert.equal(started.count.lines.length,0);
    assert.equal((await addPositionCountFoundPart({...scope,countId:started.count.id,catalogPartId:partId,expectedPartVersion:1,observedQuantity:3,expectedVersion:started.count.version,idempotencyKey:`found-line-${suffix}`})).kind,"observed");
    assert.equal((await addPositionCountFoundPart({...scope,countId:started.count.id,catalogPartId:partId,expectedPartVersion:1,observedQuantity:3,expectedVersion:started.count.version,idempotencyKey:`found-line-${suffix}`})).kind,"replay");
    const observed=await getPositionCount({...scope,countId:started.count.id});
    assert.deepEqual(observed.lines.map((line)=>({source:line.lineSource,expected:line.expectedQuantity,observed:line.observedQuantity})),[{source:"found",expected:0,observed:3}]);
    assert.equal((await applyPositionCountCorrection({...scope,isAdmin:true,countId:started.count.id,expectedVersion:observed.version,idempotencyKey:`found-apply-${suffix}`,reason:"Found during physical count"})).kind,"applied");
    const ledger=await query(`select item.quantity_on_hand,balance.quantity,
      (select count(*)::int from local_inventory_receipts receipt where receipt.company_id=$1) receipt_count,
      (select count(*)::int from inventory_purchase_orders purchase where purchase.company_id=$1) purchase_count,
      (select count(*)::int from inventory_stock_movements movement where movement.company_id=$1 and movement.catalog_part_id=$2 and movement.movement_type='adjustment') adjustment_count
      from inventory_items item join inventory_position_balances balance on balance.company_id=item.company_id and balance.inventory_item_id=item.id and balance.position_id=$3
      where item.company_id=$1 and item.catalog_part_id=$2`,[companyId,partId,positionId]);
    assert.deepEqual(ledger.rows[0],{quantity_on_hand:"3.000",quantity:"3.000",receipt_count:0,purchase_count:0,adjustment_count:1});
  }finally{
    for(const table of ["inventory_position_count_commands","inventory_position_count_unit_snapshots","inventory_position_count_lines","inventory_position_count_sessions","inventory_position_movements","inventory_position_operations","inventory_aggregate_usage_position_allocations","inventory_position_balances","inventory_position_admin_commands","inventory_position_reconciliation_exceptions","inventory_positions","inventory_stock_movements","inventory_items","parts_catalog","locations","companies"])
      await query(`delete from ${table} where company_id=$1`,[companyId]).catch(()=>{});
    await query("delete from user_profiles where id=$1",[actorId]).catch(()=>{});
  }
});
