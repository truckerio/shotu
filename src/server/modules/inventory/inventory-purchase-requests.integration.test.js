import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { query,closePool } from '../../db/pool.js';
import { getPurchaseRequests,postPurchaseRequest } from './inventory-purchase-requests.service.js';
import { receiveDirectInventory,readDirectReceiptOutcome } from './direct-inventory-receipt.service.js';

const enabled=process.env.RUN_DIRECT_RECEIPT_INTEGRATION==='1';
after(async()=>{if(enabled)await closePool();});

test('Purchase receiving is atomic, quantity checked and duplicate safe', {skip:!enabled},async()=>{
  const {send,office,companyId,locationId}=await fixture();
  const partId=randomUUID();
  await query("insert into parts_catalog(id,company_id,part_number,normalized_part_number,description,uom_code,tracking_mode) values($1,$2,'PUMP','PUMP','Fuel pump','pc','quantity')",[partId,companyId]);
  let request=(await send({action:'request_create',catalogPartId:partId,description:'Fuel pump',quantity:2,uomCode:'pc'})).request;
  request=(await send({action:'request_approve',requestId:request.id,expectedVersion:request.version})).request;
  const payload={locationId,catalogPartId:partId,purchaseRequestId:request.id,expectedRequestVersion:request.version,expectedPartVersion:1,trackingMode:'quantity',uomCode:'pc',quantity:2,idempotencyKey:randomUUID(),confirmation:'new_company_stock_received'};
  await assert.rejects(receiveDirectInventory({...payload,quantity:1},office),{code:'INVENTORY_REQUEST_RECEIPT_CONFLICT'});
  assert.equal((await query('select status from inventory_purchase_requests where id=$1',[request.id])).rows[0].status,'approved');
  const concurrent=await Promise.all([receiveDirectInventory(payload,office),receiveDirectInventory(payload,office)]);
  assert.equal(concurrent[0].receipt.id,concurrent[1].receipt.id);
  assert.equal(Number((await query('select quantity_on_hand from inventory_items where catalog_part_id=$1',[partId])).rows[0].quantity_on_hand),2);
  const saved=(await query('select * from inventory_purchase_requests where id=$1',[request.id])).rows[0];
  assert.equal(saved.status,'added');assert.equal(saved.receipt_id,concurrent[0].receipt.id);
  await assert.rejects(receiveDirectInventory({...payload,idempotencyKey:randomUUID(),expectedRequestVersion:saved.version},office),{code:'INVENTORY_REQUEST_RECEIPT_CONFLICT'});
  await assert.rejects(postPurchaseRequest({action:'request_add',locationId,requestId:request.id,expectedVersion:saved.version,idempotencyKey:randomUUID()},office),/Receive/);
  assert.equal(Number((await query('select quantity_on_hand from inventory_items where catalog_part_id=$1',[partId])).rows[0].quantity_on_hand),2);
});

