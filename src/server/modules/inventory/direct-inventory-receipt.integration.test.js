import { createInventoryQrToken,inventoryScanUrl } from './inventory-qr.js';
import { getBills,postBill } from './inventory-bills.service.js';
import { getStockTasks,getStockTaskSnapshot,postStockTask } from './inventory-stock-tasks.service.js';
import { getInventoryReports } from './inventory-reports.service.js';
import { savePurchase,getPurchasing,getPurchaseCommand,receivePurchaseOrder,savePurchaseApprovalSettings } from "./inventory-purchasing.service.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { closePool, query } from "../../db/pool.js";
import { listLocalInventoryStock } from "../../db/repositories/local-inventory.repo.js";
import { receiveDirectInventory, readDirectReceiptOutcome, readPartStockMovements } from "./direct-inventory-receipt.service.js";
import { getPurchaseRequests } from './inventory-purchase-requests.service.js';
import { listPurchaseBills } from './purchase-order-bills.service.js';

// Run only in a disposable migrated database: this test retains its audit evidence.
const enabled = process.env.RUN_DIRECT_RECEIPT_INTEGRATION === "1";
after(async () => { if (enabled) await closePool(); });

test('inventory workflows use the role in the target company', { skip: !enabled }, async () => {
  const adminCompanyId=randomUUID(),targetCompanyId=randomUUID(),locationId=randomUUID(),actorId=randomUUID(),partId=randomUUID(),supplierId=randomUUID(),orderId=randomUUID();
  await query("insert into companies(id,slug,name) values($1,$2,'Admin company'),($3,$4,'Target company')",[adminCompanyId,`admin-${adminCompanyId}`,targetCompanyId,`target-${targetCompanyId}`]);
  await query("insert into locations(id,company_id,name) values($1,$2,'Target shop')",[locationId,targetCompanyId]);
  await query("insert into user_profiles(id,display_name) values($1,'Mixed role actor')",[actorId]);
  await query("insert into parts_catalog(id,company_id,part_number,normalized_part_number,description,uom_code,tracking_mode) values($1,$2,'MIXED','MIXED','Mixed role part','ea','quantity')",[partId,targetCompanyId]);
  await query("insert into inventory_suppliers(id,company_id,name) values($1,$2,'Mixed supplier')",[supplierId,targetCompanyId]);
  await query("insert into inventory_purchase_orders(id,company_id,location_id,supplier_id,created_by,number,currency,status) values($1,$2,$3,$4,$5,'PO-MIXED','USD','received')",[orderId,targetCompanyId,locationId,supplierId,actorId]);
  const context={actor:{id:actorId,role:'admin'},companyIds:new Set([adminCompanyId,targetCompanyId]),locationIds:new Set([locationId]),companyRoles:new Map([[adminCompanyId,'admin'],[targetCompanyId,'mechanic']])};
  const params=new URLSearchParams({locationId});
  for(const operation of [
    ()=>getPurchasing(params,context),
    ()=>getPurchaseRequests(params,context),
    ()=>getBills(params,context),
    ()=>getInventoryReports(params,context),
    ()=>listPurchaseBills(orderId,context),
    ()=>receiveDirectInventory({locationId,catalogPartId:partId,expectedPartVersion:1,trackingMode:'quantity',uomCode:'ea',quantity:1,idempotencyKey:randomUUID(),confirmation:'new_company_stock_received',noPurchaseOrderReason:'Direct arrival without PO'},context),
  ]) await assert.rejects(operation,{statusCode:403});
  assert.equal((await query('select count(*)::int as count from local_inventory_receipts where company_id=$1',[targetCompanyId])).rows[0].count,0);
});

