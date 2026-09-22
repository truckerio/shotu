import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { closePool, getPool, query } from "../../db/pool.js";
import { getInbound, getInboundDetail } from "./inventory-inbound.service.js";

const enabled = process.env.RUN_POSTGRES_INTEGRATION === "1";
after(async () => { if (enabled) await closePool(); });

const hash = (value) => createHash("sha256").update(value).digest("hex");
const draft = (number, partId, poNumber = "") => ({
  documentType: { value: "invoice" }, vendorName: { value: "Inbound QA Vendor" }, vendorAccount: { value: "" },
  invoiceNumber: { value: number }, invoiceDate: { value: "2026-09-18" }, purchaseOrderNumber: { value: poNumber },
  currency: { value: "USD" }, subtotal: { value: 10 }, tax: { value: 0 }, shipping: { value: 0 }, total: { value: 10 },
  lines: [{ id: "line-1", catalogPartId: partId, partNumber: { value: "INBOUND-QA" }, description: { value: "Inbound QA part" }, quantity: { value: 2 }, unitOfMeasure: { value: "ea" }, unitPrice: { value: 5 }, lineTotal: { value: 10 } }],
  warnings: [],
});

test("inbound projection is tenant and location scoped, searchable, and read-only", { skip: !enabled }, async () => {
  const suffix = randomUUID().replaceAll("-", "");
  const companyId = randomUUID(); const otherCompanyId = randomUUID(); const locationId = randomUUID(); const otherLocationId = randomUUID();
  const actorId = randomUUID(); const supplierId = randomUUID(); const partId = randomUUID(); const orderId = randomUUID(); const lineId = randomUUID();
  const partialOrderId = randomUUID(); const partialLineId = randomUUID(); const completeOrderId = randomUUID(); const completeLineId = randomUUID();
  const exceptionOrderId = randomUUID(); const heldLineId = randomUUID(); const rejectedLineId = randomUUID(); const shortLineId = randomUUID();
  const expectedInvoiceId = randomUUID(); const unmatchedInvoiceId = randomUUID(); const mismatchInvoiceId = randomUUID(); const postedInvoiceId = randomUUID(); const allocationId = randomUUID();
  const processingInvoiceId = randomUUID(); const reviewInvoiceId = randomUUID(); const failedInvoiceId = randomUUID();
  const directReceiptId = randomUUID(); const directReceiptLineId = randomUUID(); const postedReceiptId = randomUUID(); const postedReceiptLineId = randomUUID();
  const evidenceReceiptId = randomUUID(); const heldReceiptLineId = randomUUID(); const rejectedReceiptLineId = randomUUID(); const evidenceDeliveryId = randomUUID();
  const noPoDeliveryId = randomUUID();
  const otherOrderId = randomUUID(); const otherLineId = randomUUID();
  const context = { actor: { id: actorId, role: "office" }, companyIds: new Set([companyId]), locationIds: new Set([locationId]) };
  const beforeStock = async () => Number((await query("select count(*)::int as count from inventory_items where company_id=$1", [companyId])).rows[0].count);
  try {
    await query("insert into companies(id,slug,name) values($1,$2,'Inbound QA'),($3,$4,'Other tenant')", [companyId, `inbound-${suffix}`, otherCompanyId, `other-${suffix}`]);
    await query("insert into locations(id,company_id,name) values($1,$2,'Inbound Shop'),($3,$2,'Other Shop'),($4,$5,'Other Tenant Shop')", [locationId, companyId, otherLocationId, randomUUID(), otherCompanyId]);
    await query("insert into user_profiles(id,display_name) values($1,'Inbound QA Actor')", [actorId]);
    await query("insert into user_company_memberships(user_id,company_id,role,active) values($1,$2,'office',true)", [actorId, companyId]);
    await query("insert into user_location_memberships(user_id,company_id,location_id,active) values($1,$2,$3,true)", [actorId, companyId, locationId]);
    await query("insert into inventory_suppliers(id,company_id,name) values($1,$2,'Inbound QA Vendor')", [supplierId, companyId]);
    await query("insert into parts_catalog(id,company_id,part_number,normalized_part_number,description,uom_code,tracking_mode) values($1,$2,'INBOUND-QA','INBOUNDQA','Inbound QA part','ea','quantity')", [partId, companyId]);
    await query("insert into inventory_purchase_orders(id,company_id,location_id,supplier_id,created_by,number,currency,status) values($1,$2,$3,$4,$5,$6,'USD','ordered'),($7,$2,$3,$4,$5,$8,'USD','partially_received'),($9,$2,$3,$4,$5,$10,'USD','received'),($11,$2,$3,$4,$5,$12,'USD','ordered'),($13,$2,$14,$4,$5,$15,'USD','ordered')", [orderId, companyId, locationId, supplierId, actorId, `PO-INBOUND-${suffix}`, partialOrderId, `PO-PARTIAL-${suffix}`, completeOrderId, `PO-COMPLETE-${suffix}`, exceptionOrderId, `PO-EXCEPTION-${suffix}`, otherOrderId, otherLocationId, `PO-OTHER-${suffix}`]);
    await query("insert into inventory_purchase_lines(id,company_id,order_id,catalog_part_id,part_number,description,uom_code,quantity,tracking_mode) values($1,$2,$3,$4,'INBOUND-QA','Inbound QA part','ea',2,'quantity')", [lineId, companyId, orderId, partId]);
    await query("insert into inventory_purchase_lines(id,company_id,order_id,catalog_part_id,part_number,description,uom_code,quantity,received_quantity,tracking_mode) values($1,$2,$3,$4,'INBOUND-QA','Inbound QA part','ea',5,2,'quantity'),($5,$2,$6,$4,'INBOUND-QA','Inbound QA part','ea',2,2,'quantity'),($7,$2,$8,$4,'INBOUND-QA','Inbound QA part','ea',3,0,'quantity'),($9,$2,$8,$4,'INBOUND-QA','Inbound QA part','ea',2,0,'quantity'),($10,$2,$8,$4,'INBOUND-QA','Inbound QA part','ea',4,0,'quantity'),($11,$2,$12,$4,'INBOUND-QA','Inbound QA part','ea',2,0,'quantity')", [partialLineId, companyId, partialOrderId, partId, completeLineId, completeOrderId, heldLineId, exceptionOrderId, rejectedLineId, shortLineId, otherLineId, otherOrderId]);
    await query(`insert into invoice_extraction_runs(id,company_id,location_id,created_by,reviewed_by,document_hash,file_name,mime_type,byte_size,idempotency_key,status,provider,model,prompt_version,reviewed_draft,reviewed_at) values($1,$2,$3,$4,$4,$5,'allocated.pdf','application/pdf',1,$6,'reviewed','test','test','test',$7::jsonb,now()),($8,$2,$3,$4,$4,$9,'unmatched.pdf','application/pdf',1,$10,'reviewed','test','test','test',$11::jsonb,now()),($12,$2,$3,$4,$4,$13,'mismatch.pdf','application/pdf',1,$14,'reviewed','test','test','test',$15::jsonb,now()),($16,$2,$3,$4,$4,$17,'posted.pdf','application/pdf',1,$18,'reviewed','test','test','test',$19::jsonb,now())`, [expectedInvoiceId, companyId, locationId, actorId, hash(`allocated-${suffix}`), `allocated-${suffix}`, JSON.stringify(draft(`INV-A-${suffix}`, partId, `PO-INBOUND-${suffix}`)), unmatchedInvoiceId, hash(`unmatched-${suffix}`), `unmatched-${suffix}`, JSON.stringify(draft(`INV-U-${suffix}`, partId)), mismatchInvoiceId, hash(`mismatch-${suffix}`), `mismatch-${suffix}`, JSON.stringify(draft(`INV-M-${suffix}`, partId, `PO-MISMATCH-${suffix}`)), postedInvoiceId, hash(`posted-${suffix}`), `posted-${suffix}`, JSON.stringify(draft(`INV-P-${suffix}`, partId))]);
    await query(`insert into invoice_extraction_runs(id,company_id,location_id,created_by,document_hash,file_name,mime_type,byte_size,idempotency_key,status,provider,model,prompt_version,extracted_draft,error_code,retryable) values
      ($1,$2,$3,$4,$5,'processing.pdf','application/pdf',1,$6,'processing','test','test','test',null,null,false),
      ($7,$2,$3,$4,$8,'review.pdf','application/pdf',1,$9,'needs_review','test','test','test',$10::jsonb,null,false),
      ($11,$2,$3,$4,$12,'failed.pdf','application/pdf',1,$13,'failed','test','test','test',null,'EXTRACTION_FAILED',true)`,
      [processingInvoiceId, companyId, locationId, actorId, hash(`processing-${suffix}`), `processing-${suffix}`, reviewInvoiceId, hash(`review-${suffix}`), `review-${suffix}`, JSON.stringify(draft(`INV-R-${suffix}`, partId)), failedInvoiceId, hash(`failed-${suffix}`), `failed-${suffix}`]);

    await query("insert into inventory_receipts(id,company_id,location_id,invoice_run_id,created_by,idempotency_key,provider,provider_marker,status,confirmed_at) values($1,$2,$3,$4,$5,$6,'local',$7,'confirmed',now())", [evidenceReceiptId, companyId, locationId, postedInvoiceId, actorId, `evidence-${suffix}`, `EVIDENCE-${suffix}`]);
    await query("insert into inventory_receipt_lines(id,company_id,receipt_id,line_index,catalog_part_id,product_external_id,part_number,description,quantity,uom_code,tracking_mode) values($1,$2,$3,0,$4,'local:held','INBOUND-QA','Inbound QA part',1,'ea','aggregate'),($5,$2,$3,1,$4,'local:rejected','INBOUND-QA','Inbound QA part',1,'ea','aggregate')", [heldReceiptLineId, companyId, evidenceReceiptId, partId, rejectedReceiptLineId]);
    await query("insert into inventory_purchase_deliveries(id,company_id,order_id,location_id,received_by,idempotency_key,request_hash,status) values($1,$2,$3,$4,$5,$6,$7,'posted')", [evidenceDeliveryId, companyId, exceptionOrderId, locationId, actorId, `evidence-delivery-${suffix}`, hash(`evidence-delivery-${suffix}`)]);
    await query("insert into inventory_purchase_delivery_lines(company_id,delivery_id,purchase_line_id,outcome,expected_quantity,actual_quantity,usable_quantity,held_quantity,rejected_quantity,uom_code,receipt_line_id) values($1,$2,$3,'damaged',3,1,0,1,0,'ea',$4),($1,$2,$5,'rejected',2,1,0,0,1,'ea',$6),($1,$2,$7,'shortage',4,0,0,0,0,'ea',null)", [companyId, evidenceDeliveryId, heldLineId, heldReceiptLineId, rejectedLineId, rejectedReceiptLineId, shortLineId]);
    await query("insert into inventory_purchase_deliveries(id,company_id,invoice_run_id,location_id,received_by,idempotency_key,request_hash,status,reference,notes) values($1,$2,$3,$4,$5,$6,$7,'posted','NO-PO-DELIVERY','Invoice arrived without PO')", [noPoDeliveryId, companyId, mismatchInvoiceId, locationId, actorId, `no-po-delivery-${suffix}`, hash(`no-po-delivery-${suffix}`)]);
    await query("insert into inventory_purchase_delivery_lines(company_id,delivery_id,invoice_line_index,outcome,expected_quantity,actual_quantity,usable_quantity,held_quantity,rejected_quantity,uom_code,reason) values($1,$2,0,'shortage',2,0,0,0,0,'ea','Two units missing')", [companyId, noPoDeliveryId]);
    await query("insert into inventory_receipts(id,company_id,location_id,created_by,idempotency_key,provider,provider_marker,status,confirmed_at) values($1,$2,$3,$4,$5,'local_direct',$6,'confirmed',now())", [directReceiptId, companyId, locationId, actorId, `direct-${suffix}`, `DIRECT-${suffix}`]);
    await query("insert into inventory_receipts(id,company_id,location_id,invoice_run_id,created_by,idempotency_key,provider,provider_marker,status,confirmed_at) values($1,$2,$3,$4,$5,$6,'local',$7,'confirmed',now())", [postedReceiptId, companyId, locationId, postedInvoiceId, actorId, `posted-${suffix}`, `POSTED-${suffix}`]);
    await query("insert into inventory_receipt_lines(id,company_id,receipt_id,line_index,catalog_part_id,product_external_id,part_number,description,quantity,uom_code,tracking_mode) values($1,$2,$3,0,$4,'local:direct','INBOUND-QA','Inbound QA part',2,'ea','aggregate'),($5,$2,$6,0,$4,'local:posted','INBOUND-QA','Inbound QA part',2,'ea','aggregate')", [directReceiptLineId, companyId, directReceiptId, partId, postedReceiptLineId, postedReceiptId]);
    await query("insert into local_inventory_receipts(id,company_id,location_id,invoice_run_id,created_by,idempotency_key,request_hash,status,line_count,total_quantity,reviewed_run_version,physical_confirmation,confirmation_hash,source_type,posting_route,no_purchase_order_reason) values($1,$2,$3,null,$4,$5,$6,'posted',1,2,null,'physically_received',$7,'direct','no_purchase_order','Received without invoice')", [directReceiptId, companyId, locationId, actorId, `direct-${suffix}`, hash(`direct-${suffix}`), hash(`confirmation-${suffix}`)]);
    await query("insert into local_inventory_receipt_lines(id,company_id,receipt_id,line_index,catalog_part_id,normalized_part_number,part_number,description,quantity,uom_code) values($1,$2,$3,0,$4,'INBOUNDQA','INBOUND-QA','Inbound QA part',2,'ea')", [directReceiptLineId, companyId, directReceiptId, partId]);
    await query("insert into local_inventory_receipts(id,company_id,location_id,invoice_run_id,created_by,idempotency_key,request_hash,status,line_count,total_quantity,reviewed_run_version,physical_confirmation,confirmation_hash,source_type,posting_route,no_purchase_order_reason) values($1,$2,$3,$4,$5,$6,$7,'posted',1,2,1,'all_received_undamaged',$8,'invoice','no_purchase_order','No PO was provided')", [postedReceiptId, companyId, locationId, postedInvoiceId, actorId, `posted-${suffix}`, hash(`posted-${suffix}`), hash(`posted-confirmation-${suffix}`)]);
    await query("insert into local_inventory_receipt_lines(id,company_id,receipt_id,line_index,catalog_part_id,normalized_part_number,part_number,description,quantity,uom_code) values($1,$2,$3,0,$4,'INBOUNDQA','INBOUND-QA','Inbound QA part',2,'ea')", [postedReceiptLineId, companyId, postedReceiptId, partId]);

    const stockBefore = await beforeStock();
    const expected = await getInbound(new URLSearchParams("view=expected"), context);
    assert.equal(expected.items.some((item) => item.poId === orderId), true);
    assert.equal(expected.items.some((item) => item.poId === partialOrderId && item.remainingQuantity === 3 && item.nextAction === "receive_goods"), true);
    assert.equal(expected.items.some((item) => item.poId === completeOrderId), false);
    assert.equal(expected.items.some((item) => item.poId === otherOrderId), false);
    const myWork = await getInbound(new URLSearchParams("view=my_work"), context);
    assert.equal(myWork.items.some((item) => item.invoiceRunId === processingInvoiceId && item.kind === "invoice_intake" && item.invoiceStatus === "processing"), true);
    assert.equal(myWork.items.some((item) => item.invoiceRunId === reviewInvoiceId && item.kind === "invoice_intake" && item.invoiceStatus === "needs_review"), true);
    assert.equal(myWork.items.some((item) => item.invoiceRunId === failedInvoiceId && item.kind === "invoice_intake" && item.invoiceStatus === "failed"), true);
    assert.equal(myWork.items.some((item) => item.invoiceRunId === unmatchedInvoiceId && !item.noPoUsed && item.noPoReason === null && item.nextAction === "resolve_no_po"), true);
    const unresolvedMismatch = myWork.items.find((item) => item.invoiceRunId === mismatchInvoiceId);
    assert.deepEqual({ noPoUsed: unresolvedMismatch.noPoUsed, noPoReason: unresolvedMismatch.noPoReason, poNumber: unresolvedMismatch.poNumber, nextAction: unresolvedMismatch.nextAction }, { noPoUsed: false, noPoReason: null, poNumber: `PO-MISMATCH-${suffix}`, nextAction: "resolve_no_po" });
    assert.equal(myWork.items.some((item) => item.id === directReceiptId && item.nextAction === "review_invoice"), true);
    assert.equal(myWork.items.some((item) => item.poId === exceptionOrderId && item.nextAction === "review_exception" && item.heldQuantity === 1 && item.rejectedQuantity === 1 && item.shortQuantity === 4), true);
    assert.equal(myWork.items.some((item) => item.id === postedReceiptId), false);
    const complete = await getInbound(new URLSearchParams("view=complete"), context);
    assert.equal(complete.items.some((item) => item.poId === completeOrderId && item.nextAction === "none"), true);
    assert.equal(complete.items.some((item) => item.id === postedReceiptId && item.nextAction === "none"), true);
    const attention = await getInbound(new URLSearchParams("view=attention"), context);
    assert.equal(attention.items.some((item) => item.invoiceRunId === reviewInvoiceId), true);
    assert.equal(attention.items.some((item) => item.invoiceRunId === failedInvoiceId), true);
    assert.equal(attention.items.some((item) => item.invoiceRunId === processingInvoiceId), false);
    assert.equal(attention.items.some((item) => item.invoiceRunId === unmatchedInvoiceId && item.nextAction === "resolve_no_po"), true);
    assert.equal(attention.items.some((item) => item.poId === exceptionOrderId && item.nextAction === "review_exception"), true);
    for (const view of [expected, myWork, attention, complete]) assert.deepEqual(view.counts, expected.counts);
    const search = await getInbound(new URLSearchParams("q=INV-U"), context);
    assert.equal(search.items.every((item) => String(item.invoiceNumber || "").includes("INV-U")), true);
    assert.equal((await beforeStock()), stockBefore, "read projection must not create stock");

    const exactDelivery = await getInboundDetail(evidenceDeliveryId, new URLSearchParams(), context);
    assert.equal(exactDelivery.item.poId, exceptionOrderId);
    assert.deepEqual({
      id: exactDelivery.item.selectedDelivery.id,
      status: exactDelivery.item.selectedDelivery.status,
      actual: exactDelivery.item.selectedDelivery.actualQuantity,
      held: exactDelivery.item.selectedDelivery.heldQuantity,
      rejected: exactDelivery.item.selectedDelivery.rejectedQuantity,
      short: exactDelivery.item.selectedDelivery.shortQuantity,
    }, { id: evidenceDeliveryId, status: "posted", actual: 2, held: 1, rejected: 1, short: 4 });
    assert.equal(exactDelivery.item.selectedDelivery.lines.length, 3);
    const noPoDelivery = await getInboundDetail(noPoDeliveryId, new URLSearchParams(), context);
    assert.equal(noPoDelivery.item.kind, "delivery");
    assert.equal(noPoDelivery.item.noPoUsed, true);
    assert.equal(noPoDelivery.item.invoiceRunId, mismatchInvoiceId);
    assert.equal(noPoDelivery.item.selectedDelivery.shortQuantity, 2);
    assert.equal(noPoDelivery.item.selectedDelivery.lines[0].reason, "Two units missing");

    await assert.rejects(() => getInboundDetail(orderId, new URLSearchParams(`locationId=${otherLocationId}`), context), { code: "inventory_not_found" });
    await assert.rejects(() => getInboundDetail(evidenceDeliveryId, new URLSearchParams(`locationId=${otherLocationId}`), context), { code: "inventory_not_found" });
    const otherContext = { ...context, companyIds: new Set([otherCompanyId]) };
    await assert.rejects(() => getInboundDetail(orderId, new URLSearchParams(), otherContext), { code: "inventory_not_found" });
    await assert.rejects(() => getInboundDetail(evidenceDeliveryId, new URLSearchParams(), otherContext), { code: "inventory_not_found" });
    await assert.rejects(() => getInboundDetail(randomUUID(), new URLSearchParams(), context), { code: "inventory_not_found" });

    // This is an explicit projection check for the allocated invoice contract. The current
    // repository should coalesce this into the PO row once the allocation is posted.
    await query("insert into inventory_purchase_invoice_allocations(id,company_id,invoice_run_id,invoice_line_index,purchase_line_id,quantity,status,request_hash,created_by) values($1,$2,$3,0,$4,2,'planned',$5,$6)", [allocationId, companyId, expectedInvoiceId, lineId, hash(`allocation-${suffix}`), actorId]);
    const coalesced = await getInboundDetail(orderId, new URLSearchParams(), context);
    assert.equal(coalesced.item.invoiceRunId, expectedInvoiceId, "allocated reviewed invoice must be visible on its PO row");
    await query("update local_inventory_receipts set status='reversed',reversed_at=now() where company_id=$1 and id=$2", [companyId, postedReceiptId]);
    const reversedComplete = await getInbound(new URLSearchParams("view=complete"), context);
    const reversedRows = reversedComplete.items.filter((item) => item.invoiceRunId === postedInvoiceId);
    assert.equal(reversedRows.length, 1, "reversed invoice must retain one canonical history row");
    assert.equal(reversedRows[0].invoiceStatus, "reversed");
    const reversedWork = await getInbound(new URLSearchParams("view=my_work"), context);
    assert.equal(reversedWork.items.some((item) => item.invoiceRunId === postedInvoiceId), false);
    await query("update inventory_purchase_deliveries set status='void',voided_at=now() where company_id=$1 and id=$2", [companyId, evidenceDeliveryId]);
    await assert.rejects(() => getInboundDetail(evidenceDeliveryId, new URLSearchParams(), context), { code: "inventory_not_found" });
  } finally {
    const cleanup = await getPool().connect();
    try {
      await cleanup.query("begin");
      await cleanup.query("set local app.allow_inventory_evidence_teardown='on'");
      await cleanup.query("delete from inventory_purchase_invoice_allocations where company_id=$1", [companyId]);
      for (const table of ["inventory_purchase_delivery_lines", "inventory_purchase_deliveries", "local_inventory_receipt_lines", "local_inventory_receipts", "inventory_receipt_lines", "inventory_receipts", "inventory_purchase_lines", "inventory_purchase_orders", "inventory_suppliers", "invoice_extraction_runs", "user_location_memberships", "user_company_memberships", "parts_catalog", "locations"]) await cleanup.query(`delete from ${table} where company_id=$1`, [companyId]);
      await cleanup.query("delete from companies where id=$1", [companyId]);
      await cleanup.query("delete from user_profiles where id=$1", [actorId]);
      await cleanup.query("commit");
    } catch (error) {
      await cleanup.query("rollback").catch(() => {});
      throw error;
    } finally {
      cleanup.release();
    }
  }
});
