import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after,test } from 'node:test';
import { query,closePool } from '../../db/pool.js';
import { uploadPurchaseBill,listPurchaseBills,downloadPurchaseBill } from './purchase-order-bills.service.js';

const enabled=process.env.RUN_DIRECT_RECEIPT_INTEGRATION==='1';
after(async()=>{if(enabled)await closePool();});
test('PO bill uploads preserve stock, encrypt files, enforce scope and recover retries', {skip:!enabled},async()=>{
  const companyId=randomUUID(),locationId=randomUUID(),actorId=randomUUID(),orderId=randomUUID(),supplierId=randomUUID();
  const context={actor:{id:actorId,role:'office'},companyIds:new Set([companyId]),locationIds:new Set([locationId])};
  await query("insert into companies(id,slug,name) values($1,$2,'Bill upload test')",[companyId,companyId]);
  await query("insert into locations(id,company_id,name) values($1,$2,'Shop')",[locationId,companyId]);
  await query("insert into user_profiles(id,display_name) values($1,'Office')",[actorId]);
  await query("insert into inventory_suppliers(id,company_id,name) values($1,$2,'Supplier')",[supplierId,companyId]);
  await query("insert into inventory_purchase_orders(id,company_id,location_id,supplier_id,created_by,number,currency,status) values($1,$2,$3,$4,$5,'PO-BILL','USD','ordered')",[orderId,companyId,locationId,supplierId,actorId]);
  const bytes=Buffer.from('%PDF-1.4\nBill one\n%%EOF');
  const input={orderId,idempotencyKey:randomUUID(),fileName:'bill.pdf',mimeType:'application/pdf',dataUrl:`data:application/pdf;base64,${bytes.toString('base64')}`,reference:'INV-101'};
  await assert.rejects(uploadPurchaseBill(input,context),{code:'PURCHASE_BILL_NOT_RECEIVED'});
  await query("update inventory_purchase_orders set status='received' where id=$1",[orderId]);
  const results=await Promise.all([uploadPurchaseBill(input,context),uploadPurchaseBill(input,context)]);
  assert.equal(results[0].document.id,results[1].document.id);
  const saved=results[0].document;
  assert.equal((await uploadPurchaseBill({...input,idempotencyKey:randomUUID()},context)).document.id,saved.id);
  await assert.rejects(uploadPurchaseBill({...input,reference:'Different'},context),{code:'PURCHASE_BILL_REPLAY_CONFLICT'});
  await assert.rejects(uploadPurchaseBill({...input,idempotencyKey:randomUUID(),dataUrl:'data:application/pdf;base64,aGVsbG8='},context),{code:'invoice_signature_mismatch'});
  assert.equal((await listPurchaseBills(orderId,context)).items.length,1);
  assert.deepEqual((await downloadPurchaseBill(orderId,saved.id,context)).bytes,bytes);
  const stored=(await query('select ciphertext from inventory_purchase_bill_documents where id=$1',[saved.id])).rows[0];
  assert.notDeepEqual(stored.ciphertext,bytes);
  const second={...input,idempotencyKey:randomUUID(),fileName:'bill-2.pdf',dataUrl:`data:application/pdf;base64,${Buffer.from('%PDF-1.4\nBill two\n%%EOF').toString('base64')}`};
  await uploadPurchaseBill(second,context);
  assert.equal((await listPurchaseBills(orderId,context)).items.length,2);
  for(const other of [{...context,companyIds:new Set([randomUUID()])},{...context,locationIds:new Set()},{...context,actor:{id:actorId,role:'mechanic'}}]) {
    await assert.rejects(listPurchaseBills(orderId,other));
    await assert.rejects(downloadPurchaseBill(orderId,saved.id,other));
    await assert.rejects(uploadPurchaseBill(input,other));
  }
  const order=(await query('select status,version from inventory_purchase_orders where id=$1',[orderId])).rows[0];
  assert.deepEqual(order,{status:'received',version:1});
  assert.equal((await query('select count(*)::integer as count from inventory_items where company_id=$1',[companyId])).rows[0].count,0);
  assert.equal((await query('select count(*)::integer as count from inventory_supplier_bills where company_id=$1',[companyId])).rows[0].count,0);
  assert.equal((await query("select count(*)::integer as count from inventory_purchase_events where order_id=$1 and action='bill_uploaded'",[orderId])).rows[0].count,2);
});
