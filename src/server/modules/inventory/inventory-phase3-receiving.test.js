import assert from "node:assert/strict";
import test from "node:test";
import { confirmReviewedInvoiceFullDelivery } from "./local-inventory.service.js";
import { receivePurchaseOrder } from "./inventory-purchasing.service.js";
import { confirmLocalReceiptSchema } from "./inventory.schemas.js";
import { purchaseReceiptSchema } from "./inventory-purchasing.schemas.js";

const COMPANY_ID="10000000-0000-4000-8000-000000000001";
const LOCATION_ID="10000000-0000-4000-8000-000000000002";
const ACTOR_ID="10000000-0000-4000-8000-000000000003";
const RUN_ID="10000000-0000-4000-8000-000000000004";
const PART_ID="10000000-0000-4000-8000-000000000005";
const ORDER_ID="10000000-0000-4000-8000-000000000006";
const PURCHASE_LINE_ID="10000000-0000-4000-8000-000000000007";
const TARGET_POSITION_ID="10000000-0000-4000-8000-000000000008";
const context={actor:{id:ACTOR_ID,role:"office"},companyIds:new Set([COMPANY_ID]),locationIds:new Set([LOCATION_ID])};
const loadLocation=async()=>({id:LOCATION_ID,company_id:COMPANY_ID});
const draft={documentType:{value:"invoice",confidence:100,evidence:""},vendorName:{value:"Vendor",confidence:100,evidence:""},vendorAccount:{value:"",confidence:100,evidence:""},invoiceNumber:{value:"INV-P3",confidence:100,evidence:""},invoiceDate:{value:"2026-09-17",confidence:100,evidence:""},purchaseOrderNumber:{value:"PO-P3",confidence:100,evidence:""},currency:{value:"USD",confidence:100,evidence:""},subtotal:{value:50,confidence:100,evidence:""},tax:{value:0,confidence:100,evidence:""},shipping:{value:0,confidence:100,evidence:""},total:{value:50,confidence:100,evidence:""},lines:[{id:"line-1",catalogPartId:PART_ID,partNumber:{value:"P3-PART",confidence:100,evidence:""},description:{value:"Part",confidence:100,evidence:""},quantity:{value:5,confidence:100,evidence:""},unitOfMeasure:{value:"ea",confidence:100,evidence:""},unitPrice:{value:10,confidence:100,evidence:""},lineTotal:{value:50,confidence:100,evidence:""}}],warnings:[]};

test("invoice receipt schema accepts only UUID exact targets and remains strict",()=>{
  const line={invoiceLineIndex:0,targetPositionId:TARGET_POSITION_ID,acceptedQuantity:1,heldQuantity:0,rejectedQuantity:0,notReceivedQuantity:0,outcome:"accepted",notes:"",holdLocation:"",serialNumbers:[]};
  assert.equal(confirmLocalReceiptSchema.safeParse({expectedVersion:1,idempotencyKey:"schema-target-123",receiptLines:[line]}).success,true);
  assert.equal(confirmLocalReceiptSchema.safeParse({expectedVersion:1,idempotencyKey:"schema-target-123",receiptLines:[{...line,targetPositionId:"not-a-uuid"}]}).success,false);
  assert.equal(confirmLocalReceiptSchema.safeParse({expectedVersion:1,idempotencyKey:"schema-target-123",receiptLines:[{...line,unexpected:true}]}).success,false);
  assert.equal(confirmLocalReceiptSchema.safeParse({expectedVersion:1,idempotencyKey:"schema-target-123",receiptLines:[{...line,acceptedQuantity:0,heldQuantity:1,outcome:"damaged",notes:"Held",}]}).success,false);
  const purchase={locationId:LOCATION_ID,expectedVersion:1,idempotencyKey:"purchase-target-123",reference:"",lines:[{purchaseLineId:PURCHASE_LINE_ID,targetPositionId:TARGET_POSITION_ID,acceptedQuantity:1,heldQuantity:0,rejectedQuantity:0,notReceivedQuantity:0,outcome:"accepted",notes:"",holdLocation:"",serialNumbers:[]}]};
  assert.equal(purchaseReceiptSchema.safeParse(purchase).success,true);
  assert.equal(purchaseReceiptSchema.safeParse({...purchase,lines:[{...purchase.lines[0],acceptedQuantity:0,heldQuantity:1,outcome:"damaged",notes:"Held"}]}).success,false);
});

