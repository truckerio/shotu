import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { closePool, query } from "../../db/pool.js";
import { suggestPurchaseInvoiceAllocations } from "../../db/repositories/inventory-purchase-invoice-allocation.repo.js";
import { confirmReviewedInvoiceFullDelivery } from "./local-inventory.service.js";
import { receivePurchaseOrder, savePurchase } from "./inventory-purchasing.service.js";

const enabled = process.env.RUN_POSTGRES_INTEGRATION === "1";
after(async () => { if (enabled) await closePool(); });

test("serialized PO receipt keeps held identity unavailable and labels only serialized units", { skip: !enabled }, async () => {
  const companyId=randomUUID(),locationId=randomUUID(),otherLocationId=randomUUID(),actorId=randomUUID(),supplierId=randomUUID(),partId=randomUUID(),orderId=randomUUID(),lineId=randomUUID(),targetPositionId=randomUUID();
  const quantityPartId=randomUUID(),invoiceRunId=randomUUID(),shortOrderId=randomUUID(),shortLineId=randomUUID();
  const bulkPartId=randomUUID(),bulkOrderId=randomUUID(),bulkExactLineId=randomUUID(),bulkReceivingLineId=randomUUID(),bulkUnknownLineId=randomUUID();
  const raceOrderId=randomUUID(),raceLineId=randomUUID(),invoiceSerialRunId=randomUUID(),duplicateInvoiceRunId=randomUUID();
  const suffix=randomUUID().replaceAll("-","");
  const context={actor:{id:actorId,role:"office"},companyIds:new Set([companyId]),locationIds:new Set([locationId])};
  const input={locationId,expectedVersion:1,idempotencyKey:`phase3-${suffix}`,reference:"PACK-1",lines:[{
    purchaseLineId:lineId,acceptedQuantity:1,heldQuantity:1,rejectedQuantity:0,notReceivedQuantity:0,
    targetPositionId,outcome:"damaged",notes:"Housing cracked",holdLocation:"Quarantine A",serialNumbers:["SER-OK","SER-HOLD"],
  }]};
  try {
    await query("insert into companies(id,slug,name) values($1,$2,'Phase 3 receipt')",[companyId,`phase3-${suffix}`]);
    await query("insert into locations(id,company_id,name) values($1,$2,'Phase 3 shop'),($3,$2,'Other shop')",[locationId,companyId,otherLocationId]);
    await query("insert into user_profiles(id,display_name) values($1,'Phase 3 receiver')",[actorId]);
    await query("insert into inventory_suppliers(id,company_id,name) values($1,$2,'Phase 3 supplier')",[supplierId,companyId]);
    await query("insert into parts_catalog(id,company_id,part_number,normalized_part_number,description,uom_code,tracking_mode) values($1,$2,'P3-SERIAL','P3SERIAL','Serialized assembly','ea','serialized')",[partId,companyId]);
    await query("insert into inventory_positions(id,company_id,location_id,code,name,kind,usage,can_store,is_pickable,created_by) values($1,$2,$3,'PUT-A-01','Put-away A-01','bin','storage',true,true,$4)",[targetPositionId,companyId,locationId,actorId]);
    await query("insert into inventory_purchase_orders(id,company_id,location_id,supplier_id,created_by,number,currency,status) values($1,$2,$3,$4,$5,$6,'USD','ordered')",[orderId,companyId,locationId,supplierId,actorId,`PO-${suffix.slice(0,8)}`]);
    await query("insert into inventory_purchase_lines(id,company_id,order_id,catalog_part_id,part_number,description,uom_code,quantity,unit_price,tracking_mode) values($1,$2,$3,$4,'P3-SERIAL','Serialized assembly','ea',3,25,'serialized')",[lineId,companyId,orderId,partId]);
    await assert.rejects(query(`insert into inventory_purchase_deliveries
      (company_id,order_id,location_id,received_by,idempotency_key,request_hash)
      values($1,$2,$3,$4,$5,$6)`,[companyId,orderId,otherLocationId,actorId,`wrong-location-${suffix}`,"a".repeat(64)]),{code:"23514"});
    const options={qrOptions:{signingKey:Buffer.alloc(32,7).toString("base64")}};
    const beforeInvalid=(await query(`select
      (select count(*)::int from local_inventory_receipts where company_id=$1) receipts,
      (select count(*)::int from inventory_stock_movements where company_id=$1) movements,
      (select count(*)::int from inventory_position_movements where company_id=$1) position_movements`,[companyId])).rows[0];
    await assert.rejects(receivePurchaseOrder(orderId,{...input,idempotencyKey:`invalid-target-${suffix}`,lines:[{...input.lines[0],targetPositionId:randomUUID()}]},context,options),(error)=>error.code==="INVENTORY_RECEIPT_POSITION_INVALID"&&error.statusCode===422);
    const afterInvalid=(await query(`select
      (select count(*)::int from local_inventory_receipts where company_id=$1) receipts,
      (select count(*)::int from inventory_stock_movements where company_id=$1) movements,
      (select count(*)::int from inventory_position_movements where company_id=$1) position_movements`,[companyId])).rows[0];
    assert.deepEqual(afterInvalid,beforeInvalid);
    const posted=await receivePurchaseOrder(orderId,input,context,options);
    const replay=await receivePurchaseOrder(orderId,input,context,options);
    assert.equal(replay.replayed,true);
    assert.equal(replay.receipt.id,posted.receipt.id);
    const units=(await query("select serial_number,status from inventory_serialized_units where company_id=$1 order by serial_number",[companyId])).rows;
    assert.deepEqual(units,[{serial_number:"SER-HOLD",status:"held"},{serial_number:"SER-OK",status:"in_stock"}]);
    const positioned=(await query("select unit.serial_number,unit.current_position_id from inventory_serialized_units unit where company_id=$1 order by unit.serial_number",[companyId])).rows;
    assert.deepEqual(positioned,[{serial_number:"SER-HOLD",current_position_id:null},{serial_number:"SER-OK",current_position_id:targetPositionId}]);
    assert.equal(Number((await query("select quantity_on_hand from inventory_items where company_id=$1",[companyId])).rows[0].quantity_on_hand),1);
    assert.equal(Number((await query("select item_count from inventory_label_batches where company_id=$1",[companyId])).rows[0].item_count),2);
    const evidence=(await query("select usable_quantity,held_quantity,outcome from inventory_purchase_delivery_lines where company_id=$1",[companyId])).rows[0];
    assert.equal(Number(evidence.usable_quantity),1);assert.equal(Number(evidence.held_quantity),1);assert.equal(evidence.outcome,"damaged");
    const order=(await query("select status from inventory_purchase_orders where id=$1",[orderId])).rows[0];
    assert.equal(order.status,"partially_received");
    const beforeDuplicatePo=(await query(`select
      (select count(*)::int from local_inventory_receipts where company_id=$1) receipts,
      (select count(*)::int from inventory_serialized_units where company_id=$1) units,
      (select received_quantity from inventory_purchase_lines where company_id=$1 and id=$2) received_quantity`,[companyId,lineId])).rows[0];
    const duplicatePoVersion=Number((await query("select version from inventory_purchase_orders where company_id=$1 and id=$2",[companyId,orderId])).rows[0].version);
    await assert.rejects(receivePurchaseOrder(orderId,{locationId,expectedVersion:duplicatePoVersion,idempotencyKey:`duplicate-po-serial-${suffix}`,reference:"Duplicate serial",lines:[{
      purchaseLineId:lineId,acceptedQuantity:1,heldQuantity:0,rejectedQuantity:0,notReceivedQuantity:0,
      outcome:"accepted",notes:"",holdLocation:"",serialNumbers:["SER-OK"],
    }]},context,options),(error)=>error.code==="INVENTORY_SERIAL_IDENTITY_DUPLICATE"&&error.statusCode===409);
    const afterDuplicatePo=(await query(`select
      (select count(*)::int from local_inventory_receipts where company_id=$1) receipts,
      (select count(*)::int from inventory_serialized_units where company_id=$1) units,
      (select received_quantity from inventory_purchase_lines where company_id=$1 and id=$2) received_quantity`,[companyId,lineId])).rows[0];
    assert.deepEqual(afterDuplicatePo,beforeDuplicatePo);
    const orderVersion=Number((await query("select version from inventory_purchase_orders where id=$1",[orderId])).rows[0].version);
    const shortage=await receivePurchaseOrder(orderId,{locationId,expectedVersion:orderVersion,idempotencyKey:`shortage-${suffix}`,reference:"Carrier shortage",lines:[{
      purchaseLineId:lineId,acceptedQuantity:0,heldQuantity:0,rejectedQuantity:0,notReceivedQuantity:2,
      outcome:"short",notes:"Two units did not arrive",holdLocation:"",serialNumbers:[],
    }]},context);
    assert.equal(shortage.recorded,true);
    assert.equal(shortage.receipt.lines.length,0);
    assert.equal(Number((await query("select count(*)::int count from inventory_purchase_delivery_lines where company_id=$1 and outcome='shortage'",[companyId])).rows[0].count),1);
    assert.equal(Number((await query("select quantity_on_hand from inventory_items where company_id=$1",[companyId])).rows[0].quantity_on_hand),1);
    await query("insert into inventory_purchase_orders(id,company_id,location_id,supplier_id,created_by,number,currency,status) values($1,$2,$3,$4,$5,$6,'USD','ordered')",[shortOrderId,companyId,locationId,supplierId,actorId,`PO-SHORT-${suffix.slice(0,8)}`]);
    await query("insert into inventory_purchase_lines(id,company_id,order_id,catalog_part_id,part_number,description,uom_code,quantity,unit_price,tracking_mode) values($1,$2,$3,$4,'P3-SERIAL','Serialized assembly','ea',2,25,'serialized')",[shortLineId,companyId,shortOrderId,partId]);
    await receivePurchaseOrder(shortOrderId,{locationId,expectedVersion:1,idempotencyKey:`short-only-${suffix}`,reference:"Carrier no-show",lines:[{
      purchaseLineId:shortLineId,acceptedQuantity:0,heldQuantity:0,rejectedQuantity:0,notReceivedQuantity:2,
      outcome:"short",notes:"Shipment did not arrive",holdLocation:"",serialNumbers:[],
    }]},context);
    const closedShort=(await savePurchase({locationId,idempotencyKey:randomUUID(),action:"cancel",orderId:shortOrderId,expectedVersion:2,reason:"Supplier cannot fulfill the order"},context)).order;
    assert.equal(closedShort.status,"closed_with_discrepancy");

    await query("insert into parts_catalog(id,company_id,part_number,normalized_part_number,description,uom_code,tracking_mode) values($1,$2,'P3-COUNT','P3COUNT','Counted part','ea','quantity')",[quantityPartId,companyId]);
    const invoiceDraft={documentType:{value:"invoice",confidence:100,evidence:""},vendorName:{value:"Phase 3 supplier",confidence:100,evidence:""},vendorAccount:{value:"",confidence:100,evidence:""},invoiceNumber:{value:`INV-${suffix}`,confidence:100,evidence:""},invoiceDate:{value:"2026-09-17",confidence:100,evidence:""},purchaseOrderNumber:{value:"",confidence:100,evidence:""},currency:{value:"USD",confidence:100,evidence:""},subtotal:{value:20,confidence:100,evidence:""},tax:{value:0,confidence:100,evidence:""},shipping:{value:0,confidence:100,evidence:""},total:{value:20,confidence:100,evidence:""},lines:[{id:"line-1",catalogPartId:quantityPartId,partNumber:{value:"P3-COUNT",confidence:100,evidence:""},description:{value:"Counted part",confidence:100,evidence:""},quantity:{value:2,confidence:100,evidence:""},unitOfMeasure:{value:"ea",confidence:100,evidence:""},unitPrice:{value:10,confidence:100,evidence:""},lineTotal:{value:20,confidence:100,evidence:""}}],warnings:[]};
    await query(`insert into invoice_extraction_runs(id,company_id,location_id,created_by,reviewed_by,document_hash,file_name,mime_type,byte_size,idempotency_key,status,provider,model,prompt_version,reviewed_draft,reviewed_at)
      values($1,$2,$3,$4,$4,$5,'phase3.pdf','application/pdf',1,$6,'reviewed','test','test','test',$7::jsonb,now())`,[invoiceRunId,companyId,locationId,actorId,suffix.padEnd(64,"0").slice(0,64),`phase3-invoice-${suffix}`,JSON.stringify(invoiceDraft)]);
    const beforePoisonedNoPo=(await query(`select
      (select count(*)::int from local_inventory_receipts where company_id=$1) receipts,
      (select count(*)::int from inventory_purchase_deliveries where company_id=$1) deliveries,
      (select count(*)::int from inventory_purchase_delivery_lines where company_id=$1) delivery_lines`,[companyId])).rows[0];
    await assert.rejects(confirmReviewedInvoiceFullDelivery(invoiceRunId,{expectedVersion:1,idempotencyKey:`invoice-poisoned-no-po-${suffix}`,postingRoute:"no_purchase_order",noPurchaseOrderReason:"Explicitly received without this suggested PO.",receiptLines:[{
      invoiceLineIndex:0,purchaseLineId:lineId,acceptedQuantity:1,heldQuantity:0,rejectedQuantity:0,notReceivedQuantity:0,outcome:"accepted",notes:"",holdLocation:"",serialNumbers:[],
    }]},context),(error)=>error.code==="PURCHASE_INVOICE_ROUTE_CONFLICT"&&error.statusCode===409);
    const afterPoisonedNoPo=(await query(`select
      (select count(*)::int from local_inventory_receipts where company_id=$1) receipts,
      (select count(*)::int from inventory_purchase_deliveries where company_id=$1) deliveries,
      (select count(*)::int from inventory_purchase_delivery_lines where company_id=$1) delivery_lines`,[companyId])).rows[0];
    assert.deepEqual(afterPoisonedNoPo,beforePoisonedNoPo);
    const invoiceReceipt=(key)=>confirmReviewedInvoiceFullDelivery(invoiceRunId,{expectedVersion:1,idempotencyKey:key,postingRoute:"no_purchase_order",noPurchaseOrderReason:"Supplier invoice arrived without a purchase order.",receiptLines:[{invoiceLineIndex:0,acceptedQuantity:1,heldQuantity:0,rejectedQuantity:0,notReceivedQuantity:0,outcome:"accepted",notes:"",holdLocation:"",serialNumbers:[]}]},context);
    const firstEpisode=await invoiceReceipt(`invoice-one-${suffix}`);
    const secondEpisode=await invoiceReceipt(`invoice-two-${suffix}`);
    assert.notEqual(firstEpisode.receipt.id,secondEpisode.receipt.id);
    assert.equal(firstEpisode.receipt.units.length,0);assert.equal(secondEpisode.receipt.units.length,0);
    assert.equal((await query("select count(*)::int count from local_inventory_receipts where company_id=$1 and invoice_run_id=$2",[companyId,invoiceRunId])).rows[0].count,2);
    assert.equal(Number((await query("select quantity_on_hand from inventory_items where company_id=$1 and catalog_part_id=$2",[companyId,quantityPartId])).rows[0].quantity_on_hand),2);
    const remaining=await suggestPurchaseInvoiceAllocations({runId:invoiceRunId,companyIds:[companyId],locationIds:[locationId],isAdmin:false});
    assert.equal(remaining.reason,"no_purchase_order");assert.equal(remaining.receiptLines[0].invoiceOutstandingQuantity,0);

    // Aggregate receipt batches preserve price evidence and reconcile exact/default position totals.
    await query("insert into parts_catalog(id,company_id,part_number,normalized_part_number,description,uom_code,tracking_mode) values($1,$2,'P3-BULK','P3BULK','Measured bulk','gal','measured_bulk')",[bulkPartId,companyId]);
    await query("insert into inventory_purchase_orders(id,company_id,location_id,supplier_id,created_by,number,currency,status) values($1,$2,$3,$4,$5,$6,'CAD','ordered')",[bulkOrderId,companyId,locationId,supplierId,actorId,`PO-BULK-${suffix.slice(0,8)}`]);
    await query(`insert into inventory_purchase_lines(id,company_id,order_id,catalog_part_id,part_number,description,uom_code,quantity,unit_price,tracking_mode) values
      ($1,$2,$3,$4,'P3-BULK','Measured bulk','gal',1.25,12.34,'measured_bulk'),
      ($5,$2,$3,$4,'P3-BULK','Measured bulk','gal',2,0,'measured_bulk'),
      ($6,$2,$3,$4,'P3-BULK','Measured bulk','gal',3,null,'measured_bulk')`,[bulkExactLineId,companyId,bulkOrderId,bulkPartId,bulkReceivingLineId,bulkUnknownLineId]);
    const bulkReceipt=await receivePurchaseOrder(bulkOrderId,{locationId,expectedVersion:1,idempotencyKey:`bulk-${suffix}`,reference:"Bulk delivery",lines:[
      {purchaseLineId:bulkExactLineId,targetPositionId,acceptedQuantity:1.25,heldQuantity:0,rejectedQuantity:0,notReceivedQuantity:0,outcome:"accepted",notes:"",holdLocation:"",serialNumbers:[]},
      {purchaseLineId:bulkReceivingLineId,acceptedQuantity:2,heldQuantity:0,rejectedQuantity:0,notReceivedQuantity:0,outcome:"accepted",notes:"",holdLocation:"",serialNumbers:[]},
      {purchaseLineId:bulkUnknownLineId,acceptedQuantity:3,heldQuantity:0,rejectedQuantity:0,notReceivedQuantity:0,outcome:"accepted",notes:"",holdLocation:"",serialNumbers:[]},
    ]},context);
    assert.equal(bulkReceipt.recorded,true);
    const receivingPositionId=(await query("select id from inventory_positions where company_id=$1 and location_id=$2 and system_key='receiving'",[companyId,locationId])).rows[0].id;
    const bulkPositions=(await query(`select position_id,quantity from inventory_position_balances where company_id=$1 and location_id=$2 and catalog_part_id=$3 order by position_id`,[companyId,locationId,bulkPartId])).rows;
    assert.deepEqual(bulkPositions,[{position_id:targetPositionId,quantity:"1.250"},{position_id:receivingPositionId,quantity:"5.000"}].sort((left,right)=>left.position_id.localeCompare(right.position_id)));
    const bulkOnHand=Number((await query("select quantity_on_hand from inventory_items where company_id=$1 and location_id=$2 and catalog_part_id=$3",[companyId,locationId,bulkPartId])).rows[0].quantity_on_hand);
    assert.equal(bulkOnHand,6.25);
    assert.equal(Number((await query("select coalesce(sum(quantity),0) quantity from inventory_position_balances where company_id=$1 and location_id=$2 and catalog_part_id=$3",[companyId,locationId,bulkPartId])).rows[0].quantity),bulkOnHand);
    const bulkCost=(await query(`select unit_cost,line_total,currency,cost_source from inventory_receipt_lines where company_id=$1 and receipt_id=$2 order by line_index`,[companyId,bulkReceipt.receipt.id])).rows;
    assert.deepEqual(bulkCost,[
      {unit_cost:"12.3400",line_total:"15.43",currency:"CAD",cost_source:"purchase_order"},
      {unit_cost:"0.0000",line_total:"0.00",currency:"CAD",cost_source:"purchase_order"},
      {unit_cost:null,line_total:null,currency:"CAD",cost_source:"unknown"},
    ]);

    // Competing commands for the last PO quantity are serialized by the production row lock.
    await query("insert into inventory_purchase_orders(id,company_id,location_id,supplier_id,created_by,number,currency,status) values($1,$2,$3,$4,$5,$6,'USD','ordered')",[raceOrderId,companyId,locationId,supplierId,actorId,`PO-RACE-${suffix.slice(0,8)}`]);
    await query("insert into inventory_purchase_lines(id,company_id,order_id,catalog_part_id,part_number,description,uom_code,quantity,unit_price,tracking_mode) values($1,$2,$3,$4,'P3-COUNT','Counted part','ea',1,9,'quantity')",[raceLineId,companyId,raceOrderId,quantityPartId]);
    const raceInput=(idempotencyKey)=>receivePurchaseOrder(raceOrderId,{locationId,expectedVersion:1,idempotencyKey,reference:"Race",lines:[{purchaseLineId:raceLineId,acceptedQuantity:1,heldQuantity:0,rejectedQuantity:0,notReceivedQuantity:0,outcome:"accepted",notes:"",holdLocation:"",serialNumbers:[]}]},context);
    const race=await Promise.allSettled([raceInput(`race-a-${suffix}`),raceInput(`race-b-${suffix}`)]);
    assert.equal(race.filter((entry)=>entry.status==="fulfilled").length,1);
    assert.equal(race.filter((entry)=>entry.status==="rejected"&&entry.reason?.code==="INVENTORY_PURCHASE_RECEIPT_CONFLICT").length,1);
    assert.equal(Number((await query("select quantity_on_hand from inventory_items where company_id=$1 and location_id=$2 and catalog_part_id=$3",[companyId,locationId,quantityPartId])).rows[0].quantity_on_hand),3);

    // Invoice receipt batch and its exact unit retain the reviewed invoice source and cost snapshot.
    const serialInvoiceDraft={...invoiceDraft,invoiceNumber:{...invoiceDraft.invoiceNumber,value:`INV-SERIAL-${suffix}`},lines:[{id:"serial-line",catalogPartId:partId,partNumber:{value:"P3-SERIAL",confidence:100,evidence:""},description:{value:"Serialized assembly",confidence:100,evidence:""},quantity:{value:1,confidence:100,evidence:""},unitOfMeasure:{value:"ea",confidence:100,evidence:""},unitPrice:{value:44,confidence:100,evidence:""},lineTotal:{value:44,confidence:100,evidence:""}}],total:{...invoiceDraft.total,value:44}};
    await query(`insert into invoice_extraction_runs(id,company_id,location_id,created_by,reviewed_by,document_hash,file_name,mime_type,byte_size,idempotency_key,status,provider,model,prompt_version,reviewed_draft,reviewed_at)
      values($1,$2,$3,$4,$4,$5,'phase3-serial.pdf','application/pdf',1,$6,'reviewed','test','test','test',$7::jsonb,now())`,[invoiceSerialRunId,companyId,locationId,actorId,randomUUID().replaceAll("-","").padEnd(64,"0").slice(0,64),`phase3-serial-${suffix}`,JSON.stringify(serialInvoiceDraft)]);
    const serialInvoice=await confirmReviewedInvoiceFullDelivery(invoiceSerialRunId,{expectedVersion:1,idempotencyKey:`invoice-serial-${suffix}`,postingRoute:"no_purchase_order",noPurchaseOrderReason:"Supplier invoice without PO",receiptLines:[{invoiceLineIndex:0,acceptedQuantity:1,heldQuantity:0,rejectedQuantity:0,notReceivedQuantity:0,outcome:"accepted",notes:"",holdLocation:"",serialNumbers:["INV-SERIAL-1"]}]},context,{qrOptions:{signingKey:Buffer.alloc(32,7).toString("base64")}});
    const invoiceLineage=(await query(`select receipt.invoice_run_id,line.unit_cost,line.line_total,line.currency,line.cost_source,unit.serial_number
      from inventory_receipts receipt join inventory_receipt_lines line on line.company_id=receipt.company_id and line.receipt_id=receipt.id
      join inventory_serialized_units unit on unit.company_id=line.company_id and unit.receipt_line_id=line.id
      where receipt.company_id=$1 and receipt.id=$2`,[companyId,serialInvoice.receipt.id])).rows[0];
    assert.deepEqual(invoiceLineage,{invoice_run_id:invoiceSerialRunId,unit_cost:"44.0000",line_total:"44.00",currency:"USD",cost_source:"invoice_line",serial_number:"INV-SERIAL-1"});
    await query(`insert into invoice_extraction_runs(id,company_id,location_id,created_by,reviewed_by,document_hash,file_name,mime_type,byte_size,idempotency_key,status,provider,model,prompt_version,reviewed_draft,reviewed_at)
      values($1,$2,$3,$4,$4,$5,'phase3-serial-duplicate.pdf','application/pdf',1,$6,'reviewed','test','test','test',$7::jsonb,now())`,[duplicateInvoiceRunId,companyId,locationId,actorId,randomUUID().replaceAll("-","").padEnd(64,"0").slice(0,64),`phase3-serial-duplicate-${suffix}`,JSON.stringify(serialInvoiceDraft)]);
    const beforeDuplicateInvoice=(await query(`select
      (select count(*)::int from local_inventory_receipts where company_id=$1) receipts,
      (select count(*)::int from inventory_serialized_units where company_id=$1) units,
      (select quantity_on_hand from inventory_items where company_id=$1 and location_id=$2 and catalog_part_id=$3) quantity_on_hand`,[companyId,locationId,partId])).rows[0];
    await assert.rejects(confirmReviewedInvoiceFullDelivery(duplicateInvoiceRunId,{expectedVersion:1,idempotencyKey:`invoice-serial-duplicate-${suffix}`,postingRoute:"no_purchase_order",noPurchaseOrderReason:"Supplier invoice without PO",receiptLines:[{
      invoiceLineIndex:0,acceptedQuantity:1,heldQuantity:0,rejectedQuantity:0,notReceivedQuantity:0,outcome:"accepted",notes:"",holdLocation:"",serialNumbers:["INV-SERIAL-1"],
    }]},context,{qrOptions:{signingKey:Buffer.alloc(32,7).toString("base64")}}),(error)=>error.code==="INVENTORY_SERIAL_IDENTITY_DUPLICATE"&&error.statusCode===409);
    const afterDuplicateInvoice=(await query(`select
      (select count(*)::int from local_inventory_receipts where company_id=$1) receipts,
      (select count(*)::int from inventory_serialized_units where company_id=$1) units,
      (select quantity_on_hand from inventory_items where company_id=$1 and location_id=$2 and catalog_part_id=$3) quantity_on_hand`,[companyId,locationId,partId])).rows[0];
    assert.deepEqual(afterDuplicateInvoice,beforeDuplicateInvoice);
  } finally {
    await query(`with teardown as materialized (
      select set_config('app.allow_inventory_evidence_teardown','on',true)
    ) delete from inventory_purchase_invoice_allocations using teardown
      where company_id=$1`,[companyId]).catch(()=>{});
    for (const table of [
      "inventory_label_batch_items","inventory_label_batches","inventory_unit_events",
      "inventory_position_movements","inventory_serialized_units","inventory_position_operations","inventory_position_balances","inventory_positions",
      "inventory_purchase_delivery_lines","inventory_purchase_deliveries","inventory_stock_movements",
      "inventory_purchase_receipt_allocations",
      "local_inventory_receipt_lines","inventory_receipt_lines","inventory_authority_cutovers","inventory_authority_exceptions",
      "inventory_items","local_inventory_receipts","inventory_receipts","invoice_extraction_runs","inventory_purchase_events","inventory_workflow_commands",
      "inventory_purchase_lines","inventory_purchase_orders","inventory_suppliers","parts_catalog","locations",
    ]) await query(`delete from ${table} where company_id=$1`,[companyId]).catch(()=>{});
    await query("delete from companies where id=$1",[companyId]).catch(()=>{});
    await query("delete from user_profiles where id=$1",[actorId]).catch(()=>{});
  }
});