test("PostgreSQL direct receipt concurrency, exact identities, rollback, isolation and reconciliation", { skip: !enabled }, async () => {
  const companyId = randomUUID(), locationId = randomUUID(), actorId = randomUUID();
  const parts = { quantity: randomUUID(), serialized: randomUUID(), measured_bulk: randomUUID() };
  const context = { actor: { id: actorId, role: "office" }, companyIds: new Set([companyId]), locationIds: new Set([locationId]) };
  await query("insert into companies(id,slug,name) values($1,$2,'Direct receipt test')", [companyId, `direct-${companyId}`]);
  await query("insert into locations(id,company_id,name) values($1,$2,'Receiving shop')", [locationId, companyId]);
  await query("insert into user_profiles(id,display_name) values($1,'Receipt operator')", [actorId]);
  for (const [tracking, id] of Object.entries(parts)) {
    await query(`insert into parts_catalog(id,company_id,part_number,normalized_part_number,description,uom_code,tracking_mode)
      values($1,$2,$3,$3,'Receipt fixture',$4,$5)`, [id, companyId, id.replaceAll("-", "").toUpperCase(), tracking === "measured_bulk" ? "gal" : "ea", tracking]);
  }
  const targetPositionId = randomUUID();
  const receivingStagingPositionId = randomUUID();
  await query(`insert into inventory_positions(id,company_id,location_id,code,name,kind,usage,can_store,is_pickable,created_by)
    values($1,$2,$3,'RECEIPT-TARGET','Receipt target','bin','storage',true,true,$4)`, [targetPositionId, companyId, locationId, actorId]);
  await query(`insert into inventory_positions(id,company_id,location_id,code,name,kind,usage,can_store,is_pickable,created_by)
    values($1,$2,$3,'RECEIPT-STAGING','Receipt staging','bin','receiving',true,true,$4)`, [receivingStagingPositionId, companyId, locationId, actorId]);
  const payload = (tracking, changes = {}) => ({ locationId, catalogPartId: parts[tracking], expectedPartVersion: 1,
    trackingMode: tracking, uomCode: tracking === "measured_bulk" ? "gal" : "ea", quantity: 2,
    idempotencyKey: randomUUID(), confirmation: "new_company_stock_received", noPurchaseOrderReason: "Direct arrival without PO", ...changes });
  const command = payload("quantity");
  const concurrent = await Promise.all([receiveDirectInventory(command, context), receiveDirectInventory(command, context)]);
  assert.deepEqual(concurrent.map((value) => value.replayed).sort(), [false, true]);
  assert.equal(concurrent[0].receipt.id, concurrent[1].receipt.id);
  assert.equal(concurrent[0].receipt.invoiceRunId, null);
  assert.equal(concurrent[0].receipt.lines[0].unitCost, null);
  assert.equal(concurrent[0].receipt.sourceType, "direct");
  await assert.rejects(receiveDirectInventory({ ...command, quantity: 3 }, context), { code: "INVENTORY_RECEIPT_REPLAY_CONFLICT" });
  const receivingPositionId = (await query(`select id from inventory_positions where company_id=$1 and location_id=$2 and system_key='receiving'`, [companyId, locationId])).rows[0].id;
  const beforeInvalidTarget = await query(`select
    (select count(*)::int from local_inventory_receipts where company_id=$1) receipts,
    (select count(*)::int from inventory_position_movements where company_id=$1) movements`, [companyId]);
  for (const invalidTargetPositionId of [receivingPositionId, receivingStagingPositionId]) {
    await assert.rejects(receiveDirectInventory(payload("quantity", { targetPositionId: invalidTargetPositionId }), context), { code: "INVENTORY_RECEIPT_POSITION_INVALID" });
  }
  const afterInvalidTarget = await query(`select
    (select count(*)::int from local_inventory_receipts where company_id=$1) receipts,
    (select count(*)::int from inventory_position_movements where company_id=$1) movements`, [companyId]);
  assert.deepEqual(afterInvalidTarget.rows, beforeInvalidTarget.rows);
  const bulk = await receiveDirectInventory(payload("measured_bulk", { quantity: 1.125, targetPositionId }), context);
  assert.equal(bulk.receipt.lines[0].quantity, 1.125);
  assert.equal(bulk.receipt.units.length, 0);
  const receiptPositions = await query(`select balance.catalog_part_id,position.system_key,balance.position_id,balance.quantity
    from inventory_position_balances balance join inventory_positions position on position.company_id=balance.company_id and position.id=balance.position_id
    where balance.company_id=$1 and balance.catalog_part_id=any($2::uuid[]) order by balance.catalog_part_id,balance.position_id`, [companyId, [parts.quantity, parts.measured_bulk]]);
  assert.ok(receiptPositions.rows.some((row) => row.catalog_part_id === parts.quantity && row.system_key === "receiving" && row.quantity === "2.000"));
  assert.ok(receiptPositions.rows.some((row) => row.catalog_part_id === parts.measured_bulk && row.position_id === targetPositionId && row.quantity === "1.125"));
  const serials = payload("serialized", { serialNumbers: ["S1", "S2"] });
  const exact = await receiveDirectInventory(serials, context);
  assert.deepEqual(exact.receipt.units.map((unit) => unit.serialNumber), ["S1", "S2"]);
  assert.equal(exact.receipt.labelBatch.itemCount, 2);
  const serialSearch = await listLocalInventoryStock({ companyIds: [companyId], locationIds: [locationId], queryText: "S1" });
  assert.equal(serialSearch.length, 1);
  assert.equal(serialSearch[0].catalogPartId, parts.serialized);
  await assert.rejects(receiveDirectInventory({ ...serials, idempotencyKey: randomUUID() }, context), { code: "INVENTORY_SERIAL_ALREADY_EXISTS" });
  await assert.rejects(receiveDirectInventory(payload("quantity"), { ...context, companyIds: new Set([randomUUID()]) }));
  await assert.rejects(receiveDirectInventory(payload("quantity", { expectedPartVersion: 99 }), context), { code: "INVENTORY_CATALOG_PART_CHANGED" });
  assert.equal((await readDirectReceiptOutcome(command.idempotencyKey, context)).status, "posted");
  assert.equal((await readDirectReceiptOutcome(command.idempotencyKey, { ...context, actor: { ...context.actor, id: randomUUID() } })).status, "not_found");
  const activity = await readPartStockMovements(parts.quantity, new URLSearchParams(), context);
  assert.equal(activity.items.length, 1);
  assert.equal(activity.items[0].type, "direct_receipt");
  assert.equal(activity.items[0].quantity, 2);
  assert.equal(activity.items[0].receiptId, concurrent[0].receipt.id);
  assert.equal(activity.hasMore, false);
  assert.deepEqual((await readPartStockMovements(parts.quantity, new URLSearchParams(), { ...context, locationIds: new Set() })).items, []);
  await assert.rejects(readPartStockMovements(parts.quantity, new URLSearchParams("page=0"), context));
  const balances = await query(`select catalog_part_id,quantity_on_hand,quantity_reserved from inventory_items where company_id=$1`, [companyId]);
  assert.equal(balances.rows.find((row) => row.catalog_part_id === parts.quantity).quantity_on_hand, "2.000");
  assert.equal(balances.rows.find((row) => row.catalog_part_id === parts.serialized).quantity_on_hand, "2.000");
  assert.equal(balances.rows.find((row) => row.catalog_part_id === parts.measured_bulk).quantity_on_hand, "1.125");
  const counts = await query(`select
    (select count(*)::integer from inventory_stock_movements where company_id=$1) as movements,
    (select count(*)::integer from local_inventory_receipts where company_id=$1) as receipts,
    (select count(*)::integer from inventory_receipts where company_id=$1) as canonical_receipts,
    (select count(*)::integer from inventory_serialized_units where company_id=$1) as units,
    (select count(*)::integer from invoice_extraction_runs where company_id=$1) as invoices`, [companyId]);
  assert.deepEqual(counts.rows[0], { movements: 3, receipts: 3, canonical_receipts: 3, units: 2, invoices: 0 });
  await query("update parts_catalog set version=version+1 where id=$1", [parts.quantity]);
  assert.equal((await receiveDirectInventory(command, context)).replayed, true);
});