test("partial invoice receipt posts only accepted quantity and preserves exception evidence",async()=>{
  let posted;
  const result=await confirmReviewedInvoiceFullDelivery(RUN_ID,{
    expectedVersion:2,idempotencyKey:"phase3-invoice-partial",postingRoute:"purchase_order",
    allocationPlan:[{invoiceLineIndex:0,purchaseLineId:PURCHASE_LINE_ID,quantity:2}],
    receiptLines:[{invoiceLineIndex:0,purchaseLineId:PURCHASE_LINE_ID,targetPositionId:TARGET_POSITION_ID,acceptedQuantity:2,heldQuantity:1,rejectedQuantity:0,notReceivedQuantity:2,outcome:"damaged",notes:"One damaged and two missing",holdLocation:"Cage",serialNumbers:[]}],
  },context,{loadInvoice:async()=>({id:RUN_ID,company_id:COMPANY_ID,location_id:LOCATION_ID,status:"reviewed",version:2,reviewed_draft:draft}),
    loadTrackingModes:async()=>[{catalogPartId:PART_ID,trackingMode:"quantity"}],postReceipt:async(input)=>{posted=input;return{kind:"posted",receipt:{id:input.receiptId,status:"posted",units:[]}};}});
  assert.equal(result.replayed,false);
  assert.equal(posted.lines[0].quantity,3);
  assert.equal(posted.lines[0].acceptedQuantity,2);
  assert.equal(posted.lines[0].unitCost,10);
  assert.equal(posted.lines[0].lineTotal,30);
  assert.equal(posted.lines[0].currency,"USD");
  assert.equal(posted.lines[0].serializedUnits.length,0);
  assert.equal(posted.lines[0].targetPositionId,TARGET_POSITION_ID);
  assert.equal(posted.receiptOutcomes[0].notReceivedQuantity,2);
});

test("exact core charge and credit offsets cannot affect invoice receipt stock",async()=>{
  const coreDraft={...draft,lines:[
    draft.lines[0],
    {id:"core-charge",partNumber:{value:"CORE-1",confidence:100,evidence:""},description:{value:"Core charge",confidence:100,evidence:""},quantity:{value:1,confidence:100,evidence:""},unitOfMeasure:{value:"ea",confidence:100,evidence:""},unitPrice:{value:1995,confidence:100,evidence:""},lineTotal:{value:1995,confidence:100,evidence:""}},
    {id:"core-credit",partNumber:{value:"CORE-1",confidence:100,evidence:""},description:{value:"Core return",confidence:100,evidence:""},quantity:{value:-1,confidence:100,evidence:""},unitOfMeasure:{value:"ea",confidence:100,evidence:""},unitPrice:{value:1995,confidence:100,evidence:""},lineTotal:{value:-1995,confidence:100,evidence:""}},
  ]};
  let posted;
  await confirmReviewedInvoiceFullDelivery(RUN_ID,{expectedVersion:2,idempotencyKey:"phase3-core-offset",postingRoute:"no_purchase_order",noPurchaseOrderReason:"Supplier invoice without PO",receiptLines:[{invoiceLineIndex:0,acceptedQuantity:1,heldQuantity:0,rejectedQuantity:0,notReceivedQuantity:0,outcome:"accepted",notes:"",holdLocation:"",serialNumbers:[]}]},context,
    {loadInvoice:async()=>({id:RUN_ID,company_id:COMPANY_ID,location_id:LOCATION_ID,status:"reviewed",version:2,reviewed_draft:{...coreDraft,purchaseOrderNumber:{value:"",confidence:100,evidence:""}}}),loadTrackingModes:async()=>[{catalogPartId:PART_ID,trackingMode:"quantity"}],postReceipt:async(input)=>{posted=input;return{kind:"posted",receipt:{id:input.receiptId,status:"posted",units:[]}};}});
  assert.deepEqual(posted.lines.map((line)=>line.lineIndex),[0]);
  assert.deepEqual(posted.receiptOutcomes.map((line)=>line.invoiceLineIndex),[0]);

  await assert.rejects(confirmReviewedInvoiceFullDelivery(RUN_ID,{expectedVersion:2,idempotencyKey:"phase3-core-poison",postingRoute:"no_purchase_order",noPurchaseOrderReason:"Supplier invoice without PO",receiptLines:[{invoiceLineIndex:1,acceptedQuantity:1,heldQuantity:0,rejectedQuantity:0,notReceivedQuantity:0,outcome:"accepted",notes:"",holdLocation:"",serialNumbers:[]}]},context,
    {loadInvoice:async()=>({id:RUN_ID,company_id:COMPANY_ID,location_id:LOCATION_ID,status:"reviewed",version:2,reviewed_draft:{...coreDraft,purchaseOrderNumber:{value:"",confidence:100,evidence:""}}}),loadTrackingModes:async()=>[{catalogPartId:PART_ID,trackingMode:"quantity"}],postReceipt:async()=>({kind:"posted",receipt:{status:"posted",units:[]}})}),
  {code:"INVENTORY_RECEIPT_LINE_INVALID"});
});

