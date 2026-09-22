import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after,test } from "node:test";
import { closePool,query } from "../../db/pool.js";
import { receiveDirectInventory } from "./direct-inventory-receipt.service.js";
import { getInventoryReports } from "./inventory-reports.service.js";
import { getStockTask,getStockTaskSnapshot,postStockTask } from "./inventory-stock-tasks.service.js";

const run=process.env.RUN_DIRECT_RECEIPT_INTEGRATION==="1";
if(run){
 const database=new URL(process.env.DATABASE_URL);
 assert.ok(["localhost","127.0.0.1","[::1]"].includes(database.hostname)&&/^\/receipt_test_[a-f0-9]+$/.test(database.pathname),"Use scripts/qa/run-direct-receipt-integration.js with its disposable database.");
}
after(async()=>{if(run)await closePool();});

test("stock-task transfers reconcile accounting and physical positions for aggregate and exact stock",{skip:!run},async()=>{
 const companyId=randomUUID(),source=randomUUID(),destination=randomUUID(),actorId=randomUUID();
 const aggregatePartId=randomUUID(),exactPartId=randomUUID(),destinationPositionId=randomUUID();
 const context={actor:{id:actorId,role:"office"},companyIds:new Set([companyId]),locationIds:new Set([source,destination])};
 await query("insert into companies(id,slug,name) values($1,$2,'Stock task position test')",[companyId,`stock-task-${companyId}`]);
 await query("insert into locations(id,company_id,name) values($1,$3,'Source'),($2,$3,'Destination')",[source,destination,companyId]);
 await query("insert into user_profiles(id,display_name) values($1,'Stock task position operator')",[actorId]);
  await query("insert into inventory_positions(id,company_id,location_id,code,name,kind,usage,can_store,is_pickable,created_by) values($1,$2,$3,'DEST-A-01','Destination A-01','bin','storage',true,true,$4)",[destinationPositionId,companyId,destination,actorId]);
 await query(`insert into parts_catalog(id,company_id,part_number,normalized_part_number,description,uom_code,tracking_mode) values
  ($1,$3,'TASK-BULK','TASKBULK','Task aggregate','ea','quantity'),($2,$3,'TASK-EXACT','TASKEXACT','Task exact','ea','serialized')`,[aggregatePartId,exactPartId,companyId]);
 const receive=(catalogPartId,trackingMode,changes={})=>receiveDirectInventory({locationId:source,catalogPartId,expectedPartVersion:1,trackingMode,uomCode:"ea",quantity:trackingMode==="serialized"?1:5,
  serialNumbers:trackingMode==="serialized"?["TASK-SERIAL-1"]:undefined,idempotencyKey:randomUUID(),confirmation:"new_company_stock_received",noPurchaseOrderReason:"Starting stock fixture",...changes},context);
 await receive(aggregatePartId,"quantity");
 await receive(exactPartId,"serialized");
 const send=(body)=>postStockTask({locationId:source,reason:"Verified physical transfer",idempotencyKey:randomUUID(),...body},context);
 const aggregateSnapshot=await getStockTaskSnapshot(new URLSearchParams({locationId:source,catalogPartId:aggregatePartId}),context);
 let aggregate=(await send({action:"transfer",catalogPartId:aggregatePartId,quantity:2,sourceAllocations:[{positionId:aggregateSnapshot.positions[0].positionId,quantity:2}],expectedBalanceRevision:aggregateSnapshot.revision,holder:"Driver",destinationId:destination})).task;
 await assert.rejects(send({action:"receive_transfer",locationId:destination,taskId:aggregate.id,expectedVersion:aggregate.version,quantity:2,holder:"Receiving"}));
 await assert.rejects(send({action:"receive_transfer",locationId:destination,taskId:aggregate.id,expectedVersion:aggregate.version,quantity:2,holder:"Receiving",targetPositionId:randomUUID()}),(error)=>error.code==="INVENTORY_RECEIPT_POSITION_INVALID"&&error.statusCode===422);
 const failedReceiptState=await query(`select
   (select count(*)::int from inventory_items where company_id=$1 and location_id=$2 and catalog_part_id=$3) items,
   (select count(*)::int from inventory_position_movements where company_id=$1 and location_id=$2 and catalog_part_id=$3) movements`,[companyId,destination,aggregatePartId]);
 assert.deepEqual(failedReceiptState.rows[0],{items:0,movements:0});
 aggregate=(await send({action:"receive_transfer",locationId:destination,taskId:aggregate.id,expectedVersion:aggregate.version,quantity:2,holder:"Receiving",targetPositionId:destinationPositionId})).task;
 assert.equal(aggregate.status,"received");
 const exactSnapshot=await getStockTaskSnapshot(new URLSearchParams({locationId:source,catalogPartId:exactPartId}),context);
 let exact=(await send({action:"transfer",catalogPartId:exactPartId,quantity:1,expectedBalanceRevision:exactSnapshot.revision,serialNumbers:["TASK-SERIAL-1"],holder:"Driver",destinationId:destination})).task;
 assert.equal(exact.source_provenance.status,'exact_units');assert.equal(exact.source_provenance.receiptLines.length,1);
 const originalUnit=(await query("select custody_version from inventory_serialized_units where company_id=$1 and serial_number='TASK-SERIAL-1'",[companyId])).rows[0];
 await query("update inventory_serialized_units set custody_version=custody_version+1 where company_id=$1 and serial_number='TASK-SERIAL-1'",[companyId]);
 await assert.rejects(send({action:'receive_transfer',locationId:destination,taskId:exact.id,expectedVersion:exact.version,quantity:1,serialNumbers:['TASK-SERIAL-1'],holder:'Receiving',targetPositionId:destinationPositionId}),error=>error.code==='INVENTORY_TASK_CONFLICT');
 await query("update inventory_serialized_units set custody_version=$2 where company_id=$1 and serial_number='TASK-SERIAL-1'",[companyId,originalUnit.custody_version]);
 exact=(await send({action:"receive_transfer",locationId:destination,taskId:exact.id,expectedVersion:exact.version,quantity:1,serialNumbers:["TASK-SERIAL-1"],holder:"Receiving",targetPositionId:destinationPositionId})).task;
 assert.equal(exact.status,"received");
 const accounting=await query(`select location_id,catalog_part_id,quantity_on_hand from inventory_items where company_id=$1 and catalog_part_id=any($2::uuid[]) order by catalog_part_id,location_id`,[companyId,[aggregatePartId,exactPartId]]);
 const quantity=(part,location)=>Number(accounting.rows.find(row=>row.catalog_part_id===part&&row.location_id===location)?.quantity_on_hand||0);
 assert.equal(quantity(aggregatePartId,source),3);assert.equal(quantity(aggregatePartId,destination),2);
 assert.equal(quantity(exactPartId,source),0);assert.equal(quantity(exactPartId,destination),1);
 const positioned=await query(`select catalog_part_id,location_id,sum(quantity)::text quantity from (
   select catalog_part_id,location_id,quantity from inventory_position_balances where company_id=$1
   union all select line.catalog_part_id,unit.location_id,1::numeric from inventory_serialized_units unit join inventory_receipt_lines line
     on line.company_id=unit.company_id and line.id=unit.receipt_line_id where unit.company_id=$1 and unit.current_position_id is not null
  ) stock group by catalog_part_id,location_id`,[companyId]);
 const physical=(part,location)=>Number(positioned.rows.find(row=>row.catalog_part_id===part&&row.location_id===location)?.quantity||0);
 assert.equal(physical(aggregatePartId,source),3);assert.equal(physical(aggregatePartId,destination),2);
 assert.equal(physical(exactPartId,source),0);assert.equal(physical(exactPartId,destination),1);
 const exactUnit=(await query("select location_id,current_position_id,status,custody_holder_type from inventory_serialized_units where company_id=$1 and serial_number='TASK-SERIAL-1'",[companyId])).rows[0];
 assert.equal(exactUnit.location_id,destination);assert.equal(exactUnit.current_position_id,destinationPositionId);assert.equal(exactUnit.status,"in_stock");assert.equal(exactUnit.custody_holder_type,"inventory_location");
 const evidence=await query(`select operation.command_type,movement.location_id,movement.from_position_id,movement.to_position_id,movement.unit_id
   from inventory_position_operations operation join inventory_position_movements movement on movement.company_id=operation.company_id and movement.operation_id=operation.id
   where operation.company_id=$1 and operation.reason like 'Stock task %' order by movement.event_ordinal`,[companyId]);
 assert.ok(evidence.rows.some(row=>row.location_id===source&&row.from_position_id));
 assert.ok(evidence.rows.some(row=>row.location_id===destination&&row.to_position_id===destinationPositionId));
 assert.ok(evidence.rows.some(row=>row.unit_id&&row.location_id===source&&row.from_position_id));
 assert.ok(evidence.rows.some(row=>row.unit_id&&row.location_id===destination&&row.to_position_id));
});