test('Work order purchase requests retain their link and current status after approval and adding', {skip:!enabled},async()=>{
  const {send,office,companyId,locationId}=await fixture();
  const workorderId=randomUUID(),otherId=randomUUID();
  await query('insert into operational_workorders(id,company_id,location_id,serial) values($1,$2,$3,$4),($5,$2,$3,$6)',[workorderId,companyId,locationId,workorderId,otherId,otherId]);
  const read=()=>getPurchaseRequests(new URLSearchParams({locationId,workorderId}),office);
  let request=(await send({action:'request_create',workorderId,description:'Filter',quantity:2})).request;
  await send({action:'request_create',workorderId:otherId,description:'Other part',quantity:1});
  assert.equal(request.workorder_id,workorderId);
  assert.equal((await read()).items.length,1);
  assert.equal((await read()).items[0].status,'approval_waiting');
  request=(await send({action:'request_approve',requestId:request.id,expectedVersion:request.version})).request;
  assert.equal((await read()).items[0].status,'approved');
  request=(await send({action:'request_update',requestId:request.id,expectedVersion:request.version,quantity:3})).request;
  assert.equal(Number((await read()).items[0].quantity),3);
  await send({action:'request_add',requestId:request.id,expectedVersion:request.version});
  assert.equal((await read()).items[0].status,'added');
  await assert.rejects(send({action:'request_create',workorderId:randomUUID(),description:'Invalid',quantity:1}),{statusCode:404});
  await query("update operational_workorders set status='closed' where id=$1",[workorderId]);
  await assert.rejects(send({action:'request_create',workorderId,description:'Too late',quantity:1}),/completed/);
});
async function fixture() {
  const companyId=randomUUID(),locationId=randomUUID(),actorId=randomUUID(),adminId=randomUUID();
  await query("insert into companies(id,slug,name) values($1,$2,'Purchase request test')",[companyId,companyId]);
  await query("insert into locations(id,company_id,name) values($1,$2,'Request shop')",[locationId,companyId]);
  await query("insert into user_profiles(id,display_name) values($1,'Office approver'),($2,'Admin approver')",[actorId,adminId]);
  const office={actor:{id:actorId,role:'office'},companyIds:new Set([companyId]),locationIds:new Set([locationId])};
  const admin={...office,actor:{id:adminId,role:'admin'}};
  const fixtureParts=new Map();
  const send=async(body,context=office)=>{
    if(body.action!=='request_add')return postPurchaseRequest({locationId,idempotencyKey:randomUUID(),...body},context);
    const request=(await query('select * from inventory_purchase_requests where id=$1',[body.requestId])).rows[0];
    let partId=request.catalog_part_id||fixtureParts.get(request.id);
    if(!partId){
      partId=randomUUID();fixtureParts.set(request.id,partId);
      await query(`insert into parts_catalog(id,company_id,part_number,normalized_part_number,description,uom_code,tracking_mode) values($1,$2,$3,$3,'Purchased part',$4,'quantity')`,[partId,companyId,partId.replaceAll('-',''),request.uom_code]);
    }
    const part=(await query('select * from parts_catalog where id=$1',[partId])).rows[0];
    const result=await receiveDirectInventory({locationId,catalogPartId:partId,purchaseRequestId:request.id,expectedRequestVersion:body.expectedVersion,expectedPartVersion:Number(part.version),trackingMode:part.tracking_mode,uomCode:part.uom_code,quantity:Number(request.quantity),idempotencyKey:body.idempotencyKey||randomUUID(),confirmation:'new_company_stock_received'},context);
    return {...result,request:(await query('select * from inventory_purchase_requests where id=$1',[request.id])).rows[0]};
  };
  const read=(status='needs_ordering',page=1,context=office)=>getPurchaseRequests(new URLSearchParams({locationId,status,page:String(page)}),context);
  return {companyId,locationId,actorId,adminId,office,admin,send,read};
}

test('Purchase requests require explicit approval, preserve actor evidence, and post stock exactly once', {skip:!enabled},async()=>{
  const {send,read,office,admin,actorId,adminId,locationId,companyId}=await fixture();
  const body={action:'request_create',description:'Element filter',partNumber:'FILTER',quantity:2,uomCode:'ea'};
  const key=randomUUID();
  const [first,replay]=await Promise.all([send({...body,idempotencyKey:key}),send({...body,idempotencyKey:key})]);
  assert.equal(first.request.id,replay.request.id);
  let item=first.request;
  assert.equal(item.status,'approval_waiting');
  assert.equal(item.approved_by,null);
  assert.equal((await read('approval_waiting')).items.length,1);
  assert.equal((await read('approved')).items.length,0);
  await assert.rejects(send({...body,status:'approved'}));
  await assert.rejects(send(body,{...office,actor:{id:actorId,role:'mechanic'}}),{statusCode:403});
  await assert.rejects(read('needs_ordering',1,{...office,companyIds:new Set([randomUUID()])}),{statusCode:404});
  await assert.rejects(send({action:'request_add',requestId:item.id,expectedVersion:item.version}),/approved/);
  await assert.rejects(send({action:'request_update',requestId:item.id,expectedVersion:item.version,quantity:3}),/Approve/);
  const approved=await send({action:'request_approve',requestId:item.id,expectedVersion:item.version});
  item=approved.request;
  assert.equal(item.status,'approved');
  assert.equal(item.approved_by,actorId);
  assert.ok(item.approved_at);
  assert.equal((await read('approved')).items[0].approved_by_name,'Office approver');
  await assert.rejects(send({action:'request_add',requestId:item.id,expectedVersion:1}),/changed/);
  await assert.rejects(send({action:'request_approve',requestId:item.id,expectedVersion:item.version}),/waiting/);
  const updates=await Promise.allSettled([
    send({action:'request_update',requestId:item.id,expectedVersion:item.version,quantity:3,supplier:'Supplier A'}),
    send({action:'request_update',requestId:item.id,expectedVersion:item.version,quantity:4,supplier:'Supplier B'}),
  ]);
  assert.equal(updates.filter(result=>result.status==='fulfilled').length,1);
  item=updates.find(result=>result.status==='fulfilled').value.request;
  const addKey=randomUUID();
  item=(await send({action:'request_add',requestId:item.id,expectedVersion:item.version,idempotencyKey:addKey},admin)).request;
  assert.equal(item.status,'added');
  assert.equal(item.added_by,adminId);
  assert.equal(item.approved_by,actorId);
  assert.equal((await read()).items.length,0);
  assert.equal((await read('added')).items[0].added_by_name,'Admin approver');
  await assert.rejects(send({action:'request_update',requestId:item.id,expectedVersion:item.version,quantity:2}),/Approve/);
  const recovery=await readDirectReceiptOutcome(addKey,admin);
  assert.equal(recovery.receipt.id,item.receipt_id);
  const events=await query('select action,actor_id from inventory_purchase_request_events where request_id=$1 order by created_at',[item.id]);
  assert.deepEqual(events.rows.map(row=>row.action),['request_create','request_approve','request_update','request_add']);
  assert.equal(events.rows[1].actor_id,actorId);
  const stock=await query('select count(*)::int as count from inventory_stock_movements where company_id=$1',[companyId]);
  assert.equal(stock.rows[0].count,1);
  const adminRequest=(await send(body,admin)).request;
  assert.equal(adminRequest.status,'approval_waiting');
  assert.equal((await send({action:'request_approve',requestId:adminRequest.id,expectedVersion:1},admin)).request.approved_by,adminId);
});