test("Purchasing derives approved catalog demand from outstanding work order requests without stocking policies", {skip:!enabled}, async()=>{
 const companyId=randomUUID(),locationId=randomUUID(),otherLocationId=randomUUID(),workorderId=randomUUID(),partId=randomUUID();
 const context={actor:{id:randomUUID(),role:'office'},companyIds:new Set([companyId]),locationIds:new Set([locationId])};
 await query("insert into companies(id,slug,name) values($1,$2,'Request queue test')",[companyId,companyId]);
 await query("insert into locations(id,company_id,name) values($1,$2,'Request shop'),($3,$2,'Other shop')",[locationId,companyId,otherLocationId]);
 await query("insert into operational_workorders(id,company_id,serial,location_id) values($1,$2,$3,$4)",[workorderId,companyId,workorderId,locationId]);
 await query("insert into parts_catalog(id,company_id,part_number,normalized_part_number,description,uom_code,tracking_mode) values($1,$2,'REQ-PART','REQ-PART','Requested part','ea','quantity')",[partId,companyId]);
 const requestId=randomUUID();
 await query("insert into workorder_part_requests(id,workorder_id,catalog_part_id,raw_query,quantity,uom_code,approval_status) values($1,$2,$3,'Requested part',5,'ea','submitted')",[requestId,workorderId,partId]);
 const read=()=>getPurchasing(new URLSearchParams({locationId}),context);
 let result=await read();
 assert.equal(result.demand.length,0);
 await query("update workorder_part_requests set approval_status='approved' where id=$1",[requestId]);
 result=await read();
 assert.equal(result.demand.length,1);
 assert.equal(result.demand[0].catalog_part_id,partId);
 assert.equal(Number(result.demand[0].workorder_quantity),5);
 assert.equal(Number(result.demand[0].buy_quantity),5);
 assert.equal(result.demand[0].workorders[0].requestId,requestId);
 for(const status of ['rejected','cancelled']) {
   await query("update workorder_part_requests set approval_status=$2 where id=$1",[requestId,status]);
   assert.equal((await read()).demand.length,0);
 }
 await query("update workorder_part_requests set approval_status='needs_info' where id=$1",[requestId]);
 assert.equal((await read()).demand.length,0);
 await query("update workorder_part_requests set approval_status='approved' where id=$1",[requestId]);
 await query("update operational_workorders set location_id=$2 where id=$1",[workorderId,otherLocationId]);
 assert.equal((await read()).demand.length,0);
 await assert.rejects(getPurchasing(new URLSearchParams({locationId:otherLocationId}),context));
 await query("update operational_workorders set location_id=$2,status='closed' where id=$1",[workorderId,locationId]);
 assert.equal((await read()).demand.length,0);
});