test("stock-task destination rejects replay drift and every ineligible position without mutation",{skip:!run},async()=>{
 const companyId=randomUUID(),source=randomUUID(),destination=randomUUID(),other=randomUUID(),actorId=randomUUID();
 const aggregatePartId=randomUUID(),serialPartId=randomUUID();
 const ids={sourceStorage:randomUUID(),destinationStorage:randomUUID(),alternateStorage:randomUUID(),inactive:randomUUID(),receiving:randomUUID(),notStorable:randomUUID(),notPickable:randomUUID(),wrongShop:randomUUID(),sourceReceiving:randomUUID(),sourceUnassigned:randomUUID(),sourceInactive:randomUUID(),sourceNotStorable:randomUUID(),sourceNotPickable:randomUUID()};
 const context={actor:{id:actorId,role:"office"},companyIds:new Set([companyId]),locationIds:new Set([source,destination,other])};
 const admin={...context,actor:{id:actorId,role:"admin"}};
 await query("insert into companies(id,slug,name) values($1,$2,'Stock task target guards')",[companyId,`stock-target-${companyId}`]);
 await query("insert into locations(id,company_id,name) values($1,$4,'Source'),($2,$4,'Destination'),($3,$4,'Other')",[source,destination,other,companyId]);
 await query("insert into user_profiles(id,display_name) values($1,'Stock task target operator')",[actorId]);
 const position=(id,location,code,usage,canStore,isPickable,isActive=true,systemKey=null)=>query(`insert into inventory_positions(id,company_id,location_id,code,name,kind,usage,can_store,is_pickable,is_active,system_key,created_by)
   values($1,$2,$3,$4,$4,'bin',$5,$6,$7,$8,$9,$10)`,[id,companyId,location,code,usage,canStore,isPickable,isActive,systemKey,actorId]);
 await position(ids.sourceStorage,source,"SOURCE-STORAGE","storage",true,true);
 await position(ids.destinationStorage,destination,"DEST-STORAGE","storage",true,true);
 await position(ids.alternateStorage,destination,"DEST-ALT","storage",true,true);
 await position(ids.inactive,destination,"DEST-INACTIVE","storage",true,true,false);
 await position(ids.receiving,destination,"SYS-RECEIVING","receiving",true,true,true,"receiving");
 await position(ids.notStorable,destination,"DEST-NO-STORE",null,false,false);
 await position(ids.notPickable,destination,"DEST-NO-PICK","storage",true,false);
 await position(ids.wrongShop,other,"OTHER-STORAGE","storage",true,true);
 await position(ids.sourceReceiving,source,"SYS-RECEIVING","receiving",true,true,true,"receiving");
 await position(ids.sourceUnassigned,source,"SYS-UNASSIGNED","unassigned",true,true,true,"unassigned");
 await position(ids.sourceInactive,source,"SOURCE-INACTIVE","storage",true,true,false);
 await position(ids.sourceNotStorable,source,"SOURCE-NO-STORE",null,false,false);
 await position(ids.sourceNotPickable,source,"SOURCE-NO-PICK","storage",true,false);
 await query(`insert into parts_catalog(id,company_id,part_number,normalized_part_number,description,uom_code,tracking_mode) values
   ($1,$3,'TARGET-BULK','TARGETBULK','Target aggregate','ea','quantity'),($2,$3,'TARGET-SERIAL','TARGETSERIAL','Target serial','ea','serialized')`,[aggregatePartId,serialPartId,companyId]);
 const receive=(catalogPartId,trackingMode,extra={})=>receiveDirectInventory({locationId:source,catalogPartId,expectedPartVersion:1,trackingMode,uomCode:"ea",quantity:trackingMode==="serialized"?1:4,serialNumbers:trackingMode==="serialized"?["TARGET-SERIAL-1"]:undefined,idempotencyKey:randomUUID(),confirmation:"new_company_stock_received",noPurchaseOrderReason:"Starting stock fixture",...extra},context);
 await receive(aggregatePartId,"quantity");await receive(serialPartId,"serialized");
 const send=(body,requestContext=context)=>postStockTask({locationId:source,reason:"Physical target guard",idempotencyKey:randomUUID(),...body},requestContext);
 const destinationState=async(taskId,partId)=> (await query(`select
   (select json_build_object('status',status,'version',version,'completed',completed_quantity) from inventory_stock_tasks where company_id=$1 and id=$2) task,
   (select count(*)::int from inventory_items where company_id=$1 and location_id=$3 and catalog_part_id=$4) items,
   (select count(*)::int from inventory_position_movements where company_id=$1 and location_id=$3 and catalog_part_id=$4) movements`,[companyId,taskId,destination,partId])).rows[0];
 const aggregateSnapshot=await getStockTaskSnapshot(new URLSearchParams({locationId:source,catalogPartId:aggregatePartId}),context);
 let transfer=(await send({action:"transfer",catalogPartId:aggregatePartId,quantity:3,sourceAllocations:[{positionId:aggregateSnapshot.positions[0].positionId,quantity:3}],expectedBalanceRevision:aggregateSnapshot.revision,holder:"Carrier",destinationId:destination})).task;
 const beforeInvalid=await destinationState(transfer.id,aggregatePartId);
 const invalidTargets=[ids.inactive,ids.notStorable,ids.notPickable,ids.wrongShop,randomUUID()];
 for(const targetPositionId of invalidTargets){
   await assert.rejects(send({action:"receive_transfer",locationId:destination,taskId:transfer.id,expectedVersion:transfer.version,quantity:2,holder:"Destination rack",targetPositionId}),(error)=>error.code==="INVENTORY_RECEIPT_POSITION_INVALID"&&error.statusCode===422);
   assert.deepEqual(await destinationState(transfer.id,aggregatePartId),beforeInvalid);
 }
 await assert.rejects(send({action:"receive_transfer",locationId:destination,taskId:transfer.id,expectedVersion:transfer.version,quantity:2,holder:"Destination rack"}));
 assert.deepEqual(await destinationState(transfer.id,aggregatePartId),beforeInvalid);
 transfer=(await send({action:"receive_transfer",locationId:destination,taskId:transfer.id,expectedVersion:transfer.version,quantity:1,holder:"Receiving area",targetPositionId:ids.receiving})).task;
 assert.equal(transfer.status,"in_transit");
 assert.equal((await query("select quantity from inventory_position_balances where company_id=$1 and location_id=$2 and position_id=$3 and catalog_part_id=$4",[companyId,destination,ids.receiving,aggregatePartId])).rows[0].quantity,"1.000");
 const replayKey=randomUUID();
 const receipt={action:"receive_transfer",locationId:destination,taskId:transfer.id,expectedVersion:transfer.version,quantity:2,holder:"Destination rack",targetPositionId:ids.destinationStorage,idempotencyKey:replayKey};
 const first=(await send(receipt)); const afterFirst=await destinationState(transfer.id,aggregatePartId);
 const replay=(await send(receipt));
 assert.equal(replay.replayed,true);assert.equal(replay.task.id,first.task.id);assert.deepEqual(await destinationState(transfer.id,aggregatePartId),afterFirst);
 await assert.rejects(send({...receipt,targetPositionId:ids.alternateStorage}),(error)=>error.code==="INVENTORY_TASK_CONFLICT");
 await assert.rejects(send({...receipt,quantity:1}),(error)=>error.code==="INVENTORY_TASK_CONFLICT");
 assert.deepEqual(await destinationState(transfer.id,aggregatePartId),afterFirst);
 const aggregateReleaseSnapshot=await getStockTaskSnapshot(new URLSearchParams({locationId:source,catalogPartId:aggregatePartId}),context);
 let aggregateDamage=(await send({action:"damage",catalogPartId:aggregatePartId,quantity:1,expectedBalanceRevision:aggregateReleaseSnapshot.revision,holder:"Hold"})).task;
 await query("insert into inventory_reuse_capability_grants(company_id,location_id,user_id,capability,granted_by_user_id) select $1,$2,$3,cap,$3 from unnest(array['release']) cap",[companyId,source,actorId]);
 await query("insert into inventory_reuse_catalog_policies(company_id,location_id,catalog_part_id,reuse_allowed,repair_allowed,scrap_allowed,evidence,updated_by_user_id) values($1,$2,$3,true,false,false,'Target guard',$4)",[companyId,source,aggregatePartId,actorId]);
 const releaseState=async()=> (await query(`select
   (select json_build_object('status',status,'version',version) from inventory_stock_tasks where company_id=$1 and id=$2) task,
   (select count(*)::int from inventory_position_movements where company_id=$1 and location_id=$3 and catalog_part_id=$4) movements`,[companyId,aggregateDamage.id,source,aggregatePartId])).rows[0];
 const beforeRelease=await releaseState();
 for(const targetPositionId of [ids.sourceReceiving,ids.sourceUnassigned,ids.sourceInactive,ids.sourceNotStorable,ids.sourceNotPickable,ids.wrongShop,randomUUID()]){
   await assert.rejects(send({action:"release",taskId:aggregateDamage.id,expectedVersion:aggregateDamage.version,holder:"Inspected shelf",targetPositionId},admin),(error)=>error.code==="INVENTORY_RECEIPT_POSITION_INVALID"&&error.statusCode===422);
   assert.deepEqual(await releaseState(),beforeRelease);
 }
 await assert.rejects(send({action:"release",taskId:aggregateDamage.id,expectedVersion:aggregateDamage.version,holder:"Inspected shelf"},admin));
 aggregateDamage=(await send({action:"release",taskId:aggregateDamage.id,expectedVersion:aggregateDamage.version,holder:"Inspected shelf",targetPositionId:ids.sourceStorage},admin)).task;
 assert.equal(aggregateDamage.status,"released");
 const serialSnapshot=await getStockTaskSnapshot(new URLSearchParams({locationId:source,catalogPartId:serialPartId}),context);
 let serialDamage=(await send({action:"damage",catalogPartId:serialPartId,quantity:1,expectedBalanceRevision:serialSnapshot.revision,holder:"Hold",serialNumbers:["TARGET-SERIAL-1"]})).task;
 await query("insert into inventory_reuse_capability_grants(company_id,location_id,user_id,capability,granted_by_user_id) values($1,$2,$3,'release',$3) on conflict do nothing",[companyId,source,actorId]);
 await query("insert into inventory_reuse_catalog_policies(company_id,location_id,catalog_part_id,reuse_allowed,repair_allowed,scrap_allowed,evidence,updated_by_user_id) values($1,$2,$3,true,false,false,'Target guard',$4)",[companyId,source,serialPartId,actorId]);
 serialDamage=(await send({action:"release",taskId:serialDamage.id,expectedVersion:serialDamage.version,holder:"Inspected shelf",serialNumbers:["TARGET-SERIAL-1"],targetPositionId:ids.sourceStorage},admin)).task;
 const unit=(await query("select current_position_id,status from inventory_serialized_units where company_id=$1 and serial_number='TARGET-SERIAL-1'",[companyId])).rows[0];
 assert.equal(serialDamage.status,"released");assert.equal(unit.current_position_id,ids.sourceStorage);assert.equal(unit.status,"in_stock");
});