test("missing saved tracking blocks partial receiving before the stock writer",async()=>{
  let wrote=false;
  await assert.rejects(confirmReviewedInvoiceFullDelivery(RUN_ID,{expectedVersion:2,idempotencyKey:"phase3-missing-track",confirmation:"all_received_undamaged",postingRoute:"no_purchase_order",noPurchaseOrderReason:"Invoice arrived without a purchase order."},context,
    {loadInvoice:async()=>({id:RUN_ID,company_id:COMPANY_ID,location_id:LOCATION_ID,status:"reviewed",version:2,reviewed_draft:{...draft,purchaseOrderNumber:{value:"",confidence:100,evidence:""}}}),loadTrackingModes:async()=>[],postReceipt:async()=>{wrote=true;}}),
  {code:"INVENTORY_TRACKING_REQUIRED"});
  assert.equal(wrote,false);
});

test("multi-line PO receipt derives cost and creates labels only for serialized units",async()=>{
  let posted;
  const order={id:ORDER_ID,location_id:LOCATION_ID,status:"ordered",version:3,currency:"CAD",lines:[{id:PURCHASE_LINE_ID,catalog_part_id:PART_ID,part_number:"P3-SERIAL",description:"Serialized part",uom_code:"ea",current_uom_code:"ea",tracking_mode:"serialized",part_version:4,quantity:"4",received_quantity:"0",cancelled_quantity:"0",unit_price:"12.5000"}]};
  const result=await receivePurchaseOrder(ORDER_ID,{locationId:LOCATION_ID,expectedVersion:3,idempotencyKey:"phase3-po-receipt",reference:"Packing 1",lines:[{purchaseLineId:PURCHASE_LINE_ID,targetPositionId:TARGET_POSITION_ID,acceptedQuantity:2,heldQuantity:1,rejectedQuantity:0,notReceivedQuantity:1,outcome:"damaged",notes:"One case damaged",holdLocation:"Cage 2",serialNumbers:["SER-1","SER-2","SER-HOLD"]}]},context,
    {loadLocation,readPurchaseOrder:async()=>order,postReceipt:async(input)=>{posted=input;return{kind:"posted",receipt:{id:input.receiptId,status:"posted",units:[],labelBatch:null}};},qrOptions:{signingKey:Buffer.alloc(32,9).toString("base64")}});
  assert.equal(result.recorded,true);
  assert.equal(posted.lines[0].quantity,3);
  assert.equal(posted.lines[0].acceptedQuantity,2);
  assert.equal(posted.lines[0].serializedUnits.length,3);
  assert.equal(posted.lines[0].serializedUnits[2].status,"held");
  assert.equal(posted.lines[0].unitCost,12.5);
  assert.equal(posted.lines[0].currency,"CAD");
  assert.equal(posted.lines[0].targetPositionId,TARGET_POSITION_ID);
  assert.equal(posted.direct.purchaseOrderId,ORDER_ID);
  assert.equal(posted.receiptOutcomes[0].heldQuantity,1);
});

test("invalid exact receipt target is surfaced without translating it into a purchase conflict",async()=>{
  const order={id:ORDER_ID,location_id:LOCATION_ID,status:"ordered",version:3,currency:"USD",lines:[{id:PURCHASE_LINE_ID,catalog_part_id:PART_ID,part_number:"P3",description:"Part",uom_code:"ea",current_uom_code:"ea",tracking_mode:"quantity",part_version:1,quantity:"1",received_quantity:"0",cancelled_quantity:"0",unit_price:"0"}]};
  await assert.rejects(receivePurchaseOrder(ORDER_ID,{locationId:LOCATION_ID,expectedVersion:3,idempotencyKey:"phase3-invalid-target",reference:"",lines:[{purchaseLineId:PURCHASE_LINE_ID,targetPositionId:TARGET_POSITION_ID,acceptedQuantity:1,heldQuantity:0,rejectedQuantity:0,notReceivedQuantity:0,outcome:"accepted",notes:"",holdLocation:"",serialNumbers:[]}]},context,
    {loadLocation,readPurchaseOrder:async()=>order,postReceipt:async()=>({kind:"target_position_invalid"})}),{code:"INVENTORY_RECEIPT_POSITION_INVALID",statusCode:422});
});