test("Purchases: scope, revisions, approval, partial receiving, cancellation and replay", {skip:!enabled}, async()=>{
 const companyId=randomUUID(),locationId=randomUUID(),actorId=randomUUID(),partId=randomUUID();
 const office={actor:{id:actorId,role:'office'},companyIds:new Set([companyId]),locationIds:new Set([locationId])};
 const approverId=randomUUID();
 const admin={...office,actor:{id:approverId,role:'admin'}};
 await query("insert into companies(id,slug,name) values($1,$2,'Purchasing test')",[companyId,companyId]);
 await query("insert into locations(id,company_id,name) values($1,$2,'Purchase shop')",[locationId,companyId]);
 await query("insert into user_profiles(id,display_name) values($1,'Purchaser'),($2,'Approver')",[actorId,approverId]);
 await query("insert into user_company_memberships(user_id,company_id,role) values($1,$3,'office'),($2,$3,'admin')",[actorId,approverId,companyId]);
 await savePurchaseApprovalSettings({locationId,expectedVersion:0,approvalLimit:'50',currency:'USD',approverUserIds:[approverId],approverRoles:[]},admin);
 await query("insert into parts_catalog(id,company_id,part_number,normalized_part_number,description,uom_code,tracking_mode) values($1,$2,'OIL','OIL','Oil','gal','measured_bulk')",[partId,companyId]);
 const send=(body,ctx=office)=>savePurchase({locationId,idempotencyKey:randomUUID(),...body},ctx);
 const {supplier}=await send({action:'supplier',name:'Parts supplier'});
 const payload={action:'create',supplierId:supplier.id,currency:'USD',expectedDeliveryDate:'2026-09-20',lines:[{catalogPartId:partId,quantity:5.5,unitPrice:'12.2500'}]};
 const key=randomUUID();
 const [a,b]=await Promise.all([send({...payload,idempotencyKey:key}),send({...payload,idempotencyKey:key})]);
 assert.equal(a.order.id,b.order.id);
 assert.equal((await getPurchasing(new URLSearchParams({locationId,status:'draft'}),office)).items[0].id,a.order.id);
 assert.equal((await getPurchasing(new URLSearchParams({locationId,status:'ordered'}),office)).items.length,0);
 const recovered=await getPurchaseCommand(new URLSearchParams({locationId,idempotencyKey:key}),office);
 assert.equal(recovered.status,'posted');
 await assert.rejects(send({...payload,idempotencyKey:key,notes:'Different'}));
 let order=(await send({action:'revise',...payload,action:'revise',orderId:a.order.id,expectedVersion:1,notes:'Reviewed draft'})).order;
 assert.equal(order.version,2);
 order=(await send({action:'submit',orderId:order.id,expectedVersion:order.version})).order;
 await assert.rejects(send({action:'approve',orderId:order.id,expectedVersion:order.version}));
 assert.equal(order.status,'awaiting_approval');
 assert.equal((await getPurchasing(new URLSearchParams({locationId,view:'receiving'}),office)).items.length,0);
 const beforePlacement={locationId,catalogPartId:partId,expectedPartVersion:1,trackingMode:'measured_bulk',uomCode:'gal',quantity:1,idempotencyKey:randomUUID(),confirmation:'new_company_stock_received',noPurchaseOrderReason:'Direct arrival without PO',purchaseLineId:order.lines[0].id};
 await assert.rejects(receiveDirectInventory(beforePlacement,office),{code:'INVENTORY_PURCHASE_RECEIPT_CONFLICT'});
 const placement={action:'approve',orderId:order.id,expectedVersion:order.version,idempotencyKey:randomUUID()};
 order=(await send(placement,admin)).order;
 assert.equal(order.status,'ordered');
 assert.equal((await send(placement,admin)).order.version,order.version);
 assert.equal(order.placed_by,approverId);
 assert.ok(order.placed_at);
 assert.equal((await query('select * from inventory_items where company_id=$1',[companyId])).rows.length,0);
 assert.equal((await getPurchasing(new URLSearchParams({locationId,view:'receiving'}),office)).items[0].id,order.id);
 assert.equal((await getPurchasing(new URLSearchParams({locationId,status:'ordered'}),office)).items[0].id,order.id);
 assert.equal((await getPurchasing(new URLSearchParams({locationId,status:'draft'}),office)).items.length,0);
 const receive=(quantities,changes={})=>receivePurchaseOrder(order.id,{locationId,expectedVersion:order.version,idempotencyKey:randomUUID(),reference:'Packing slip',lines:[{purchaseLineId:order.lines[0].id,acceptedQuantity:0,heldQuantity:0,rejectedQuantity:0,notReceivedQuantity:0,outcome:'accepted',notes:'',holdLocation:'',serialNumbers:[],...quantities}],...changes},office);
 const confirmation={action:'receive',orderId:order.id,expectedVersion:order.version,confirmation:'all_ordered_goods_received',idempotencyKey:randomUUID()};
 await assert.rejects(send(confirmation),{code:'INVENTORY_PURCHASE_RECEIPT_LINES_REQUIRED'});
 assert.equal((await query('select * from inventory_items where company_id=$1',[companyId])).rows.length,0);
 const partialKey=randomUUID();
 const posted=await receive({acceptedQuantity:2.125},{idempotencyKey:partialKey});
 assert.equal((await receive({acceptedQuantity:2.125},{idempotencyKey:partialKey})).receipt.id,posted.receipt.id);
 let list=await getPurchasing(new URLSearchParams({locationId,view:'receiving'}),office);
 assert.equal(list.items[0].status,'partially_received');
 assert.equal(Number(list.items[0].lines[0].received_quantity),2.125);
 order=list.items[0];
 await assert.rejects(receive({acceptedQuantity:4}),{code:'INVENTORY_PURCHASE_RECEIPT_CONFLICT'});
 await receive({acceptedQuantity:3.375});
 list=await getPurchasing(new URLSearchParams({locationId,view:'receiving'}),office);
 assert.equal(list.items.length,0);
 assert.equal(list.receipts.length,2);
 assert.equal(Number((await query('select quantity_on_hand from inventory_items where company_id=$1',[companyId])).rows[0].quantity_on_hand),5.5);
 const cancelledDraft=(await send(payload)).order;
 const cancelled=(await send({action:'cancel',orderId:cancelledDraft.id,expectedVersion:cancelledDraft.version,reason:'No longer needed'})).order;
 assert.equal(cancelled.status,'cancelled');
 let discrepancy=(await send(payload)).order;
 discrepancy=(await send({action:'submit',orderId:discrepancy.id,expectedVersion:discrepancy.version})).order;
 discrepancy=(await send({action:'approve',orderId:discrepancy.id,expectedVersion:discrepancy.version,idempotencyKey:randomUUID()},admin)).order;
 await receivePurchaseOrder(discrepancy.id,{locationId,expectedVersion:discrepancy.version,idempotencyKey:randomUUID(),reference:'Partial delivery',lines:[{purchaseLineId:discrepancy.lines[0].id,acceptedQuantity:1,heldQuantity:0,rejectedQuantity:0,notReceivedQuantity:0,outcome:'accepted',notes:'',holdLocation:'',serialNumbers:[]}]},office);
 discrepancy=(await getPurchasing(new URLSearchParams({locationId,view:'receiving'}),office)).items.find(candidate=>candidate.id===discrepancy.id);
 discrepancy=(await send({action:'cancel',orderId:discrepancy.id,expectedVersion:discrepancy.version,reason:'Supplier cannot deliver the remaining quantity'})).order;
 assert.equal(discrepancy.status,'closed_with_discrepancy');
 assert.equal(Number(discrepancy.lines[0].received_quantity),1);
 assert.equal(Number(discrepancy.lines[0].cancelled_quantity),4.5);
 // Uncatalogued orders create no catalog record until physical receipt.
 let unknown=(await send({action:'create',supplierId:supplier.id,currency:'USD',expectedDeliveryDate:'2026-09-20',lines:[{partNumber:'NEW-FILTER',description:'New filter',uomCode:'ea',trackingMode:'quantity',quantity:3,unitPrice:'1'}]})).order;
 assert.equal(unknown.lines.length,1);
 assert.equal(unknown.lines[0].catalog_part_id,null);
 assert.equal((await query("select id from parts_catalog where company_id=$1 and part_number='NEW-FILTER'",[companyId])).rows.length,0);
 unknown=(await send({action:'submit',orderId:unknown.id,expectedVersion:unknown.version})).order;
 assert.equal(unknown.status,'ordered');
 const newReceipt={locationId,purchaseLineId:unknown.lines[0].id,trackingMode:'quantity',uomCode:'ea',quantity:1,idempotencyKey:randomUUID(),confirmation:'new_company_stock_received',noPurchaseOrderReason:'Direct arrival without PO'};
 await assert.rejects(receiveDirectInventory({...newReceipt,quantity:4},office));
 assert.equal((await query("select id from parts_catalog where company_id=$1 and part_number='NEW-FILTER'",[companyId])).rows.length,0);
 const first=await receiveDirectInventory(newReceipt,office);
 assert.equal((await receiveDirectInventory(newReceipt,office)).receipt.id,first.receipt.id);
 await receiveDirectInventory({...newReceipt,idempotencyKey:randomUUID(),quantity:2},office);
 const newParts=(await query("select p.id,i.quantity_on_hand from parts_catalog p join inventory_items i on i.catalog_part_id=p.id where p.company_id=$1 and p.part_number='NEW-FILTER'",[companyId])).rows;
 assert.equal(newParts.length,1);assert.equal(Number(newParts[0].quantity_on_hand),3);
 const newOrder=(await getPurchasing(new URLSearchParams({locationId,status:'received'}),office)).items.find(o=>o.id===unknown.id);
 assert.equal(newOrder.lines[0].catalog_part_id,newParts[0].id);
 // A second PO verifies that multiple physical deliveries finish the order automatically.
 let complete=(await send(payload)).order;
 complete=(await send({action:'submit',orderId:complete.id,expectedVersion:complete.version})).order;
 complete=(await send({action:'approve',orderId:complete.id,expectedVersion:complete.version},admin)).order;
 assert.equal(complete.status,'ordered');
 const delivery={locationId,catalogPartId:partId,expectedPartVersion:1,trackingMode:'measured_bulk',uomCode:'gal',purchaseLineId:complete.lines[0].id,idempotencyKey:randomUUID(),quantity:2,confirmation:'new_company_stock_received'};
 await receiveDirectInventory(delivery,office);
 await receiveDirectInventory({...delivery,idempotencyKey:randomUUID(),quantity:3.5},office);
 const finished=(await getPurchasing(new URLSearchParams({locationId,status:'received'}),office)).items[0];
 assert.equal(finished.id,complete.id);
 assert.equal(Number(finished.lines[0].received_quantity),5.5);
 assert.equal((await getPurchasing(new URLSearchParams({locationId,view:'receiving'}),office)).items.length,0);
 await assert.rejects(receiveDirectInventory({...delivery,idempotencyKey:randomUUID()},office),{code:'INVENTORY_PURCHASE_RECEIPT_CONFLICT'});
 assert.equal(Number((await query('select quantity_on_hand from inventory_items where company_id=$1',[companyId])).rows.find(row=>Number(row.quantity_on_hand)===12).quantity_on_hand),12);
 await assert.rejects(getPurchasing(new URLSearchParams({locationId}),{...office,companyIds:new Set([randomUUID()])}));
});