test("transfer full cycle records held arrivals, short loss, extras and physical source return without double stock",{skip:!run},async()=>{
 const companyId=randomUUID(),source=randomUUID(),destination=randomUUID(),actorId=randomUUID(),partId=randomUUID();
 const sourceBin=randomUUID(),destinationBin=randomUUID(),hold=randomUUID();
 const context={actor:{id:actorId,role:"office"},companyIds:new Set([companyId]),locationIds:new Set([source,destination])};
 const admin={...context,actor:{id:actorId,role:"admin"}};
 await query("insert into companies(id,slug,name) values($1,$2,'Full transfer')",[companyId,`transfer-${companyId}`]);
 await query("insert into locations(id,company_id,name) values($1,$3,'Source'),($2,$3,'Destination')",[source,destination,companyId]);
 await query("insert into user_profiles(id,display_name) values($1,'Transfer receiver')",[actorId]);
 await query("insert into parts_catalog(id,company_id,part_number,normalized_part_number,description,uom_code,tracking_mode) values($1,$2,'CYCLE','CYCLE','Cycle part','ea','quantity')",[partId,companyId]);
 for(const [id,location,code,pickable] of [[sourceBin,source,'SOURCE',true],[destinationBin,destination,'DEST',true],[hold,destination,'HOLD',false]])await query("insert into inventory_positions(id,company_id,location_id,code,name,kind,usage,can_store,is_pickable,created_by) values($1,$2,$3,$4,$4,'bin','storage',true,$5,$6)",[id,companyId,location,code,pickable,actorId]);
 await receiveDirectInventory({locationId:source,catalogPartId:partId,expectedPartVersion:1,trackingMode:'quantity',uomCode:'ea',quantity:10,idempotencyKey:randomUUID(),confirmation:'new_company_stock_received',noPurchaseOrderReason:'Starting fixture',targetPositionId:sourceBin},context);
 const send=(body,ctx=context)=>postStockTask({locationId:source,reason:'Physical transfer evidence',idempotencyKey:randomUUID(),holder:'Driver',...body},ctx);
 const snapshot=await getStockTaskSnapshot(new URLSearchParams({locationId:source,catalogPartId:partId}),context);
 await assert.rejects(send({action:'transfer',catalogPartId:partId,quantity:6,expectedBalanceRevision:snapshot.revision,destinationId:destination}),error=>error.code==='INVENTORY_TASK_POSITION_REQUIRED');
 let task=(await send({action:'transfer',catalogPartId:partId,quantity:6,expectedBalanceRevision:snapshot.revision,destinationId:destination,sourceAllocations:[{positionId:sourceBin,quantity:6}],blindReceiving:true})).task;
 assert.equal(task.source_provenance.status,'unallocated_receipt_candidates');
 const act=async(action,extra={},ctx=context)=>{task=(await send({action,locationId:destination,taskId:task.id,expectedVersion:task.version,...extra},ctx)).task;return task;};
 await assert.rejects(act('report_transfer_discrepancy',{locationId:source,quantity:1,discrepancyType:'short'}),error=>error.code==='INVENTORY_TASK_CONFLICT');
 await assert.rejects(act('receive_transfer',{quantity:1,targetPositionId:destinationBin,disposition:'damaged'}),error=>error.code==='INVENTORY_TASK_POSITION_REQUIRED');
 await act('receive_transfer',{quantity:2,targetPositionId:destinationBin});
 assert.equal(task.blind_details_hidden,true);assert.deepEqual(task.source_allocations,[]);assert.ok(task.events.every(event=>Object.keys(event.details).length===0));
 await act('receive_transfer',{quantity:1,targetPositionId:hold,disposition:'damaged'});
 const damage=(await query("select * from inventory_stock_tasks where company_id=$1 and parent_transfer_id=$2",[companyId,task.id])).rows[0];
 assert.equal(damage.status,'inspection');assert.equal(damage.hold_position_id,hold);
 await act('report_transfer_discrepancy',{quantity:1,discrepancyType:'short'});
 const shortage=task.exceptions.find(item=>item.kind==='short');
 await assert.rejects(act('resolve_transfer_discrepancy',{discrepancyId:shortage.id,resolutionType:'lost_in_transit',resolutionReference:'Carrier investigation',quantity:1}),error=>error.code==='INVENTORY_TASK_CONFLICT');
 await act('resolve_transfer_discrepancy',{discrepancyId:shortage.id,resolutionType:'lost_in_transit',resolutionReference:'Carrier investigation',quantity:1},admin);
 assert.equal(Number(task.lost_quantity),1);
 await act('report_transfer_discrepancy',{quantity:1,discrepancyType:'extra',targetPositionId:hold});
 const extra=task.exceptions.find(item=>item.kind==='extra');
 await act('resolve_transfer_discrepancy',{discrepancyId:extra.id,resolutionType:'extra_returned',resolutionReference:'Returned unknown extra to carrier'},admin);
 await act('request_transfer_return',{locationId:source});
 assert.equal(task.transfer_state,'returning');
 const before=(await query('select quantity_on_hand from inventory_items where company_id=$1 and location_id=$2 and catalog_part_id=$3',[companyId,source,partId])).rows[0];assert.equal(Number(before.quantity_on_hand),4);
 const command={action:'receive_transfer_return',locationId:source,taskId:task.id,expectedVersion:task.version,quantity:2,targetPositionId:sourceBin,idempotencyKey:randomUUID()};
 const race=await Promise.allSettled([send(command),send({...command,idempotencyKey:randomUUID()})]);
 assert.equal(race.filter(result=>result.status==='fulfilled').length,1);assert.equal(race.filter(result=>result.status==='rejected').length,1);
 task=race.find(result=>result.status==='fulfilled').value.task;
 if(race[0].status==='fulfilled'){const replay=await send(command);assert.equal(replay.replayed,true);}
 assert.equal(task.transfer_state,'completed');assert.equal(Number(task.returned_quantity),2);assert.equal(Number(task.completed_quantity),6);
 const balances=(await query('select location_id,quantity_on_hand from inventory_items where company_id=$1 and catalog_part_id=$2',[companyId,partId])).rows;
 assert.equal(Number(balances.find(row=>row.location_id===source).quantity_on_hand),6);assert.equal(Number(balances.find(row=>row.location_id===destination).quantity_on_hand),2);
 const movements=(await query('select sum(quantity_delta) delta from inventory_stock_movements where company_id=$1 and stock_task_id=$2',[companyId,task.id])).rows[0];assert.equal(Number(movements.delta),-2);
 const sourceReport=await getInventoryReports(new URLSearchParams({locationId:source}),context);
 const destinationReport=await getInventoryReports(new URLSearchParams({locationId:destination}),context);
 for(const report of [sourceReport,destinationReport]){
  const transfer=report.transfers.find(row=>row.id===task.id);assert.ok(transfer);
  assert.equal(transfer.outcome,'completed_with_loss');assert.equal(Number(transfer.received_quantity),2);
  assert.equal(Number(transfer.damaged_quantity),1);assert.equal(Number(transfer.lost_quantity),1);
  assert.equal(Number(transfer.returned_quantity),2);assert.equal(Number(transfer.in_transit_quantity),0);assert.equal(transfer.open_discrepancies,0);
 }
});