test('Suggestions share the request queue, require approval and deduplicate pending supply', {skip:!enabled},async()=>{
  const {send,read,companyId,locationId}=await fixture();
  const partId=randomUUID();
  await query("insert into parts_catalog(id,company_id,part_number,normalized_part_number,description,uom_code,tracking_mode) values($1,$2,'FILTER','FILTER','Element filter','ea','quantity')",[partId,companyId]);
  await query('insert into inventory_stocking_policies(company_id,location_id,catalog_part_id,minimum_available,target_quantity) values($1,$2,$3,1,5)',[companyId,locationId,partId]);
  const suggestion=(await read()).items[0];
  assert.equal(suggestion.status,'suggestion');
  assert.equal(suggestion.category,'suggestion');
  assert.equal(Number(suggestion.quantity),5);
  const body={action:'request_create',category:'suggestion',catalogPartId:partId,description:'Element filter',quantity:5,uomCode:'ea'};
  let item=(await send(body)).request;
  assert.equal(item.status,'approval_waiting');
  assert.equal((await read()).items.length,1);
  await assert.rejects(send(body),/already has a request/);
  item=(await send({action:'request_approve',requestId:item.id,expectedVersion:item.version})).request;
  await send({action:'request_add',requestId:item.id,expectedVersion:item.version});
  assert.equal((await read()).items.length,0);
  assert.equal((await read('added')).items[0].category,'suggestion');
  await query("update inventory_stocking_policies set minimum_available=10,target_quantity=15,updated_at=now()+interval '1 second' where catalog_part_id=$1",[partId]);
  assert.equal((await read()).items[0].status,'suggestion');
});

test('Request status filtering happens before pagination and excludes work order requests', {skip:!enabled},async()=>{
  const {send,read,companyId,locationId}=await fixture();
  const woId=randomUUID();
  await query('insert into operational_workorders(id,company_id,location_id,serial) values($1,$2,$3,$4)',[woId,companyId,locationId,woId]);
  await query("insert into workorder_part_requests(workorder_id,raw_query,quantity) values($1,'Separate work order request',1)",[woId]);
  assert.equal((await read()).items.length,0);
  const ids=[];
  for(let index=0;index<27;index++) ids.push((await send({action:'request_create',description:`Part ${index}`,quantity:1})).request.id);
  await send({action:'request_approve',requestId:ids[0],expectedVersion:1});
  assert.equal((await read('approval_waiting')).items.length,25);
  assert.equal((await read('approval_waiting')).hasMore,true);
  assert.equal((await read('approval_waiting',2)).items.length,1);
  assert.equal((await read('approved')).items[0].id,ids[0]);
});