test('configured purchase approval policy durably waits with zero stock mutation and posts once after approval', {skip:!enabled}, async()=>{
 const {decideDirectReceiptApproval}=await import('./direct-inventory-receipt.service.js');
 const companyId=randomUUID(),locationId=randomUUID(),adminId=randomUUID(),officeId=randomUUID(),partId=randomUUID();
 const admin={actor:{id:adminId,role:'admin'},companyIds:new Set([companyId]),locationIds:new Set([locationId])};
 const office={actor:{id:officeId,role:'office'},companyIds:new Set([companyId]),locationIds:new Set([locationId])};
 await query("insert into companies(id,slug,name) values($1,$2,'No PO approval test')",[companyId,companyId]);
 await query("insert into locations(id,company_id,name) values($1,$2,'No PO shop')",[locationId,companyId]);
 await query("insert into user_profiles(id,display_name) values($1,'No PO admin'),($2,'No PO office')",[adminId,officeId]);
 await query("insert into user_company_memberships(user_id,company_id,role,active) values($1,$3,'admin',true),($2,$3,'office',true)",[adminId,officeId,companyId]);
 await query("insert into parts_catalog(id,company_id,part_number,normalized_part_number,description,uom_code,tracking_mode) values($1,$2,'NOPO','NOPO','No PO part','ea','quantity')",[partId,companyId]);
 await savePurchaseApprovalSettings({locationId,expectedVersion:0,approvalLimit:'1',currency:'USD',approverUserIds:[adminId],approverRoles:[]},admin);
 const command={locationId,catalogPartId:partId,expectedPartVersion:1,trackingMode:'quantity',uomCode:'ea',quantity:2,noPurchaseOrderReason:'Vendor delivered before a PO was created.',idempotencyKey:randomUUID(),confirmation:'new_company_stock_received'};
 const stockCount=async()=> (await query(`select (select count(*)::int from local_inventory_receipts where company_id=$1) receipts,(select count(*)::int from inventory_stock_movements where company_id=$1) movements,(select count(*)::int from inventory_items where company_id=$1) items,(select count(*)::int from inventory_serialized_units where company_id=$1) units,(select count(*)::int from inventory_position_balances where company_id=$1) positions`,[companyId])).rows[0];
 const before=await stockCount();
 const submitted=await receiveDirectInventory(command,office);
 assert.equal(submitted.status,'approval_needed');
 assert.equal(submitted.approvalRequest.status,'pending');
 assert.deepEqual(await stockCount(),before);
 const replay=await receiveDirectInventory(command,office);
 assert.equal(replay.replayed,true);assert.equal(replay.approvalRequest.id,submitted.approvalRequest.id);
 await assert.rejects(receiveDirectInventory({...command,quantity:3},office),{code:'INVENTORY_RECEIPT_REPLAY_CONFLICT'});
 assert.equal((await readDirectReceiptOutcome(command.idempotencyKey,office)).status,'approval_needed');
 assert.equal((await readDirectReceiptOutcome(command.idempotencyKey,{...office,actor:{...office.actor,id:randomUUID()}})).status,'not_found');
 const decisions=await Promise.allSettled([1,2].map(()=>decideDirectReceiptApproval(submitted.approvalRequest.id,{action:'approve',expectedVersion:submitted.approvalRequest.version,reason:'Verified no-PO arrival'},admin)));
 const approved=decisions.find(result=>result.status==='fulfilled')?.value;
 assert.ok(approved?.receipt?.id);
 assert.ok(decisions.every(result=>result.status==='fulfilled'?result.value.receipt.id===approved.receipt.id:result.reason.code==='INVENTORY_DIRECT_RECEIPT_APPROVAL_STALE'));
 const request=(await query('select * from inventory_direct_receipt_approval_requests where company_id=$1 and id=$2',[companyId,submitted.approvalRequest.id])).rows[0];
 assert.equal(request.status,'approved');assert.equal(request.receipt_id,approved.receipt.id);assert.equal(request.decision_by,adminId);
 assert.equal((await query("select count(*)::int count from inventory_direct_receipt_approval_events where company_id=$1 and request_id=$2 and action='approve'",[companyId,request.id])).rows[0].count,1);
 assert.deepEqual(await stockCount(),{receipts:1,movements:1,items:1,units:0,positions:1});
 assert.equal((await readDirectReceiptOutcome(command.idempotencyKey,office)).receipt.id,approved.receipt.id);
 const rejected=await receiveDirectInventory({...command,idempotencyKey:randomUUID()},office);
 const rejectedResult=await decideDirectReceiptApproval(rejected.approvalRequest.id,{action:'reject',expectedVersion:rejected.approvalRequest.version,reason:'Invoice evidence required'},admin);
 assert.equal(rejectedResult.status,'rejected');
 const cancelled=await receiveDirectInventory({...command,idempotencyKey:randomUUID()},office);
 const cancelledResult=await decideDirectReceiptApproval(cancelled.approvalRequest.id,{action:'cancel',expectedVersion:cancelled.approvalRequest.version,reason:'Entered by mistake'},office);
 assert.equal(cancelledResult.status,'cancelled');
 const targetPositionId=randomUUID();
 await query(`insert into inventory_positions(id,company_id,location_id,code,name,kind,usage,can_store,is_pickable,created_by) values($1,$2,$3,'NOPO-BIN','No PO bin','bin','storage',true,true,$4)`,[targetPositionId,companyId,locationId,adminId]);
 const staleTarget=await receiveDirectInventory({...command,idempotencyKey:randomUUID(),targetPositionId},office);
 await query('update inventory_positions set is_active=false,version=version+1 where company_id=$1 and id=$2',[companyId,targetPositionId]);
 await assert.rejects(decideDirectReceiptApproval(staleTarget.approvalRequest.id,{action:'approve',expectedVersion:staleTarget.approvalRequest.version,reason:'Approve'},admin),{code:'INVENTORY_RECEIPT_POSITION_INVALID'});
 assert.equal((await query('select status from inventory_direct_receipt_approval_requests where id=$1',[staleTarget.approvalRequest.id])).rows[0].status,'pending');
 const staleCatalog=await receiveDirectInventory({...command,idempotencyKey:randomUUID()},office);
 await query('update parts_catalog set version=version+1 where company_id=$1 and id=$2',[companyId,partId]);
 await assert.rejects(decideDirectReceiptApproval(staleCatalog.approvalRequest.id,{action:'approve',expectedVersion:staleCatalog.approvalRequest.version,reason:'Approve'},admin),{code:'INVENTORY_CATALOG_PART_CHANGED'});
 await assert.rejects(decideDirectReceiptApproval(staleCatalog.approvalRequest.id,{action:'reject',expectedVersion:staleCatalog.approvalRequest.version,reason:'Wrong tenant'},{...admin,companyIds:new Set([randomUUID()])}),{code:'inventory_not_found'});
 await assert.rejects(decideDirectReceiptApproval(staleCatalog.approvalRequest.id,{action:'reject',expectedVersion:staleCatalog.approvalRequest.version,reason:'Unauthorized'},{...office,actor:{...office.actor,role:'mechanic'}}),{code:'INVENTORY_RECEIVE_FORBIDDEN'});
 await assert.rejects(query(`update inventory_direct_receipt_approval_requests set original_command=jsonb_set(original_command,'{quantity}','9') where id=$1`,[staleCatalog.approvalRequest.id]),/immutable/i);
 assert.deepEqual(await stockCount(),{receipts:1,movements:1,items:1,units:0,positions:1});
});