for(const trackingMode of ['quantity','serialized'])test(`shortage recovery and partial loss conserve ${trackingMode} stock and blind identities`,{skip:!run},async()=>{
 const companyId=randomUUID(),source=randomUUID(),destination=randomUUID(),actorId=randomUUID(),partId=randomUUID(),sourceBin=randomUUID(),destinationBin=randomUUID();
 const context={actor:{id:actorId,role:'admin'},companyIds:new Set([companyId]),locationIds:new Set([source,destination])};
 const serials=Array.from({length:7},(_,i)=>`SHORT-${randomUUID()}-${i}`);
 await query("insert into companies(id,slug,name) values($1,$2,'Shortage recovery')",[companyId,`short-${companyId}`]);
 await query("insert into locations(id,company_id,name) values($1,$3,'Source'),($2,$3,'Destination')",[source,destination,companyId]);
 await query("insert into user_profiles(id,display_name) values($1,'Shortage reviewer')",[actorId]);
 await query("insert into parts_catalog(id,company_id,part_number,normalized_part_number,description,uom_code,tracking_mode) values($1,$2,'SHORT','SHORT','Shortage part','ea',$3)",[partId,companyId,trackingMode]);
 for(const [id,location,code] of [[sourceBin,source,'SOURCE'],[destinationBin,destination,'DEST']])await query("insert into inventory_positions(id,company_id,location_id,code,name,kind,usage,can_store,is_pickable,created_by) values($1,$2,$3,$4,$4,'bin','storage',true,true,$5)",[id,companyId,location,code,actorId]);
 await receiveDirectInventory({locationId:source,catalogPartId:partId,expectedPartVersion:1,trackingMode,uomCode:'ea',quantity:7,serialNumbers:trackingMode==='serialized'?serials:undefined,idempotencyKey:randomUUID(),confirmation:'new_company_stock_received',noPurchaseOrderReason:'Starting fixture',targetPositionId:sourceBin},context);
 const send=body=>postStockTask({locationId:source,reason:'Shortage physical evidence',idempotencyKey:randomUUID(),holder:'Carrier',...body},context);
 const dispatch=async(quantity,numbers)=>{const snapshot=await getStockTaskSnapshot(new URLSearchParams({locationId:source,catalogPartId:partId}),context);return (await send({action:'transfer',catalogPartId:partId,quantity,expectedBalanceRevision:snapshot.revision,destinationId:destination,blindReceiving:true,...(trackingMode==='serialized'?{serialNumbers:numbers}:{sourceAllocations:[{positionId:sourceBin,quantity}]})})).task;};
 let task=await dispatch(5,serials.slice(0,5));
 const read=async()=> (await getStockTask(task.id,new URLSearchParams({locationId:destination,kind:'transfer'}),context)).task;
 const act=async(action,extra={})=>{task=(await send({action,taskId:task.id,expectedVersion:task.version,locationId:destination,...extra})).task;return task;};
 assert.deepEqual((await read()).units,[]);
  await act('report_transfer_discrepancy',{quantity:3,discrepancyType:'short'});const discrepancyId=task.exceptions[0].id;
  await act('receive_transfer',{quantity:2,targetPositionId:destinationBin,serialNumbers:trackingMode==='serialized'?serials.slice(0,2):[]});
  let discrepancy=task.exceptions[0];assert.equal(Number(discrepancy.quantity),3);assert.equal(discrepancy.recovered_quantity,0);assert.equal(discrepancy.remaining_quantity,3);
  await act('receive_transfer',{quantity:1,targetPositionId:destinationBin,serialNumbers:trackingMode==='serialized'?[serials[2]]:[]});
  discrepancy=task.exceptions[0];assert.equal(discrepancy.recovered_quantity,1);assert.equal(discrepancy.remaining_quantity,2);
 const stockBefore=(await query('select location_id,quantity_on_hand from inventory_items where company_id=$1 order by location_id',[companyId])).rows;
  await assert.rejects(act('resolve_transfer_discrepancy',{discrepancyId,resolutionType:'lost_in_transit',resolutionReference:'Carrier confirmed',quantity:3,serialNumbers:trackingMode==='serialized'?serials.slice(2,5):[]}),error=>error.code==='INVENTORY_TASK_CONFLICT');
 if(trackingMode==='serialized')await assert.rejects(act('resolve_transfer_discrepancy',{discrepancyId,resolutionType:'lost_in_transit',resolutionReference:'Carrier confirmed',quantity:1,serialNumbers:[serials[0]]}),error=>error.code==='INVENTORY_TASK_CONFLICT');
  const partial={action:'resolve_transfer_discrepancy',locationId:destination,taskId:task.id,expectedVersion:task.version,discrepancyId,resolutionType:'lost_in_transit',resolutionReference:'First confirmed loss',quantity:1,serialNumbers:trackingMode==='serialized'?[serials[3]]:[],idempotencyKey:randomUUID()};
 task=(await send(partial)).task;const replay=await send(partial);assert.equal(replay.replayed,true);
 assert.equal(task.exceptions[0].status,'open');assert.equal(task.exceptions[0].remaining_quantity,1);assert.equal(task.exceptions[0].resolved_lost_quantity,1);
  await act('resolve_transfer_discrepancy',{discrepancyId,resolutionType:'lost_in_transit',resolutionReference:'Remaining confirmed loss',quantity:1,serialNumbers:trackingMode==='serialized'?[serials[4]]:[]});
  discrepancy=task.exceptions[0];assert.equal(discrepancy.status,'resolved');assert.equal(discrepancy.remaining_quantity,0);assert.equal(discrepancy.recovered_quantity,1);assert.equal(discrepancy.resolved_lost_quantity,2);
  assert.equal(Number(task.lost_quantity),2);assert.equal(Number(task.completed_quantity),5);
 await assert.rejects(act('resolve_transfer_discrepancy',{discrepancyId,resolutionType:'lost_in_transit',resolutionReference:'Duplicate loss',quantity:1,serialNumbers:[]}),error=>error.code==='INVENTORY_TASK_CONFLICT');
 assert.deepEqual((await query('select location_id,quantity_on_hand from inventory_items where company_id=$1 order by location_id',[companyId])).rows,stockBefore,'loss never writes usable stock');
  let blind=await read();assert.deepEqual(blind.units.map(unit=>unit.serial_number).sort(),trackingMode==='serialized'?serials.slice(0,3).sort():[]);
  for(const serial of serials.slice(3,5))assert.equal(JSON.stringify(blind).includes(serial),false,'loss identity stays hidden');
 task=await dispatch(2,serials.slice(5));
 await act('report_transfer_discrepancy',{quantity:2,discrepancyType:'short'});const returnShortage=task.exceptions[0].id;
 await act('request_transfer_return',{locationId:source});
 await act('receive_transfer_return',{locationId:source,quantity:1,targetPositionId:sourceBin,serialNumbers:trackingMode==='serialized'?[serials[5]]:[]});
 blind=await read();assert.deepEqual(blind.units,[]);assert.equal(blind.exceptions[0].remaining_quantity,1);
 await act('resolve_transfer_discrepancy',{discrepancyId:returnShortage,resolutionType:'lost_in_transit',resolutionReference:'One recovered, one lost',quantity:1,serialNumbers:trackingMode==='serialized'?[serials[6]]:[]});
 blind=await read();assert.deepEqual(blind.units,[]);assert.equal(blind.exceptions[0].status,'resolved');
 for(const serial of serials.slice(5))assert.equal(JSON.stringify(blind).includes(serial),false,'source-returned and lost identities stay hidden');
 const balances=(await query('select location_id,quantity_on_hand from inventory_items where company_id=$1',[companyId])).rows;
  assert.equal(Number(balances.find(row=>row.location_id===source).quantity_on_hand),1);assert.equal(Number(balances.find(row=>row.location_id===destination).quantity_on_hand),3);
});
