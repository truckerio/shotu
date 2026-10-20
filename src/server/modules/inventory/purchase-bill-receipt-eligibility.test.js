import assert from 'node:assert/strict';
import { randomUUID,createHash } from 'node:crypto';
import { after,test } from 'node:test';
import { query,closePool } from '../../db/pool.js';
import { uploadPurchaseBill } from './purchase-order-bills.service.js';
import { createInvoiceExtractionRun,getInvoiceExtractionRun,publicInvoiceExtractionRun } from '../../db/repositories/invoice-extractions.repo.js';
import { loadReviewedInvoiceForReceipt } from '../../db/repositories/inventory-receipts.repo.js';
import { postLocalInventoryReceipt } from '../../db/repositories/local-inventory.repo.js';
import { confirmReviewedInvoiceFullDelivery } from './local-inventory.service.js';
import { encryptInvoiceDocument } from '../invoice-extraction/invoice-document.crypto.js';
const enabled=process.env.RUN_DIRECT_RECEIPT_INTEGRATION==='1';
after(async()=>{if(enabled)await closePool();});

test('PO ingestion purpose protects original and re-extractions while ordinary reused sources remain receivable',{skip:!enabled},async()=>{
  const companyId=randomUUID(),otherCompanyId=randomUUID(),locationId=randomUUID(),otherLocationId=randomUUID(),foreignLocationId=randomUUID(),actorId=randomUUID(),supplierId=randomUUID(),orderId=randomUUID(),partId=randomUUID();
  for(const c of [companyId,otherCompanyId])await query("insert into companies(id,slug,name) values($1,$2,'Bill purpose')",[c,c]);
  for(const [l,c] of [[locationId,companyId],[otherLocationId,companyId],[foreignLocationId,otherCompanyId]])await query('insert into locations(id,company_id,name) values($1,$2,$3)',[l,c,l]);
  await query("insert into user_profiles(id,display_name) values($1,'Office')",[actorId]);
  await query("insert into inventory_suppliers(id,company_id,name) values($1,$2,'Supplier')",[supplierId,companyId]);
  await query("insert into inventory_purchase_orders(id,company_id,location_id,supplier_id,created_by,number,currency,status) values($1,$2,$3,$4,$5,'PURPOSE-PO','USD','received')",[orderId,companyId,locationId,supplierId,actorId]);
  await query("insert into parts_catalog(id,company_id,normalized_part_number,part_number,description,uom_code,tracking_mode) values($1,$2,'BILLPURPOSE','BILL-PURPOSE','Part','ea','quantity')",[partId,companyId]);
  const e=value=>({value,confidence:100,evidence:'Printed'});
  const draft={documentType:e('invoice'),vendorName:e('Supplier'),vendorAccount:e(''),invoiceNumber:e('BILL-1'),invoiceDate:e('2026-10-19'),purchaseOrderNumber:e(''),currency:e('USD'),subtotal:e(10),tax:e(0),shipping:e(0),total:e(10),lines:[{id:'line-1',catalogPartId:partId,partNumber:e('BILL-PURPOSE'),description:e('Part'),quantity:e(1),unitOfMeasure:e('ea'),unitPrice:e(10),lineTotal:e(10)}],warnings:[]};
  const context={actor:{id:actorId,role:'office'},companyIds:new Set([companyId]),locationIds:new Set([locationId])};
  const bytes=Buffer.from('%PDF-1.4\nPO source purpose\n%%EOF');
  const input={orderId,idempotencyKey:randomUUID(),fileName:'bill.pdf',mimeType:'application/pdf',dataUrl:`data:application/pdf;base64,${bytes.toString('base64')}`};
  const uploaded=await uploadPurchaseBill(input,context),originalId=uploaded.document.invoiceRunId;
  async function createRun({c=companyId,l=locationId,mime='application/pdf',data=bytes}={}) {
    const runId=randomUUID(),documentHash=createHash('sha256').update(data).digest('hex');
    await createInvoiceExtractionRun({runId,companyId:c,locationId:l,actorId,documentHash,fileName:'invoice.pdf',mimeType:mime,byteSize:data.length,idempotencyKey:randomUUID(),provider:'test',model:'test',promptVersion:'invoice-v1',source:encryptInvoiceDocument(data,{companyId:c,runId,documentHash,mimeType:mime}),retentionUntil:new Date(Date.now()+86400000).toISOString()});
    return runId;
  }
  const reextractId=await createRun();
  for(const id of [originalId,reextractId]) {
    const run=await getInvoiceExtractionRun({runId:id,companyIds:[companyId]});
    assert.equal(publicInvoiceExtractionRun(run).sourcePurpose,'purchase_order_bill');
    await query("update invoice_extraction_runs set status='reviewed',reviewed_draft=$2,reviewed_by=$3,reviewed_at=now() where id=$1",[id,JSON.stringify(draft),actorId]);
    assert.equal((await loadReviewedInvoiceForReceipt({runId:id,companyIds:[companyId]})).is_purchase_order_bill,true);
    const direct=await postLocalInventoryReceipt({runId:id,receiptId:randomUUID(),actorId,companyIds:[companyId],locationIds:[locationId],idempotencyKey:randomUUID(),requestHash:'a'.repeat(64),reviewedRunVersion:1,lines:[]});
    assert.equal(direct.kind,'purchase_bill_receipt_recorded');
    await assert.rejects(confirmReviewedInvoiceFullDelivery(id,{idempotencyKey:randomUUID(),expectedVersion:1,confirmation:'all_received_undamaged',postingRoute:'no_purchase_order',noPurchaseOrderReason:'Bill after receiving purchase order'},context),{code:'PURCHASE_BILL_RECEIPT_ALREADY_RECORDED',statusCode:409});
  }
  const guardedAttempt={runId:originalId,receiptId:randomUUID(),actorId,companyIds:[companyId],locationIds:[locationId],idempotencyKey:randomUUID(),requestHash:'f'.repeat(64),reviewedRunVersion:1,lines:[]};
  assert.equal((await postLocalInventoryReceipt({...guardedAttempt,reviewedRunVersion:2})).kind,'stale');
  assert.equal((await postLocalInventoryReceipt({...guardedAttempt,locationIds:[otherLocationId]})).kind,'not_found');
  for(const table of ['local_inventory_receipts','inventory_items','inventory_stock_movements'])assert.equal((await query(`select count(*)::int count from ${table} where company_id=$1`,[companyId])).rows[0].count,0);
  for(const overrides of [{l:otherLocationId},{c:otherCompanyId,l:foreignLocationId},{mime:'image/png'}]) {
    const id=await createRun(overrides),c=overrides.c||companyId;
    assert.equal(Object.hasOwn(publicInvoiceExtractionRun(await getInvoiceExtractionRun({runId:id,companyIds:[c]})),'sourcePurpose'),false);
    assert.equal((await loadReviewedInvoiceForReceipt({runId:id,companyIds:[c]})).is_purchase_order_bill,false);
  }
  // An ordinary invoice reused by a later PO upload has no ingestion-origin run.
  const ordinaryBytes=Buffer.from('%PDF-1.4\nOrdinary existing invoice\n%%EOF');
  const ordinaryId=await createRun({data:ordinaryBytes});
  const reuse=await uploadPurchaseBill({...input,idempotencyKey:randomUUID(),dataUrl:`data:application/pdf;base64,${ordinaryBytes.toString('base64')}`},context);
  assert.equal(reuse.document.invoiceRunId,ordinaryId);
  assert.notEqual(reuse.document.id,ordinaryId);
  assert.equal(Object.hasOwn(publicInvoiceExtractionRun(await getInvoiceExtractionRun({runId:ordinaryId,companyIds:[companyId]})),'sourcePurpose'),false);
  await query("update invoice_extraction_runs set status='reviewed',reviewed_draft=$2,reviewed_by=$3,reviewed_at=now() where id=$1",[ordinaryId,JSON.stringify(draft),actorId]);
  const command={idempotencyKey:randomUUID(),expectedVersion:1,confirmation:'all_received_undamaged',postingRoute:'no_purchase_order',noPurchaseOrderReason:'Ordinary invoice receipt'};
  const receipt=await confirmReviewedInvoiceFullDelivery(ordinaryId,command,context);
  assert.equal(receipt.replayed,false);
  assert.equal((await confirmReviewedInvoiceFullDelivery(ordinaryId,command,context)).replayed,true);
  // A matching-looking key alone cannot turn an ordinary reused run into PO ingestion.
  await query("update invoice_extraction_runs set idempotency_key=$2 where id=$1",[ordinaryId,`po-bill:${reuse.document.id}`]);
  // Purpose requires origin.id === bill.id too, so ordinary reuse still stays ordinary.
  assert.equal(Object.hasOwn(publicInvoiceExtractionRun(await getInvoiceExtractionRun({runId:ordinaryId,companyIds:[companyId]})),'sourcePurpose'),false);
  const recoveryId=randomUUID(),recoveryKey=randomUUID();
  await query("insert into inventory_receipts(id,company_id,location_id,invoice_run_id,created_by,idempotency_key,provider,provider_marker,status,confirmed_at) values($1,$2,$3,$4,$5,$6,'local',$7,'confirmed',now())",[recoveryId,companyId,locationId,originalId,actorId,recoveryKey,`LOCAL-REC-${recoveryId}`]);
  await query("insert into local_inventory_receipts(id,company_id,location_id,invoice_run_id,created_by,idempotency_key,request_hash,line_count,total_quantity,reviewed_run_version,physical_confirmation,confirmation_hash,posting_route,no_purchase_order_reason) values($1,$2,$3,$4,$5,$6,$7,1,1,1,'all_received_undamaged',$7,'no_purchase_order','Historical recovery')",[recoveryId,companyId,locationId,originalId,actorId,recoveryKey,'e'.repeat(64)]);
  const recovered=await postLocalInventoryReceipt({runId:originalId,receiptId:randomUUID(),actorId,companyIds:[companyId],locationIds:[locationId],idempotencyKey:recoveryKey,requestHash:'e'.repeat(64),reviewedRunVersion:1,lines:[]});
  assert.equal(recovered.kind,'replay');assert.equal(recovered.receipt.id,recoveryId);
});