test('Stock tasks preserve quantities, identities, scope, reservations and count revisions', {skip:!enabled}, async()=>{
 const companyId=randomUUID(),source=randomUUID(),destination=randomUUID(),actorId=randomUUID(),partId=randomUUID(),serialPartId=randomUUID(),sourcePositionId=randomUUID(),destinationPositionId=randomUUID();
 const office={actor:{id:actorId,role:'office'},companyIds:new Set([companyId]),locationIds:new Set([source,destination])},admin={...office,actor:{id:actorId,role:'admin'}};
 await query("insert into companies(id,slug,name) values($1,$2,'Stock task test')",[companyId,companyId]);
 await query("insert into locations(id,company_id,name) values($1,$3,'Source'),($2,$3,'Destination')",[source,destination,companyId]);
 await query("insert into user_profiles(id,display_name) values($1,'Stock operator')",[actorId]);
  await query("insert into inventory_positions(id,company_id,location_id,code,name,kind,usage,can_store,is_pickable) values($1,$3,$4,'SOURCE-A-01','Source A-01','bin','storage',true,true),($2,$3,$5,'DEST-A-01','Destination A-01','bin','storage',true,true)",[sourcePositionId,destinationPositionId,companyId,source,destination]);
 await query("insert into parts_catalog(id,company_id,part_number,normalized_part_number,description,uom_code,tracking_mode) values($1,$3,'BULK','BULK','Bulk oil','gal','measured_bulk'),($2,$3,'SERIAL','SERIAL','Exact part','ea','serialized')",[partId,serialPartId,companyId]);
 const receipt=(changes={})=>receiveDirectInventory({locationId:source,catalogPartId:partId,expectedPartVersion:1,trackingMode:'measured_bulk',uomCode:'gal',quantity:10,idempotencyKey:randomUUID(),confirmation:'new_company_stock_received',noPurchaseOrderReason:'Direct arrival without PO',...changes},office);
 await receipt();await receipt({catalogPartId:serialPartId,trackingMode:'serialized',uomCode:'ea',quantity:2,serialNumbers:['EXACT-A','EXACT-B']});
 const snapshot=(part=partId,locationId=source)=>getStockTaskSnapshot(new URLSearchParams({locationId,catalogPartId:part}),office);
 const send=(body,ctx=office)=>postStockTask({locationId:source,idempotencyKey:randomUUID(),reason:'Physically verified',...body},ctx);
 let snap=await snapshot();
 const damage={action:'damage',catalogPartId:partId,quantity:2.125,expectedBalanceRevision:snap.revision,holder:'Hold shelf',idempotencyKey:randomUUID()};
 const [one,two]=await Promise.all([send(damage),send(damage)]);assert.equal(one.task.id,two.task.id);
 assert.equal(Number((await snapshot()).quantity_on_hand),7.875);
 let reports=await getInventoryReports(new URLSearchParams({locationId:source}),office);
 const bulk=reports.stock.find(s=>s.id===partId);assert.equal(Number(bulk.physical_on_hand),10);assert.equal(Number(bulk.held_quantity),2.125);
 await assert.rejects(send({action:'release',taskId:one.task.id,expectedVersion:1,holder:'Shelf'}));
 await assert.rejects(send({action:'repair',taskId:one.task.id,expectedVersion:1,holder:'Repair supplier'}),{code:'INVENTORY_REUSE_FORBIDDEN'});
 await query("insert into inventory_reuse_capability_grants(company_id,location_id,user_id,capability,granted_by_user_id) select $1,$2,$3,cap,$3 from unnest(array['repair','release','disposition']) cap",[companyId,source,actorId]);
 await query("insert into inventory_reuse_catalog_policies(company_id,location_id,catalog_part_id,reuse_allowed,repair_allowed,scrap_allowed,evidence,updated_by_user_id) select $1,$2,part,true,true,true,'Test approved policy',$3 from unnest($4::uuid[]) part",[companyId,source,actorId,[partId,serialPartId]]);
 let task=(await send({action:'repair',taskId:one.task.id,expectedVersion:1,holder:'Repair supplier'})).task;
 task=(await send({action:'release',taskId:task.id,expectedVersion:task.version,holder:'Inspected shelf',targetPositionId:sourcePositionId},admin)).task;
 assert.equal(task.status,'released');assert.equal(Number((await snapshot()).quantity_on_hand),10);
 await assert.rejects(send({action:'release',taskId:task.id,expectedVersion:task.version,holder:'Shelf',targetPositionId:sourcePositionId},admin));
 snap=await snapshot();
 await assert.rejects(send({action:'count',catalogPartId:partId,quantity:9,expectedBalanceRevision:snap.revision,holder:'Usable shelves'}),{code:'INVENTORY_POSITION_COUNT_REQUIRED'});
 await receipt({quantity:1});
 assert.equal(Number((await snapshot()).quantity_on_hand),11);
 snap=await snapshot();
 const transferQuantity=3.25,sourceAllocations=[];let transferRemaining=transferQuantity;
 for(const position of snap.positions){const quantity=Math.min(transferRemaining,Number(position.availableQuantity));if(quantity>0)sourceAllocations.push({positionId:position.positionId,quantity});transferRemaining-=quantity;if(transferRemaining===0)break;}
 assert.equal(transferRemaining,0);
 let transfer=(await send({action:'transfer',catalogPartId:partId,quantity:transferQuantity,expectedBalanceRevision:snap.revision,holder:'Driver 1',destinationId:destination,sourceAllocations})).task;
 assert.equal(Number((await snapshot()).quantity_on_hand),7.75);
 transfer=(await send({action:'receive_transfer',locationId:destination,taskId:transfer.id,expectedVersion:transfer.version,quantity:1.25,holder:'Rack A',targetPositionId:destinationPositionId})).task;
 assert.equal(transfer.status,'in_transit');assert.equal(Number((await snapshot(partId,destination)).quantity_on_hand),1.25);
 await assert.rejects(send({action:'receive_transfer',locationId:destination,taskId:transfer.id,expectedVersion:transfer.version,quantity:3,holder:'Rack A',targetPositionId:destinationPositionId}));
 transfer=(await send({action:'receive_transfer',locationId:destination,taskId:transfer.id,expectedVersion:transfer.version,quantity:2,holder:'Rack A',targetPositionId:destinationPositionId})).task;
 assert.equal(transfer.status,'received');
 await query('update parts_catalog set tracking_mode=null where id=$1',[serialPartId]);
 snap=await snapshot(serialPartId);
 assert.equal(snap.tracking_mode,'serialized');
 const qrUnit=(await query("select id from inventory_serialized_units where company_id=$1 and serial_number='EXACT-A'",[companyId])).rows[0].id;
 const qrCode=inventoryScanUrl(createInventoryQrToken(qrUnit));
 let exact=(await send({action:'damage',catalogPartId:serialPartId,quantity:1,serialNumbers:[qrCode],expectedBalanceRevision:snap.revision,holder:'Hold shelf'})).task;
 const exactId=exact.units[0].id;
 assert.equal((await query('select status from inventory_serialized_units where id=$1',[exactId])).rows[0].status,'removed');
 await assert.rejects(send({action:'release',taskId:exact.id,expectedVersion:exact.version,holder:'Shelf',serialNumbers:['EXACT-B']},admin));
 exact=(await send({action:'release',taskId:exact.id,expectedVersion:exact.version,holder:'Shelf',serialNumbers:['EXACT-A'],targetPositionId:sourcePositionId},admin)).task;
 assert.equal(exact.units[0].id,exactId);
 snap=await snapshot(serialPartId);
 transfer=(await send({action:'transfer',catalogPartId:serialPartId,quantity:1,serialNumbers:['EXACT-A'],expectedBalanceRevision:snap.revision,holder:'Driver',destinationId:destination})).task;
 transfer=(await send({action:'receive_transfer',locationId:destination,taskId:transfer.id,expectedVersion:transfer.version,quantity:1,serialNumbers:['EXACT-A'],holder:'Exact rack',targetPositionId:destinationPositionId})).task;
 assert.equal(transfer.units[0].id,exactId);assert.equal((await query('select location_id from inventory_serialized_units where id=$1',[exactId])).rows[0].location_id,destination);
 snap=await snapshot(serialPartId);
 await assert.rejects(send({action:'count',catalogPartId:serialPartId,quantity:0,serialNumbers:[],expectedBalanceRevision:snap.revision,holder:'All usable shelves'}),{code:'INVENTORY_POSITION_COUNT_REQUIRED'});
 const remainingExact=(await query("select status,custody_holder_type,current_position_id from inventory_serialized_units where company_id=$1 and serial_number='EXACT-B'",[companyId])).rows[0];
 assert.equal(remainingExact.status,'in_stock');assert.equal(remainingExact.custody_holder_type,'inventory_location');assert.ok(remainingExact.current_position_id);assert.equal(Number((await snapshot(serialPartId)).quantity_on_hand),1);
 const history=await getStockTasks(new URLSearchParams({locationId:destination,kind:'transfer'}),office);assert.equal(history.items.length,2);
 await assert.rejects(getStockTasks(new URLSearchParams({locationId:destination}),{...office,locationIds:new Set([source])}));
 const ledger=await query('select sum(quantity_delta) as total from inventory_stock_movements where company_id=$1 and catalog_part_id=$2',[companyId,partId]);assert.equal(Number(ledger.rows[0].total),11);
 await query('update inventory_items set quantity_reserved=quantity_on_hand where company_id=$1 and catalog_part_id=$2 and location_id=$3',[companyId,partId,source]);
 snap=await snapshot();await assert.rejects(send({action:'damage',catalogPartId:partId,quantity:1,expectedBalanceRevision:snap.revision,holder:'Hold'}));
});

