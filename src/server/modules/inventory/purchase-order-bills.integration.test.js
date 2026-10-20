import assert from 'node:assert/strict';
import { createHash,randomUUID } from 'node:crypto';
import { after,test } from 'node:test';
import { query,closePool } from '../../db/pool.js';
import { uploadPurchaseBill,listPurchaseBills,downloadPurchaseBill,extractPurchaseBill } from './purchase-order-bills.service.js';

import { decryptInvoiceDocument,encryptInvoiceDocument } from '../invoice-extraction/invoice-document.crypto.js';
import { createInvoiceExtractionRun,createInvoiceExtractionRunInTransaction } from '../../db/repositories/invoice-extractions.repo.js';

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
  assert.equal(saved.invoiceRunId,saved.id);
  assert.equal(saved.extractionStatus,'processing');
  assert.equal((await extractPurchaseBill(orderId,saved.id,context)).replayed,true);
  for(const table of ['invoice_extraction_runs','invoice_source_documents','integration_jobs']) {
    assert.equal((await query(`select count(*)::int count from ${table} where company_id=$1`,[companyId])).rows[0].count,1);
  }
  const source=(await query('select * from invoice_source_documents where run_id=$1',[saved.invoiceRunId])).rows[0];
  assert.deepEqual(decryptInvoiceDocument(source),bytes);
  assert.equal((await query('select idempotency_key from invoice_extraction_runs where id=$1',[saved.invoiceRunId])).rows[0].idempotency_key,`po-bill:${saved.id}`);
  assert.equal((await uploadPurchaseBill({...input,idempotencyKey:randomUUID()},context)).document.id,saved.id);
  await assert.rejects(uploadPurchaseBill({...input,reference:'Different'},context),{code:'PURCHASE_BILL_REPLAY_CONFLICT'});
  await assert.rejects(uploadPurchaseBill({...input,idempotencyKey:randomUUID(),dataUrl:'data:application/pdf;base64,aGVsbG8='},context),{code:'invoice_signature_mismatch'});
  assert.equal((await listPurchaseBills(orderId,context)).items.length,1);
  assert.deepEqual((await downloadPurchaseBill(orderId,saved.id,context)).bytes,bytes);
  const stored=(await query('select ciphertext from inventory_purchase_bill_documents where id=$1',[saved.id])).rows[0];
  assert.notDeepEqual(stored.ciphertext,bytes);
  const second={...input,idempotencyKey:randomUUID(),fileName:'bill-2.pdf',dataUrl:`data:application/pdf;base64,${Buffer.from('%PDF-1.4\nBill two\n%%EOF').toString('base64')}`};
  await uploadPurchaseBill(second,context);
  const failedInput={...input,idempotencyKey:randomUUID(),fileName:'rollback.pdf',dataUrl:`data:application/pdf;base64,${Buffer.from('%PDF-1.4\nRollback\n%%EOF').toString('base64')}`};
  await assert.rejects(uploadPurchaseBill(failedInput,context,{createInvoiceExtractionRunInTransaction:async(client,input)=>{
    await createInvoiceExtractionRunInTransaction(client,input);
    throw new Error('injected failure');
  }}),/injected failure/);
  for(const table of ['inventory_purchase_bill_documents','invoice_extraction_runs','invoice_source_documents','integration_jobs']) {
    assert.equal((await query(`select count(*)::int count from ${table} where company_id=$1`,[companyId])).rows[0].count,2);
  }
  // Re-extraction uses a fresh UUID; latest source identity wins even if failed.
  const latestId=randomUUID(),hash=createHash('sha256').update(bytes).digest('hex');
  await createInvoiceExtractionRun({runId:latestId,companyId,locationId,actorId,documentHash:hash,fileName:'reextract.pdf',mimeType:input.mimeType,byteSize:bytes.length,idempotencyKey:randomUUID(),provider:'hybrid_local_first',model:'test',promptVersion:'invoice-v1',source:encryptInvoiceDocument(bytes,{companyId,runId:latestId,documentHash:hash,mimeType:input.mimeType}),retentionUntil:new Date(Date.now()+86400000).toISOString(),enqueueJob:true});
  await query("update invoice_extraction_runs set status='failed' where id=$1",[latestId]);
  assert.equal((await extractPurchaseBill(orderId,saved.id,context)).invoiceRunId,latestId);
  assert.equal((await listPurchaseBills(orderId,context)).items.find(item=>item.id===saved.id).extractionStatus,'failed');
  // Simulate an attachment saved by the old uploader. GET is read-only; POST prepares it.
  const legacyBytes=Buffer.from('%PDF-1.4\nLegacy\n%%EOF'),legacyId=randomUUID();
  const legacyHash=createHash('sha256').update(legacyBytes).digest('hex');
  const encrypted=encryptInvoiceDocument(legacyBytes,{companyId,runId:legacyId,documentHash:legacyHash,mimeType:input.mimeType});
  await query(`insert into inventory_purchase_bill_documents(id,company_id,order_id,uploaded_by,idempotency_key,request_hash,file_name,mime_type,byte_size,content_sha256,reference,ciphertext,iv,auth_tag,key_version) values($1,$2,$3,$4,$5,$6,'legacy.pdf',$7,$8,$6,'',$9,$10,$11,$12)`,[legacyId,companyId,orderId,actorId,randomUUID(),legacyHash,input.mimeType,legacyBytes.length,encrypted.ciphertext,encrypted.iv,encrypted.authTag,encrypted.keyVersion]);
  assert.equal((await listPurchaseBills(orderId,context)).items.find(item=>item.id===legacyId).invoiceRunId,null);
  const legacy=await extractPurchaseBill(orderId,legacyId,context);
  assert.equal(legacy.replayed,false);
  assert.equal(legacy.invoiceRunId,legacyId);
  assert.deepEqual(decryptInvoiceDocument((await query('select * from invoice_source_documents where run_id=$1',[legacyId])).rows[0]),legacyBytes);
  await assert.rejects(extractPurchaseBill(orderId,randomUUID(),context));
  await assert.rejects(extractPurchaseBill('invalid',legacyId,context));
  await assert.rejects(uploadPurchaseBill({...input,fileName:'bill.exe',idempotencyKey:randomUUID()},context));
  assert.equal((await listPurchaseBills(orderId,context)).items.length,3);
  for(const other of [{...context,companyIds:new Set([randomUUID()])},{...context,locationIds:new Set()},{...context,actor:{id:actorId,role:'mechanic'}}]) {
    await assert.rejects(extractPurchaseBill(orderId,saved.id,other));
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

test('bill identity isolates tenant/shop/MIME, shares exact source across POs and exposes only live allocations',{skip:!enabled},async()=>{
  const companyId=randomUUID(),otherCompanyId=randomUUID(),locationId=randomUUID(),otherLocationId=randomUUID(),foreignLocationId=randomUUID(),actorId=randomUUID(),supplierId=randomUUID();
  for(const c of [companyId,otherCompanyId])await query("insert into companies(id,slug,name) values($1,$2,'Identity fixtures')",[c,c]);
  for(const [l,c] of [[locationId,companyId],[otherLocationId,companyId],[foreignLocationId,otherCompanyId]])await query("insert into locations(id,company_id,name) values($1,$2,$3)",[l,c,l]);
  await query("insert into user_profiles(id,display_name) values($1,'Office')",[actorId]);
  await query("insert into inventory_suppliers(id,company_id,name) values($1,$2,'Supplier')",[supplierId,companyId]);
  const context={actor:{id:actorId,role:'office'},companyIds:new Set([companyId]),locationIds:new Set([locationId])};
  const orders=[randomUUID(),randomUUID()];
  for(const order of orders)await query("insert into inventory_purchase_orders(id,company_id,location_id,supplier_id,created_by,number,currency,status) values($1,$2,$3,$4,$5,$6,'USD','received')",[order,companyId,locationId,supplierId,actorId,order]);
  const bytes=Buffer.from('%PDF-1.4\nShared exact identity\n%%EOF'),hash=createHash('sha256').update(bytes).digest('hex');
  const input={fileName:'source.pdf',mimeType:'application/pdf',dataUrl:`data:application/pdf;base64,${bytes.toString('base64')}`};
  const uploaded=await Promise.all(orders.map(orderId=>uploadPurchaseBill({...input,orderId,idempotencyKey:randomUUID()},context)));
  assert.notEqual(uploaded[0].document.id,uploaded[1].document.id);
  assert.equal(uploaded[0].document.invoiceRunId,uploaded[1].document.invoiceRunId);
  assert.equal((await query('select count(*)::int count from invoice_extraction_runs where company_id=$1',[companyId])).rows[0].count,1);
  async function runFixture(c,l,mime='application/pdf',documentHash=hash) {
    const runId=randomUUID();
    await createInvoiceExtractionRun({runId,companyId:c,locationId:l,actorId,documentHash,fileName:`${runId}.pdf`,mimeType:mime,byteSize:bytes.length,idempotencyKey:randomUUID(),provider:'hybrid_local_first',model:'test',promptVersion:'invoice-v1',source:encryptInvoiceDocument(bytes,{companyId:c,runId,documentHash,mimeType:mime}),retentionUntil:new Date(Date.now()+86400000).toISOString(),enqueueJob:true});
    return runId;
  }
  const excludedIds=[await runFixture(companyId,otherLocationId),await runFixture(otherCompanyId,foreignLocationId),await runFixture(companyId,locationId,'image/png')];
  assert.equal((await listPurchaseBills(orders[0],context)).items[0].invoiceRunId,uploaded[0].document.invoiceRunId);
  const genericId=await runFixture(companyId,locationId,'application/pdf','a'.repeat(64));
  const partId=randomUUID(),lineId=randomUUID();
  await query("insert into parts_catalog(id,company_id,normalized_part_number,part_number,description,uom_code,tracking_mode) values($1,$2,'BILLTEST','BILL-TEST','Bill fixture','ea','quantity')",[partId,companyId]);
  await query("insert into inventory_purchase_lines(id,company_id,order_id,catalog_part_id,part_number,description,uom_code,quantity) values($1,$2,$3,$4,'BILL-TEST','Bill fixture','ea',2)",[lineId,companyId,orders[0],partId]);
  for(const [run,index,status] of [[genericId,0,'planned'],[uploaded[0].document.invoiceRunId,0,'planned'],[genericId,1,'released']])await query("insert into inventory_purchase_invoice_allocations(company_id,invoice_run_id,invoice_line_index,purchase_line_id,quantity,status,request_hash,created_by) values($1,$2,$3,$4,1,$5,$6,$7)",[companyId,run,index,lineId,status,'b'.repeat(64),actorId]);
  assert.deepEqual(new Set((await listPurchaseBills(orders[0],context)).linkedInvoices.map(row=>row.invoiceRunId)),new Set([genericId,uploaded[0].document.invoiceRunId]));
  assert.deepEqual((await listPurchaseBills(orders[1],context)).linkedInvoices,[]);
  const oldRunId=uploaded[0].document.invoiceRunId;
  const latestId=await runFixture(companyId,locationId);
  const genericLatestId=await runFixture(companyId,locationId,'application/pdf','a'.repeat(64));
  await query("update invoice_extraction_runs set status='reviewed',reviewed_by=$2,reviewed_at=now(),reviewed_draft='{}'::jsonb where id=any($1::uuid[])",[[oldRunId,genericId],actorId]);
  await query("update invoice_extraction_runs set status='failed' where id=any($1::uuid[])",[[latestId,genericLatestId]]);
  // Multiple allocations of the same exact source resolve to one latest choice.
  await query("insert into inventory_purchase_invoice_allocations(company_id,invoice_run_id,invoice_line_index,purchase_line_id,quantity,status,request_hash,created_by) values($1,$2,0,$3,1,'planned',$4,$5)",[companyId,latestId,lineId,'c'.repeat(64),actorId]);
  const deliveryId=randomUUID();
  await query("insert into inventory_purchase_deliveries(id,company_id,order_id,invoice_run_id,location_id,received_by,idempotency_key,request_hash) values($1,$2,$3,$4,$5,$6,$7,$8)",[deliveryId,companyId,orders[0],oldRunId,locationId,actorId,randomUUID(),'d'.repeat(64)]);
  const {readInbound}=await import('../../db/repositories/inventory-inbound.repo.js');
  assert.equal((await readInbound({id:deliveryId,companyIds:[companyId],locationIds:[locationId]})).selectedDelivery.invoiceRunId,oldRunId);
  const refreshed=await listPurchaseBills(orders[0],context);
  assert.equal(refreshed.items[0].invoiceRunId,latestId);
  assert.deepEqual(refreshed.items[0].sourceRunIds,[latestId,oldRunId]);
  assert.equal(refreshed.items[0].extractionStatus,'failed');
  assert.equal(refreshed.linkedInvoices.length,2);
  const linked=refreshed.linkedInvoices.find(row=>row.invoiceRunId===latestId);
  assert.deepEqual(linked.sourceRunIds,[latestId,oldRunId]);
  assert.equal(linked.status,'failed');
  const genericLinked=refreshed.linkedInvoices.find(row=>row.invoiceRunId===genericLatestId);
  assert.deepEqual(genericLinked.sourceRunIds,[genericLatestId,genericId]);
  assert.equal(genericLinked.status,'failed');
  assert.ok(refreshed.linkedInvoices.every(row=>excludedIds.every(id=>!row.sourceRunIds.includes(id))));
  assert.equal((await query('select invoice_run_id from inventory_purchase_invoice_allocations where company_id=$1 and invoice_run_id=$2',[companyId,oldRunId])).rows[0].invoice_run_id,oldRunId);

  const {handleInventoryApi}=await import('./inventory.routes.js');
  async function post(scope,order=orders[0],document=uploaded[0].document.id) {
    let response;
    await handleInventoryApi({method:'POST'},{},new URL(`http://localhost/api/office/inventory/purchasing/${order}/bills/${document}/extract`),{requestContext:scope,sendJson(_res,status,body){response={status,body};}});
    return response;
  }
  assert.equal((await post(context)).status,200);
  assert.equal((await post({...context,locationIds:new Set()})).status,404);
  assert.equal((await post({...context,companyIds:new Set([otherCompanyId])})).status,404);
  assert.equal((await post(context,orders[0],uploaded[1].document.id)).status,404);
  assert.equal((await post(context,'invalid')).status,400);
});
