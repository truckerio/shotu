import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { query, closePool } from '../../db/pool.js';
import { savePurchase, getPurchasing, getPurchaseApprovalSettings, savePurchaseApprovalSettings } from './inventory-purchasing.service.js';

const enabled = process.env.RUN_DIRECT_RECEIPT_INTEGRATION === '1';
after(async () => { if (enabled) await closePool(); });

test('PO thresholds, current approvers, company isolation, revisions and replay', { skip: !enabled }, async () => {
  const companyId=randomUUID(),locationId=randomUUID(),adminId=randomUUID(),officeId=randomUUID(),otherId=randomUUID();
  await query("insert into companies(id,slug,name) values($1,$2,'Approval test')",[companyId,companyId]);
  await query("insert into locations(id,company_id,name) values($1,$2,'Shop')",[locationId,companyId]);
  await query("insert into user_profiles(id,display_name) values($1,'Admin'),($2,'Manager'),($3,'Other admin')",[adminId,officeId,otherId]);
  await query("insert into user_company_memberships(user_id,company_id,role) values($1,$4,'admin'),($2,$4,'office'),($3,$4,'admin')",[adminId,officeId,otherId,companyId]);
  const context=(id,role)=>({actor:{id,role},companyIds:new Set([companyId]),locationIds:new Set([locationId])});
  const admin=context(adminId,'admin'),office=context(officeId,'office'),other=context(otherId,'admin');
  const send=(body,ctx=office)=>savePurchase({locationId,idempotencyKey:randomUUID(),...body},ctx);
  const params=new URLSearchParams({locationId});
  const settings={locationId,expectedVersion:0,approvalLimit:'5000.00',currency:'USD',approverUserIds:[officeId],approverRoles:[]};
  await assert.rejects(async () => savePurchaseApprovalSettings(settings,office),{code:'PURCHASE_SETTINGS_FORBIDDEN'});
  await assert.rejects(async () => savePurchaseApprovalSettings({...settings,approverUserIds:[randomUUID()]},admin),{code:'PURCHASE_APPROVER_INVALID'});
  await assert.rejects(async () => savePurchaseApprovalSettings({...settings,approverUserIds:[]},admin),{code:'PURCHASE_APPROVER_REQUIRED'});
  const {supplier}=await send({action:'supplier',name:'Supplier'});
  const payload=(price,extra={})=>({action:'create',supplierId:supplier.id,currency:'USD',expectedDeliveryDate:'2026-09-20',placeOrder:true,
    lines:[{partNumber:'FILTER',description:'Filter',uomCode:'ea',trackingMode:'quantity',quantity:1,unitPrice:price}],...extra});
  await assert.rejects(async () => send(payload('1')),{code:'PURCHASE_APPROVAL_NOT_CONFIGURED'});
  assert.equal((await getPurchasing(params,office)).items.length,0);
  await savePurchaseApprovalSettings(settings,admin);
  await assert.rejects(async () => savePurchaseApprovalSettings(settings,admin),{code:'PURCHASE_SETTINGS_CHANGED'});
  await assert.rejects(async () => getPurchaseApprovalSettings(new URLSearchParams({locationId:randomUUID()}),admin));
  assert.equal((await getPurchaseApprovalSettings(params,admin)).users.length,3);
  for (const price of ['0','4999.99','5000.00']) {
    const {order}=await send(payload(price));
    assert.equal(order.status,'ordered');
    assert.equal(order.expected_delivery_date,'2026-09-20');
  }
  const command={...payload('5000.0001'),idempotencyKey:randomUUID()};
  const [a,b]=await Promise.all([send(command),send(command)]);
  assert.equal(a.order.id,b.order.id);
  assert.equal(a.order.status,'awaiting_approval');
  assert.equal((await getPurchasing(params,office)).canApprove,true);
  assert.equal((await getPurchasing(params,admin)).canApprove,false);
  const approval={action:'approve',orderId:a.order.id,expectedVersion:a.order.version};
  await assert.rejects(async () => send(approval,admin),{code:'PURCHASE_APPROVAL_FORBIDDEN'});
  await assert.rejects(async () => send(approval,other),{code:'PURCHASE_APPROVAL_FORBIDDEN'});
  await assert.rejects(async () => send({...approval,action:'place'}));
  await assert.rejects(async () => send({...approval,expectedVersion:999}));
  await savePurchaseApprovalSettings({...settings,expectedVersion:1,approverUserIds:[],approverRoles:['admin']},admin);
  await assert.rejects(async () => send(approval),{code:'PURCHASE_APPROVAL_FORBIDDEN'});
  const approved=(await send(approval,other)).order;
  assert.equal(approved.id,a.order.id);
  assert.equal(approved.status,'ordered');
  assert.equal(approved.placed_by,otherId);
  const draft=(await send(payload('10',{placeOrder:false}))).order;
  assert.equal(draft.status,'draft');
  const revised=(await send({...payload('6000'),action:'revise',orderId:draft.id,expectedVersion:draft.version})).order;
  assert.equal(revised.id,draft.id);
  assert.equal(revised.status,'awaiting_approval');
  await query('update user_company_memberships set active=false where user_id=$1 and company_id=$2',[otherId,companyId]);
  await assert.rejects(async () => send({action:'approve',orderId:revised.id,expectedVersion:revised.version},other),{code:'PURCHASE_APPROVAL_FORBIDDEN'});
  assert.equal((await getPurchasing(new URLSearchParams({locationId,query:'not-a-matching-order'}),office)).items.length,0);
  assert.equal((await getPurchasing(new URLSearchParams({locationId,supplierId:randomUUID()}),office)).items.length,0);
  assert.ok((await getPurchasing(new URLSearchParams({locationId,supplierId:supplier.id,query:revised.number}),office)).items.some(item=>item.id===revised.id));
  const count=(await getPurchasing(params,office)).items.length;
  const stockBefore=(await query(`select
    (select count(*)::integer from local_inventory_receipts where company_id=$1) as receipts,
    (select count(*)::integer from inventory_stock_movements where company_id=$1) as movements,
    (select count(*)::integer from inventory_items where company_id=$1) as items`,[companyId])).rows[0];
  const unpriced=(await send(payload(null,{expectedDeliveryDate:null}))).order;
  assert.equal(unpriced.status,'awaiting_approval');
  assert.equal(unpriced.expected_delivery_date,null);
  assert.equal(unpriced.total,null);
  const undated=(await send(payload('1',{expectedDeliveryDate:null}))).order;
  assert.equal(undated.status,'ordered');
  assert.equal(undated.expected_delivery_date,null);
  await assert.rejects(async () => send(payload('1',{currency:'EUR'})),{code:'PURCHASE_APPROVAL_CURRENCY'});
  const stockAfter=(await query(`select
    (select count(*)::integer from local_inventory_receipts where company_id=$1) as receipts,
    (select count(*)::integer from inventory_stock_movements where company_id=$1) as movements,
    (select count(*)::integer from inventory_items where company_id=$1) as items`,[companyId])).rows[0];
  assert.deepEqual(stockAfter,stockBefore);
  assert.equal((await getPurchasing(params,office)).items.length,count+2);
  for(const status of ['approved','approval_waiting','pending_approval']) await assert.rejects(async () => getPurchasing(new URLSearchParams({locationId,status}),office));
});
