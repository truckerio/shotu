import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after,test } from 'node:test';
import { closePool,query } from '../../db/pool.js';
import { getPurchasing,savePurchase } from './inventory-purchasing.service.js';

const enabled=process.env.RUN_PURCHASE_ORDER_LINE_EDIT_INTEGRATION==='1';
after(async()=>{if(enabled)await closePool();});

test('purchase line amendments preserve stable rows, history, scope and physical inventory',{skip:!enabled},async()=>{
  const suffix=randomUUID().replaceAll('-','');
  const companyId=randomUUID(),foreignCompanyId=randomUUID(),locationId=randomUUID(),otherLocationId=randomUUID(),actorId=randomUUID(),supplierId=randomUUID();
  const partA=randomUUID(),partB=randomUUID(),noStockPart=randomUUID(),foreignPart=randomUUID();
  const context={actor:{id:actorId,role:'office'},companyIds:new Set([companyId]),companyRoles:new Map([[companyId,'office']]),locationIds:new Set([locationId])};
  const send=(body)=>savePurchase({locationId,idempotencyKey:randomUUID(),...body},context);
  await query("insert into user_profiles(id,display_name) values($1,'PO line editor')",[actorId]);
  await query('insert into companies(id,slug,name) values($1,$2,$3)',[companyId,`po-line-${suffix}`,'PO line edit']);
  await query('insert into companies(id,slug,name) values($1,$2,$3)',[foreignCompanyId,`po-line-foreign-${suffix}`,'Foreign PO line edit']);
  await query("insert into locations(id,company_id,name) values($1,$3,'Shop'),($2,$3,'Other shop')",[locationId,otherLocationId,companyId]);
  await query("insert into user_company_memberships(user_id,company_id,role) values($1,$2,'office')",[actorId,companyId]);
  await query("insert into inventory_suppliers(id,company_id,name) values($1,$2,'Line supplier')",[supplierId,companyId]);
  await query(`insert into parts_catalog(id,company_id,normalized_part_number,part_number,description,uom_code,tracking_mode) values
    ($1,$4,$5,$6,'Filter A','ea','quantity'),($2,$4,$7,$8,'Filter B','ea','serialized'),($3,$4,$9,$10,'Shop labor','ea','no_stock')`,
    [partA,partB,noStockPart,companyId,`A${suffix}`,`A-${suffix}`,`B${suffix}`,`B-${suffix}`,`N${suffix}`,`N-${suffix}`]);
  await query(`insert into parts_catalog(id,company_id,normalized_part_number,part_number,description,uom_code,tracking_mode)
    values($1,$2,$3,$4,'Foreign filter','ea','quantity')`,[foreignPart,foreignCompanyId,`F${suffix}`,`F-${suffix}`]);
  await query(`insert into inventory_purchase_approval_settings(company_id,approval_limit,currency,approver_user_ids,approver_roles,updated_by)
    values($1,100,'USD',$2,array[]::text[],$3)`,[companyId,[actorId],actorId]);

  const created=(await send({action:'create',supplierId,currency:'USD',notes:'',expectedDeliveryDate:null,placeOrder:true,lines:[
    {catalogPartId:partA,quantity:1,unitPrice:'10',demandSources:[]},
    {partNumber:`FREE-${suffix}`,description:'Freeform row',uomCode:'ea',trackingMode:'quantity',quantity:2,unitPrice:'5',demandSources:[]},
  ]})).order;
  assert.equal(created.status,'ordered');
  assert.equal(created.can_edit_lines,true);
  const originalPlacement={at:created.placed_at,by:created.placed_by};
  const catalogLine=created.lines.find(line=>line.catalog_part_id),freeLine=created.lines.find(line=>!line.catalog_part_id);
  const stockBefore=(await query(`select
    (select count(*)::integer from local_inventory_receipts where company_id=$1) receipts,
    (select count(*)::integer from inventory_stock_movements where company_id=$1) movements,
    (select count(*)::integer from inventory_items where company_id=$1) items`,[companyId])).rows[0];
  const key=randomUUID();
  const amendment={action:'amend_lines',locationId,idempotencyKey:key,orderId:created.id,expectedVersion:created.version,lines:[
    {id:catalogLine.id,catalogPartId:partB,partNumber:'ignored-client-copy',description:'Filter B vendor snapshot',uomCode:'ea',trackingMode:'quantity',quantity:2,unitPrice:'20'},
    {id:freeLine.id,partNumber:`FREE-EDIT-${suffix}`,description:'Edited freeform row',uomCode:'ea',trackingMode:'quantity',quantity:3,unitPrice:'5'},
    {catalogPartId:partA,partNumber:'ignored-new-copy',description:'Added Filter A snapshot',uomCode:'ea',trackingMode:'quantity',quantity:1,unitPrice:'3'},
  ]};
  const amended=(await savePurchase(amendment,context)).order;
  assert.ok(created.lines.every(line=>amended.lines.some(saved=>saved.id===line.id)));
  assert.equal(amended.lines.length,created.lines.length+1);
  const addedLine=amended.lines.find(line=>line.catalog_part_id===partA);
  assert.ok(addedLine?.id);
  const amendedCatalog=amended.lines.find(line=>line.id===catalogLine.id);
  assert.deepEqual({catalogPartId:amendedCatalog.catalog_part_id,partNumber:amendedCatalog.part_number,description:amendedCatalog.description,
    trackingMode:amendedCatalog.tracking_mode,quantity:amendedCatalog.quantity,unitPrice:amendedCatalog.unit_price},
  {catalogPartId:partB,partNumber:`B-${suffix}`,description:'Filter B vendor snapshot',trackingMode:'serialized',quantity:'2.000',unitPrice:'20.0000'});
  assert.deepEqual({at:amended.placed_at,by:amended.placed_by},originalPlacement);
  const replay=await savePurchase(amendment,context);
  assert.equal(replay.replayed,true);
  assert.equal(replay.order.lines.find(line=>line.catalog_part_id===partA).id,addedLine.id);
  await assert.rejects(savePurchase({...amendment,lines:amendment.lines.map((line,index)=>index?line:{...line,unitPrice:'21'})},context),{code:'INVENTORY_PURCHASE_CONFLICT'});
  const concurrent=await Promise.allSettled(['22','23'].map(unitPrice=>savePurchase({action:'amend_lines',locationId,orderId:amended.id,idempotencyKey:randomUUID(),expectedVersion:amended.version,
    lines:amended.lines.map((line,index)=>index?lineToInput(line):{...lineToInput(line),unitPrice})},context)));
  assert.deepEqual(concurrent.map(result=>result.status).sort(),['fulfilled','rejected']);
  const current=(await getPurchasing(new URLSearchParams({locationId,orderId:created.id}),context)).items[0];
  const high=(await send({action:'amend_lines',orderId:current.id,expectedVersion:current.version,lines:[...current.lines.map(line=>lineToInput(line)),
    {partNumber:`HIGH-ADD-${suffix}`,description:'Approval-triggering addition',uomCode:'ea',trackingMode:'quantity',quantity:1,unitPrice:'200'},
  ]})).order;
  assert.equal(high.status,'awaiting_approval');
  assert.deepEqual({at:high.placed_at,by:high.placed_by},originalPlacement);
  const approved=(await send({action:'approve',orderId:high.id,expectedVersion:high.version})).order;
  assert.deepEqual({at:approved.placed_at,by:approved.placed_by},originalPlacement);
  const unknown=(await send({action:'amend_lines',orderId:approved.id,expectedVersion:approved.version,lines:approved.lines.map((line,index)=>({
    id:line.id,...(line.catalog_part_id?{catalogPartId:line.catalog_part_id}:{}),partNumber:line.part_number,description:line.description,uomCode:line.uom_code,trackingMode:line.tracking_mode,quantity:Number(line.quantity),unitPrice:index?'5':null,
  }))})).order;
  assert.equal(unknown.status,'awaiting_approval');
  const event=(await query("select details from inventory_purchase_events where order_id=$1 and action='amend_lines' order by created_at limit 1",[created.id])).rows[0];
  assert.ok(event.details.before.lines.every(line=>event.details.after.lines.some(saved=>saved.id===line.id)));
  assert.equal(event.details.after.lines.length,event.details.before.lines.length+1);
  assert.ok(event.details.after.lines.some(line=>line.id===addedLine.id));
  assert.equal(event.details.before.version,created.version);
  assert.equal(event.details.after.version,created.version+1);
  const stockAfter=(await query(`select
    (select count(*)::integer from local_inventory_receipts where company_id=$1) receipts,
    (select count(*)::integer from inventory_stock_movements where company_id=$1) movements,
    (select count(*)::integer from inventory_items where company_id=$1) items`,[companyId])).rows[0];
  assert.deepEqual(stockAfter,stockBefore);

  await assert.rejects(savePurchase({...amendment,idempotencyKey:randomUUID(),expectedVersion:created.version},context),{code:'INVENTORY_PURCHASE_CONFLICT'});
  await assert.rejects(savePurchase({...amendment,locationId:otherLocationId,idempotencyKey:randomUUID(),expectedVersion:unknown.version},context),{code:'inventory_not_found'});
  const currentUnknown=unknown.lines;
  const beforeInvalid={version:unknown.version,count:unknown.lines.length};
  const duplicate=currentUnknown[0];
  await assert.rejects(send({action:'amend_lines',orderId:unknown.id,expectedVersion:unknown.version,lines:[...currentUnknown.map(line=>lineToInput(line)),
    {id:randomUUID(),partNumber:`UNKNOWN-${suffix}`,description:'Unknown existing id',uomCode:'ea',trackingMode:'quantity',quantity:1,unitPrice:'1'}]}),{code:'INVENTORY_PURCHASE_CONFLICT'});
  await assert.rejects(send({action:'amend_lines',orderId:unknown.id,expectedVersion:unknown.version,lines:[...currentUnknown.map(line=>lineToInput(line)),
    {partNumber:duplicate.part_number,description:'Duplicate',uomCode:duplicate.uom_code,trackingMode:duplicate.tracking_mode,quantity:1,unitPrice:'1'}]}),{code:'INVENTORY_PURCHASE_CONFLICT'});
  await assert.rejects(send({action:'amend_lines',orderId:unknown.id,expectedVersion:unknown.version,lines:[...currentUnknown.map(line=>lineToInput(line)),
    {catalogPartId:noStockPart,partNumber:'ignored',description:'No stock',uomCode:'ea',trackingMode:'quantity',quantity:1,unitPrice:'1'}]}),{code:'INVENTORY_PURCHASE_CONFLICT'});
  await assert.rejects(send({action:'amend_lines',orderId:unknown.id,expectedVersion:unknown.version,lines:[...currentUnknown.map(line=>lineToInput(line)),
    {partNumber:`SERIAL-${suffix}`,description:'Fractional serial',uomCode:'ea',trackingMode:'serialized',quantity:1.5,unitPrice:'1'}]}),{code:'INVENTORY_PURCHASE_CONFLICT'});
  await assert.rejects(send({action:'amend_lines',orderId:unknown.id,expectedVersion:unknown.version,lines:[...currentUnknown.map(line=>lineToInput(line)),
    {catalogPartId:foreignPart,partNumber:'ignored',description:'Foreign',uomCode:'ea',trackingMode:'quantity',quantity:1,unitPrice:'1'}]}),{code:'inventory_not_found'});
  const afterInvalid=(await getPurchasing(new URLSearchParams({locationId,orderId:unknown.id}),context)).items[0];
  assert.deepEqual({version:afterInvalid.version,count:afterInvalid.lines.length},beforeInvalid);

  const demandOrder=(await send({action:'create',supplierId,currency:'USD',notes:'',expectedDeliveryDate:null,placeOrder:false,lines:[{catalogPartId:partA,quantity:2,unitPrice:'5',demandSources:[]}]})).order;
  await query("insert into inventory_purchase_line_sources(company_id,purchase_line_id,source_type,source_id,planned_quantity) values($1,$2,'stocking_policy',$3,2)",[companyId,demandOrder.lines[0].id,partA]);
  const demandInput=lineToInput(demandOrder.lines[0]);
  const demandCost=(await send({action:'amend_lines',orderId:demandOrder.id,expectedVersion:demandOrder.version,lines:[{...demandInput,unitPrice:'6'}]})).order;
  assert.equal(demandCost.lines[0].id,demandOrder.lines[0].id);
  await assert.rejects(send({action:'amend_lines',orderId:demandCost.id,expectedVersion:demandCost.version,lines:[{...lineToInput(demandCost.lines[0]),quantity:3}]}),{code:'INVENTORY_PURCHASE_DEMAND_LINKED'});

  const protectedOrder=(await send({action:'create',supplierId,currency:'USD',notes:'',expectedDeliveryDate:null,placeOrder:true,lines:[{catalogPartId:partA,quantity:1,unitPrice:'5',demandSources:[]}]})).order;
  const deliveryId=randomUUID();
  await query(`insert into inventory_purchase_deliveries(id,company_id,order_id,location_id,received_by,idempotency_key,request_hash,status)
    values($1,$2,$3,$4,$5,$6,$7,'posted')`,[deliveryId,companyId,protectedOrder.id,locationId,actorId,`short-${suffix}`.slice(0,120),'0'.repeat(64)]);
  await query(`insert into inventory_purchase_delivery_lines(company_id,delivery_id,purchase_line_id,outcome,expected_quantity,actual_quantity,usable_quantity,held_quantity,rejected_quantity,uom_code)
    values($1,$2,$3,'shortage',1,0,0,0,0,'ea')`,[companyId,deliveryId,protectedOrder.lines[0].id]);
  const protectedRead=(await getPurchasing(new URLSearchParams({locationId,orderId:protectedOrder.id}),context)).items[0];
  assert.equal(protectedRead.can_edit_lines,false);
  assert.match(protectedRead.line_edit_reason,/delivery activity/i);
  await assert.rejects(send({action:'amend_lines',orderId:protectedOrder.id,expectedVersion:protectedOrder.version,lines:[{...lineToInput(protectedOrder.lines[0]),unitPrice:'6'}]}),{code:'INVENTORY_PURCHASE_LINES_PROTECTED'});
});

function lineToInput(line){return {id:line.id,...(line.catalog_part_id?{catalogPartId:line.catalog_part_id}:{}),partNumber:line.part_number,description:line.description,uomCode:line.uom_code,trackingMode:line.tracking_mode,quantity:Number(line.quantity),unitPrice:line.unit_price===null?null:String(line.unit_price)};}
