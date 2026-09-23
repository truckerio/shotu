import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { closePool, query } from "../../db/pool.js";
import { suggestPurchaseInvoiceAllocations } from "../../db/repositories/inventory-purchase-invoice-allocation.repo.js";
import { receiveDirectInventory } from "./direct-inventory-receipt.service.js";
import { confirmReviewedInvoiceFullDelivery } from "./local-inventory.service.js";

const enabled = process.env.RUN_POSTGRES_INTEGRATION === "1";
after(async () => { if (enabled) await closePool(); });

test("PO suggestions and invoice allocation are scoped, atomic, idempotent, and race-safe", { skip: !enabled }, async () => {
  const companyId=randomUUID(), locationId=randomUUID(), otherLocationId=randomUUID(), actorId=randomUUID();
  const supplierId=randomUUID(), partId=randomUUID(), orderId=randomUUID(), lineId=randomUUID(), runId=randomUUID();
  const suffix=randomUUID().replaceAll("-", "");
  const draft=(po, vendor="Exact Vendor", quantity=1, uom="ea")=>({documentType:{value:"invoice",confidence:100,evidence:""},vendorName:{value:vendor,confidence:100,evidence:""},vendorAccount:{value:"",confidence:100,evidence:""},invoiceNumber:{value:`INV-${suffix}`,confidence:100,evidence:""},invoiceDate:{value:"2026-09-17",confidence:100,evidence:""},purchaseOrderNumber:{value:po,confidence:100,evidence:""},currency:{value:"USD",confidence:100,evidence:""},subtotal:{value:10,confidence:100,evidence:""},tax:{value:0,confidence:100,evidence:""},shipping:{value:0,confidence:100,evidence:""},total:{value:10,confidence:100,evidence:""},lines:[{id:"line-1",catalogPartId:partId,partNumber:{value:"PHASE2-FILTER",confidence:100,evidence:""},description:{value:"Filter",confidence:100,evidence:""},quantity:{value:quantity,confidence:100,evidence:""},unitOfMeasure:{value:uom,confidence:100,evidence:""},unitPrice:{value:10,confidence:100,evidence:""},lineTotal:{value:10,confidence:100,evidence:""}}],warnings:[]});
  const context={actor:{id:actorId,role:"office"},companyIds:new Set([companyId]),locationIds:new Set([locationId])};
  const hash=(value)=>createHash("sha256").update(value).digest("hex");
  try {
    await query("insert into companies(id,slug,name) values($1,$2,'Phase 2 allocation')",[companyId,`phase2-${suffix}`]);
    await query("insert into locations(id,company_id,name) values($1,$2,'Phase 2 shop'),($3,$2,'Other shop')",[locationId,companyId,otherLocationId]);
    await query("insert into user_profiles(id,display_name) values($1,'Phase 2 actor')",[actorId]);
    await query("insert into inventory_suppliers(id,company_id,name) values($1,$2,'Exact Vendor')",[supplierId,companyId]);
    await query("insert into parts_catalog(id,company_id,part_number,normalized_part_number,description,uom_code,tracking_mode) values($1,$2,'PHASE2-FILTER','PHASE2FILTER','Filter','ea','quantity')",[partId,companyId]);
    await query("insert into inventory_purchase_orders(id,company_id,location_id,supplier_id,created_by,number,currency,status) values($1,$2,$3,$4,$5,'PO-PHASE2','USD','ordered')",[orderId,companyId,locationId,supplierId,actorId]);
    await query("insert into inventory_purchase_lines(id,company_id,order_id,catalog_part_id,part_number,description,uom_code,quantity,tracking_mode) values($1,$2,$3,$4,'PHASE2-FILTER','Filter','ea',2,'quantity')",[lineId,companyId,orderId,partId]);
    await query(`insert into invoice_extraction_runs(id,company_id,location_id,created_by,reviewed_by,document_hash,file_name,mime_type,byte_size,idempotency_key,status,provider,model,prompt_version,reviewed_draft,reviewed_at)
      values($1,$2,$3,$4,$4,$5,'phase2.pdf','application/pdf',1,$6,'reviewed','test','test','test',$7::jsonb,now())`,[runId,companyId,locationId,actorId,hash(suffix),`phase2-${suffix}`,JSON.stringify(draft("PO-PHASE2"))]);
    const suggestion=await suggestPurchaseInvoiceAllocations({runId,companyIds:[companyId],locationIds:[locationId],isAdmin:false});
    assert.equal(suggestion.kind,"suggestions"); assert.equal(suggestion.candidates[0].purchaseLineId,lineId);
    const coreDraft=draft("PO-PHASE2");
    coreDraft.lines.push(
      {id:"core-charge",partNumber:{value:"CORE-1",confidence:100,evidence:""},description:{value:"Core charge",confidence:100,evidence:""},quantity:{value:1,confidence:100,evidence:""},unitOfMeasure:{value:"ea",confidence:100,evidence:""},unitPrice:{value:1995,confidence:100,evidence:""},lineTotal:{value:1995,confidence:100,evidence:""}},
      {id:"core-credit",partNumber:{value:"CORE-1",confidence:100,evidence:""},description:{value:"Core return",confidence:100,evidence:""},quantity:{value:-1,confidence:100,evidence:""},unitOfMeasure:{value:"ea",confidence:100,evidence:""},unitPrice:{value:1995,confidence:100,evidence:""},lineTotal:{value:-1995,confidence:100,evidence:""}},
    );
    await query("update invoice_extraction_runs set reviewed_draft=$2::jsonb where id=$1",[runId,JSON.stringify(coreDraft)]);
    const coreSuggestion=await suggestPurchaseInvoiceAllocations({runId,companyIds:[companyId],locationIds:[locationId],isAdmin:false});
    assert.equal(coreSuggestion.kind,"suggestions");
    assert.deepEqual(coreSuggestion.candidates.map((entry)=>entry.invoiceLineIndex),[0]);
    assert.deepEqual(coreSuggestion.receiptLines.map((entry)=>entry.inventoryDisposition),["stock","financial_offset","financial_offset"]);
    assert.deepEqual(coreSuggestion.receiptLines.map((entry)=>entry.invoiceOutstandingQuantity),[1,0,0]);
    await query("update invoice_extraction_runs set reviewed_draft=$2::jsonb where id=$1",[runId,JSON.stringify(draft("PO-PHASE2"))]);
    const wrongLocation=await suggestPurchaseInvoiceAllocations({runId,companyIds:[companyId],locationIds:[otherLocationId],isAdmin:false}); assert.equal(wrongLocation.kind,"not_found");
    await query("update parts_catalog set tracking_mode='serialized' where id=$1",[partId]);
    await query("update invoice_extraction_runs set reviewed_draft=jsonb_set(reviewed_draft,'{vendorName,value}','\"Wrong Vendor\"') where id=$1",[runId]);
    const wrongVendor=await suggestPurchaseInvoiceAllocations({runId,companyIds:[companyId],locationIds:[locationId],isAdmin:false});
    assert.equal(wrongVendor.kind,"none"); assert.equal(wrongVendor.reason,"no_exact_match"); assert.equal(wrongVendor.receiptLines[0].trackingMode,"serialized");
    await query("update invoice_extraction_runs set reviewed_draft=$2::jsonb where id=$1",[runId,JSON.stringify(draft("PO-PHASE2","Exact Vendor",1,"box"))]);
    const noLineMatch=await suggestPurchaseInvoiceAllocations({runId,companyIds:[companyId],locationIds:[locationId],isAdmin:false});
    assert.equal(noLineMatch.kind,"none"); assert.equal(noLineMatch.reason,"no_line_match"); assert.equal(noLineMatch.receiptLines[0].trackingMode,"serialized");
    const secondLineId=randomUUID();
    await query("insert into inventory_purchase_lines(id,company_id,order_id,catalog_part_id,part_number,description,uom_code,quantity,tracking_mode) values($1,$2,$3,$4,'PHASE2-FILTER','Filter','ea',1,'serialized')",[secondLineId,companyId,orderId,partId]);
    await query("update invoice_extraction_runs set reviewed_draft=$2::jsonb where id=$1",[runId,JSON.stringify(draft("PO-PHASE2"))]);
    const ambiguous=await suggestPurchaseInvoiceAllocations({runId,companyIds:[companyId],locationIds:[locationId],isAdmin:false});
    assert.equal(ambiguous.kind,"ambiguous"); assert.equal(ambiguous.receiptLines[0].trackingMode,"serialized");
    await query("delete from inventory_purchase_lines where id=$1",[secondLineId]);
    await query("update parts_catalog set tracking_mode='quantity' where id=$1",[partId]);
    const receiptInput={postingRoute:"purchase_order",allocationPlan:[{invoiceLineIndex:0,purchaseLineId:lineId,quantity:1}],noPurchaseOrderReason:"",expectedVersion:1,idempotencyKey:`phase2-post-${suffix}`,confirmation:"all_received_undamaged"};
    await query("update inventory_suppliers set name='Changed Vendor' where id=$1",[supplierId]);
    await assert.rejects(confirmReviewedInvoiceFullDelivery(runId,receiptInput,context),{code:"INVENTORY_PURCHASE_RECEIPT_CONFLICT"});
    await query("update inventory_suppliers set name='Exact Vendor' where id=$1",[supplierId]);
    const posted=await confirmReviewedInvoiceFullDelivery(runId,receiptInput,context); assert.equal(posted.replayed,false);
    const replay=await confirmReviewedInvoiceFullDelivery(runId,receiptInput,context); assert.equal(replay.replayed,true);
    await assert.rejects(
      query("delete from inventory_purchase_invoice_allocations where company_id=$1",[companyId]),
      { code:"55000" },
    );
    assert.equal((await query("select received_quantity from inventory_purchase_lines where id=$1",[lineId])).rows[0].received_quantity,"1.000");
    await assert.rejects(confirmReviewedInvoiceFullDelivery(runId,{...receiptInput,allocationPlan:[],idempotencyKey:`phase2-conflict-${suffix}`},context),{code:"PURCHASE_INVOICE_ALLOCATION_REQUIRED"});
    const raceRun=randomUUID();
    await query(`insert into invoice_extraction_runs(id,company_id,location_id,created_by,reviewed_by,document_hash,file_name,mime_type,byte_size,idempotency_key,status,provider,model,prompt_version,reviewed_draft,reviewed_at) values($1,$2,$3,$4,$4,$5,'race.pdf','application/pdf',1,$6,'reviewed','test','test','test',$7::jsonb,now())`,[raceRun,companyId,locationId,actorId,hash(`race-${suffix}`),`race-${suffix}`,JSON.stringify(draft("PO-PHASE2"))]);
    const invoiceRace=confirmReviewedInvoiceFullDelivery(raceRun,{...receiptInput,idempotencyKey:`race-invoice-${suffix}`},context).then(()=>"invoice").catch((error)=>`${error.code || "error"}:${error.message}`);
    const directRace=receiveDirectInventory({locationId,catalogPartId:partId,expectedPartVersion:1,trackingMode:"quantity",uomCode:"ea",quantity:1,purchaseLineId:lineId,idempotencyKey:randomUUID(),confirmation:"new_company_stock_received"},context).then(()=>"direct").catch((error)=>`${error.code || "error"}:${error.message}`);
    const race=await Promise.all([invoiceRace,directRace]); assert.equal(race.filter((value)=>value === "invoice" || value === "direct").length,1); assert.equal(race.filter((value)=>value.includes("CONFLICT")).length,1);
    const noPoRun=randomUUID();
    await query(`insert into invoice_extraction_runs(id,company_id,location_id,created_by,reviewed_by,document_hash,file_name,mime_type,byte_size,idempotency_key,status,provider,model,prompt_version,reviewed_draft,reviewed_at) values($1,$2,$3,$4,$4,$5,'no-po.pdf','application/pdf',1,$6,'reviewed','test','test','test',$7::jsonb,now())`,[noPoRun,companyId,locationId,actorId,hash(`no-${suffix}`),`no-po-${suffix}`,JSON.stringify(draft("", "Exact Vendor"))]);
    const noPo=await confirmReviewedInvoiceFullDelivery(noPoRun,{postingRoute:"no_purchase_order",noPurchaseOrderReason:"Supplier invoice had no purchase order.",expectedVersion:1,idempotencyKey:`no-po-post-${suffix}`,confirmation:"all_received_undamaged"},context); assert.equal(noPo.replayed,false);
  } finally {
    await query("delete from inventory_purchase_delivery_lines where company_id=$1",[companyId]).catch(()=>{});
    await query("delete from inventory_purchase_deliveries where company_id=$1",[companyId]).catch(()=>{});
    await query(`with teardown as materialized (
      select set_config('app.allow_inventory_evidence_teardown','on',true)
    ) delete from inventory_purchase_invoice_allocations using teardown
      where company_id=$1`,[companyId]).catch(()=>{});
    await query("delete from inventory_purchase_receipt_allocations where company_id=$1",[companyId]).catch(()=>{});
    await query("delete from inventory_authority_cutovers where company_id=$1",[companyId]).catch(()=>{});
    await query("delete from inventory_authority_exceptions where company_id=$1",[companyId]).catch(()=>{});
    await query("delete from inventory_stock_movements where company_id=$1",[companyId]).catch(()=>{});
    await query("delete from inventory_position_movements where company_id=$1",[companyId]).catch(()=>{});
    await query("delete from inventory_position_operations where company_id=$1",[companyId]).catch(()=>{});
    await query("delete from inventory_position_balances where company_id=$1",[companyId]).catch(()=>{});
    await query("delete from inventory_positions where company_id=$1",[companyId]).catch(()=>{});
    await query("delete from inventory_receipt_lines where company_id=$1",[companyId]).catch(()=>{});
    await query("delete from local_inventory_receipt_lines where company_id=$1",[companyId]).catch(()=>{});
    await query("delete from inventory_items where company_id=$1",[companyId]).catch(()=>{});
    await query("delete from local_inventory_receipts where company_id=$1",[companyId]).catch(()=>{});
    await query("delete from inventory_receipts where company_id=$1",[companyId]).catch(()=>{});
    await query("delete from invoice_extraction_runs where company_id=$1",[companyId]).catch(()=>{});
    await query("delete from inventory_purchase_events where company_id=$1",[companyId]).catch(()=>{});
    await query("delete from inventory_workflow_commands where company_id=$1",[companyId]).catch(()=>{});
    await query("delete from inventory_purchase_lines where company_id=$1",[companyId]).catch(()=>{});
    await query("delete from inventory_purchase_orders where company_id=$1",[companyId]).catch(()=>{});
    await query("delete from inventory_suppliers where company_id=$1",[companyId]).catch(()=>{});
    await query("delete from parts_catalog where company_id=$1",[companyId]).catch(()=>{});
    await query("delete from locations where company_id=$1",[companyId]).catch(()=>{});
    await query("delete from companies where id=$1",[companyId]).catch(()=>{});
    await query("delete from user_profiles where id=$1",[actorId]).catch(()=>{});
  }
});