test('Damaged delivery stays held; bill matching and money never post stock twice', {skip:!enabled},async()=>{
 const companyId=randomUUID(),locationId=randomUUID(),actorId=randomUUID(),partId=randomUUID();
 const office={actor:{id:actorId,role:'office'},companyIds:new Set([companyId]),locationIds:new Set([locationId])},admin={...office,actor:{id:actorId,role:'admin'}};
 await query("insert into companies(id,slug,name) values($1,$2,'Bills test')",[companyId,companyId]);
 await query("insert into locations(id,company_id,name) values($1,$2,'Bill shop')",[locationId,companyId]);
 await query("insert into user_profiles(id,display_name) values($1,'Bill operator')",[actorId]);
 await query("insert into parts_catalog(id,company_id,part_number,normalized_part_number,description,uom_code,tracking_mode) values($1,$2,'BILLPART','BILLPART','Bill part','ea','quantity')",[partId,companyId]);
 const held=await receiveDirectInventory({locationId,catalogPartId:partId,expectedPartVersion:1,trackingMode:'quantity',uomCode:'ea',quantity:2,idempotencyKey:randomUUID(),confirmation:'new_company_stock_received',noPurchaseOrderReason:'Direct arrival without PO',disposition:'held',holdLocation:'Inspection rack',damageDetails:'Packaging damaged'},office);
 assert.equal(Number((await getStockTaskSnapshot(new URLSearchParams({locationId,catalogPartId:partId}),office)).quantity_on_hand),0);
 assert.equal(Number((await query('select coalesce(sum(quantity),0) quantity from inventory_position_balances where company_id=$1 and catalog_part_id=$2',[companyId,partId])).rows[0].quantity),0);
 assert.equal(held.receipt.physicalConfirmation,'received_on_hold');assert.equal(held.receipt.disposition,'held');
 const tasks=await getStockTasks(new URLSearchParams({locationId,kind:'damage'}),office);assert.equal(tasks.items.length,1);assert.equal(Number(tasks.items[0].quantity),2);
 const {supplier}=await savePurchase({action:'supplier',locationId,idempotencyKey:randomUUID(),name:'Bill vendor'},office);
 const send=(c,ctx=office)=>postBill({locationId,idempotencyKey:randomUUID(),...c},ctx);
 const create={action:'create',supplierId:supplier.id,reference:'INV-1',currency:'USD',subtotal:'100.10',tax:'8.01',dueDate:'2026-09-01',idempotencyKey:randomUUID()};
 const one=await send(create);assert.equal((await send(create)).bill.id,one.bill.id);
 assert.equal(one.bill.outstanding,'108.11');
 await assert.rejects(send({...create,idempotencyKey:randomUUID()}));
 let bill=(await send({action:'match',billId:one.bill.id,expectedVersion:1,allocations:[{receiptLineId:held.receipt.lines[0].id,quantity:1}]})).bill;
 await assert.rejects(send({action:'match',billId:bill.id,expectedVersion:bill.version,allocations:[{receiptLineId:held.receipt.lines[0].id,quantity:2}]}));
 await assert.rejects(send({action:'payment',billId:bill.id,expectedVersion:bill.version,amount:'10',reference:'Payment'}));
 bill=(await send({action:'credit',billId:bill.id,expectedVersion:bill.version,amount:'8.11',reference:'Credit 1'},admin)).bill;
 assert.equal(bill.outstanding,'100.00');
 const payment={action:'payment',billId:bill.id,expectedVersion:bill.version,amount:'40.00',reference:'Bank 1',idempotencyKey:randomUUID()};
 const paid=await Promise.all([send(payment,admin),send(payment,admin)]);assert.equal(paid[0].bill.paid,'40.00');assert.equal(paid[1].bill.paid,'40.00');bill=paid[0].bill;
 await assert.rejects(send({action:'payment',billId:bill.id,expectedVersion:bill.version,amount:'60.01',reference:'Too much'},admin));
 bill=(await send({action:'payment',billId:bill.id,expectedVersion:bill.version,amount:'60',reference:'Bank 2'},admin)).bill;assert.equal(bill.outstanding,'0.00');
 const overview=await getBills(new URLSearchParams({locationId}),office);assert.equal(overview.receipts[0].unmatched_quantity,'1.000');
 assert.equal(Number((await query('select sum(quantity_delta) as quantity from inventory_stock_movements where company_id=$1',[companyId])).rows[0].quantity),0);
 assert.equal(Number((await query('select count(*) as count from local_inventory_receipts where company_id=$1',[companyId])).rows[0].count),1);
});