test("duplicate serialized identities return stable receipt errors on invoice and PO routes",async()=>{
  await assert.rejects(confirmReviewedInvoiceFullDelivery(RUN_ID,{
    expectedVersion:2,idempotencyKey:"phase3-invoice-serial-conflict",postingRoute:"no_purchase_order",noPurchaseOrderReason:"Invoice arrived without a purchase order.",
    receiptLines:[{invoiceLineIndex:0,acceptedQuantity:1,heldQuantity:0,rejectedQuantity:0,notReceivedQuantity:0,outcome:"accepted",notes:"",holdLocation:"",serialNumbers:[]}],
  },context,{loadInvoice:async()=>({id:RUN_ID,company_id:COMPANY_ID,location_id:LOCATION_ID,status:"reviewed",version:2,reviewed_draft:{...draft,purchaseOrderNumber:{value:"",confidence:100,evidence:""}}}),
    loadTrackingModes:async()=>[{catalogPartId:PART_ID,trackingMode:"quantity"}],postReceipt:async()=>({kind:"serial_conflict"})}),
  {code:"INVENTORY_SERIAL_IDENTITY_DUPLICATE",statusCode:409});

  const order={id:ORDER_ID,location_id:LOCATION_ID,status:"ordered",version:3,currency:"USD",lines:[{id:PURCHASE_LINE_ID,catalog_part_id:PART_ID,part_number:"P3-SERIAL",description:"Serialized part",uom_code:"ea",current_uom_code:"ea",tracking_mode:"serialized",part_version:1,quantity:"1",received_quantity:"0",cancelled_quantity:"0",unit_price:"1"}]};
  await assert.rejects(receivePurchaseOrder(ORDER_ID,{locationId:LOCATION_ID,expectedVersion:3,idempotencyKey:"phase3-po-serial-conflict",reference:"",lines:[{purchaseLineId:PURCHASE_LINE_ID,acceptedQuantity:1,heldQuantity:0,rejectedQuantity:0,notReceivedQuantity:0,outcome:"accepted",notes:"",holdLocation:"",serialNumbers:["DUPLICATE"]}]},context,
    {loadLocation,readPurchaseOrder:async()=>order,postReceipt:async()=>({kind:"serial_conflict"}),qrOptions:{signingKey:Buffer.alloc(32,9).toString("base64")}}),
  {code:"INVENTORY_SERIAL_IDENTITY_DUPLICATE",statusCode:409});
});

test("an all-not-delivered PO observation persists shortage evidence without stock lines",async()=>{
  let posted;
  const order={id:ORDER_ID,location_id:LOCATION_ID,status:"ordered",version:3,currency:"USD",lines:[{id:PURCHASE_LINE_ID,catalog_part_id:PART_ID,part_number:"P3",description:"Part",uom_code:"ea",current_uom_code:"ea",tracking_mode:"quantity",part_version:1,quantity:"4",received_quantity:"0",cancelled_quantity:"0",unit_price:null}]};
  const result=await receivePurchaseOrder(ORDER_ID,{locationId:LOCATION_ID,expectedVersion:3,idempotencyKey:"phase3-po-noop",reference:"",lines:[{purchaseLineId:PURCHASE_LINE_ID,acceptedQuantity:0,heldQuantity:0,rejectedQuantity:0,notReceivedQuantity:4,outcome:"short",notes:"Shipment did not arrive",holdLocation:"",serialNumbers:[]}]},context,
    {loadLocation,readPurchaseOrder:async()=>order,postReceipt:async(input)=>{posted=input;return{kind:"posted",receipt:{id:input.receiptId,status:"posted",units:[],labelBatch:null}};}});
  assert.equal(result.recorded,true);
  assert.equal(posted.lines.length,0);
  assert.equal(posted.receiptOutcomes[0].notReceivedQuantity,4);
  assert.equal(posted.labelBatchId,null);
});
