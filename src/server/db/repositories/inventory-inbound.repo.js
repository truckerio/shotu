import { getPool } from '../../db/pool.js';

function mapInboundRow(value) {
  return {
    id: value.id,
    kind: value.kind,
    locationId: value.location_id,
    locationName: value.location_name,
    supplier: value.supplier || '',
    poId: value.po_id,
    poNumber: value.po_number,
    invoiceRunId: value.invoice_run_id,
    invoiceNumber: value.invoice_number,
    invoiceNumbers: value.invoice_numbers || [],
    invoiceCount: Number(value.invoice_count || 0),
    expectedQuantity: Number(value.expected_quantity || 0),
    receivedQuantity: Number(value.received_quantity || 0),
    heldQuantity: Number(value.held_quantity || 0),
    rejectedQuantity: Number(value.rejected_quantity || 0),
    shortQuantity: Number(value.short_quantity || 0),
    remainingQuantity: Number(value.remaining_quantity || 0),
    uomCodes: value.uom_codes || [],
    noPoUsed: Boolean(value.no_po_used),
    noPoReason: value.no_po_reason || null,
    invoiceStatus: value.invoice_status || null,
    updatedAt: value.updated_at,
    ownerLabel: value.owner_label || '',
    nextAction: value.next_action,
  };
}

function mapSelectedDelivery(value) {
  const expected = Number(value.delivery_expected_quantity || 0);
  const actual = Number(value.delivery_actual_quantity || 0);
  const usable = Number(value.delivery_usable_quantity || 0);
  const held = Number(value.delivery_held_quantity || 0);
  const rejected = Number(value.delivery_rejected_quantity || 0);
  const short = Number(value.delivery_short_quantity || 0);
  return {
    id: value.delivery_id,
    status: value.delivery_status,
    reference: value.delivery_reference || '',
    notes: value.delivery_notes || '',
    receivedAt: value.delivery_received_at,
    receivedBy: { id: value.received_by, displayName: value.received_by_name || 'Team member' },
    expectedQuantity: expected,
    actualQuantity: actual,
    usableQuantity: usable,
    heldQuantity: held,
    rejectedQuantity: rejected,
    shortQuantity: short,
    uomCodes: value.delivery_uom_codes || [],
    lines: value.delivery_lines || [],
  };
}

// This is a read projection. Purchase orders, reviewed invoices, physical
// receipts, allocations, and delivery observations remain the canonical owners.
const projection = `with po as (
  select order_row.id,order_row.company_id,order_row.location_id,location.name location_name,
    supplier.name supplier,order_row.id po_id,order_row.number po_number,
    case when coalesce(invoice.invoice_count,0)=1 then invoice.invoice_run_id end invoice_run_id,
    case when coalesce(invoice.invoice_count,0)=1 then invoice.invoice_number end invoice_number,
    coalesce(invoice.invoice_numbers,array[]::text[]) invoice_numbers,coalesce(invoice.invoice_count,0) invoice_count,
    sum(line.quantity) expected_quantity,sum(line.received_quantity) received_quantity,
    coalesce(delivery.held_quantity,0) held_quantity,coalesce(delivery.rejected_quantity,0) rejected_quantity,
    coalesce(delivery.short_quantity,0) short_quantity,
    sum(line.quantity-line.received_quantity-line.cancelled_quantity) remaining_quantity,
    array_agg(distinct line.uom_code order by line.uom_code) uom_codes,order_row.status,order_row.updated_at,
    'purchase_order' kind,false no_po_used,null::text no_po_reason,null::text invoice_status,
    case
      when coalesce(delivery.held_quantity,0)+coalesce(delivery.rejected_quantity,0)+coalesce(delivery.short_quantity,0)>0 then 'review_exception'
      when order_row.status in ('ordered','partially_received') then 'receive_goods'
      else 'none'
    end next_action,
    case
      when coalesce(delivery.held_quantity,0)+coalesce(delivery.rejected_quantity,0)+coalesce(delivery.short_quantity,0)>0 then 'Inventory review'
      when order_row.status in ('ordered','partially_received') then 'Receiving'
      else 'Complete'
    end owner_label
  from inventory_purchase_orders order_row
  join inventory_purchase_lines line on line.company_id=order_row.company_id and line.order_id=order_row.id
  join locations location on location.company_id=order_row.company_id and location.id=order_row.location_id
  join inventory_suppliers supplier on supplier.company_id=order_row.company_id and supplier.id=order_row.supplier_id
  left join lateral (
    select sum(delivery_line.held_quantity) held_quantity,sum(delivery_line.rejected_quantity) rejected_quantity,
      sum(case when delivery_line.outcome='shortage' then delivery_line.expected_quantity else 0 end) short_quantity
    from inventory_purchase_deliveries delivery_row
    join inventory_purchase_delivery_lines delivery_line
      on delivery_line.company_id=delivery_row.company_id and delivery_line.delivery_id=delivery_row.id
    where delivery_row.company_id=order_row.company_id and delivery_row.order_id=order_row.id and delivery_row.status='posted'
  ) delivery on true
  left join lateral (
    select count(distinct run.id)::int invoice_count,(array_agg(distinct run.id order by run.id))[1] invoice_run_id,
      min(coalesce(nullif(coalesce(run.reviewed_draft,run.extracted_draft) #>> '{invoiceNumber,value}',''),run.file_name)) invoice_number,
      array_agg(distinct coalesce(nullif(coalesce(run.reviewed_draft,run.extracted_draft) #>> '{invoiceNumber,value}',''),run.file_name)
        order by coalesce(nullif(coalesce(run.reviewed_draft,run.extracted_draft) #>> '{invoiceNumber,value}',''),run.file_name)) invoice_numbers
    from inventory_purchase_invoice_allocations allocation
    join inventory_purchase_lines allocated_line
      on allocated_line.company_id=allocation.company_id and allocated_line.id=allocation.purchase_line_id
    join invoice_extraction_runs run on run.company_id=allocation.company_id and run.id=allocation.invoice_run_id
    where allocated_line.order_id=order_row.id and allocation.status<>'released'
  ) invoice on true
  where order_row.company_id=any($1::uuid[]) and order_row.location_id=any($2::uuid[])
    and order_row.status in ('ordered','partially_received','received','closed_with_discrepancy')
  group by order_row.id,location.name,supplier.name,delivery.held_quantity,delivery.rejected_quantity,
    delivery.short_quantity,invoice.invoice_count,invoice.invoice_run_id,invoice.invoice_number,invoice.invoice_numbers
), receipt as (
  select receipt_row.id,receipt_row.company_id,receipt_row.location_id,location.name location_name,
    coalesce(nullif(coalesce(run.reviewed_draft,run.extracted_draft) #>> '{vendorName,value}',''),'') supplier,
    null::uuid po_id,null::text po_number,receipt_row.invoice_run_id,
    coalesce(nullif(coalesce(run.reviewed_draft,run.extracted_draft) #>> '{invoiceNumber,value}',''),run.file_name) invoice_number,
    case when receipt_row.invoice_run_id is null then array[]::text[] else array[coalesce(nullif(coalesce(run.reviewed_draft,run.extracted_draft) #>> '{invoiceNumber,value}',''),run.file_name)] end invoice_numbers,
    case when receipt_row.invoice_run_id is null then 0 else 1 end invoice_count,
    coalesce(sum(receipt_line.quantity),0) expected_quantity,coalesce(sum(receipt_line.quantity),0) received_quantity,
    0::numeric held_quantity,0::numeric rejected_quantity,0::numeric short_quantity,0::numeric remaining_quantity,
    coalesce(array_agg(distinct receipt_line.uom_code order by receipt_line.uom_code) filter(where receipt_line.uom_code is not null),array[]::text[]) uom_codes,
    receipt_row.status,coalesce(receipt_row.posted_at,receipt_row.reversed_at) updated_at,'receipt' kind,true no_po_used,
    coalesce(nullif(receipt_row.no_purchase_order_reason,''),'No purchase order was used.') no_po_reason,
    case when receipt_row.status='reversed' then 'reversed' else 'added' end invoice_status,
    case when receipt_row.source_type='direct' and receipt_row.invoice_run_id is null then 'review_invoice' else 'none' end next_action,
    case when receipt_row.source_type='direct' and receipt_row.invoice_run_id is null then 'Accounts payable' else 'Complete' end owner_label
  from local_inventory_receipts receipt_row
  left join local_inventory_receipt_lines receipt_line
    on receipt_line.company_id=receipt_row.company_id and receipt_line.receipt_id=receipt_row.id
  join locations location on location.company_id=receipt_row.company_id and location.id=receipt_row.location_id
  left join invoice_extraction_runs run on run.company_id=receipt_row.company_id and run.id=receipt_row.invoice_run_id
  where receipt_row.company_id=any($1::uuid[]) and receipt_row.location_id=any($2::uuid[])
    and receipt_row.status in ('posted','reversed') and receipt_row.posting_route='no_purchase_order'
  group by receipt_row.id,location.name,run.reviewed_draft,run.extracted_draft,run.file_name
), invoice as (
  select run.id,run.company_id,run.location_id,location.name location_name,
    coalesce(nullif(coalesce(run.reviewed_draft,run.extracted_draft) #>> '{vendorName,value}',''),'Supplier not set') supplier,
    null::uuid po_id,
    nullif(coalesce(run.reviewed_draft,run.extracted_draft) #>> '{purchaseOrderNumber,value}','') po_number,
    run.id invoice_run_id,
    coalesce(nullif(coalesce(run.reviewed_draft,run.extracted_draft) #>> '{invoiceNumber,value}',''),run.file_name) invoice_number,
    array[coalesce(nullif(coalesce(run.reviewed_draft,run.extracted_draft) #>> '{invoiceNumber,value}',''),run.file_name)] invoice_numbers,
    1 invoice_count,0::numeric expected_quantity,0::numeric received_quantity,0::numeric held_quantity,
    0::numeric rejected_quantity,0::numeric short_quantity,0::numeric remaining_quantity,array[]::text[] uom_codes,
    run.status,coalesce(run.reviewed_at,run.created_at) updated_at,
    case when run.status='reviewed' then 'invoice' else 'invoice_intake' end kind,false no_po_used,
    null::text no_po_reason,
    case when run.status='reviewed' then 'reviewed' when run.status in ('completed','needs_review') then 'needs_review' else run.status end invoice_status,
    case when run.status='reviewed' then 'resolve_no_po' when run.status in ('completed','needs_review') then 'needs_review' else run.status end next_action,
    case when run.status='reviewed' then 'Purchasing' else 'Invoice intake' end owner_label
  from invoice_extraction_runs run
  join locations location on location.company_id=run.company_id and location.id=run.location_id
  where run.company_id=any($1::uuid[]) and run.location_id=any($2::uuid[])
    and not exists (
      select 1 from inventory_purchase_invoice_allocations allocation
      where allocation.company_id=run.company_id and allocation.invoice_run_id=run.id and allocation.status<>'released'
    )
    and not exists (
      select 1 from local_inventory_receipts receipt_row
      where receipt_row.company_id=run.company_id and receipt_row.invoice_run_id=run.id and receipt_row.status in ('posted','reversed')
    )
), all_rows as (
  select * from po union all select * from receipt union all select * from invoice
)
select * from all_rows`;

function viewPredicate(view) {
  if (view === 'expected') return "next_action='receive_goods'";
  if (view === 'complete') return "next_action='none'";
  if (view === 'attention') return "next_action in ('resolve_no_po','review_exception','needs_review','failed')";
  return "next_action<>'none'";
}

export async function listInbound({ companyIds, locationIds, view, q, page }) {
  const client = await getPool().connect();
  try {
    const search = q || '';
    const searchPredicate = `($3='' or concat_ws(' ',po_number,invoice_number,array_to_string(invoice_numbers,' '),supplier,location_name,no_po_reason) ilike '%'||$3||'%')`;
    const countsResult = await client.query(`select
      count(*) filter(where next_action<>'none')::int my_work,
      count(*) filter(where next_action='receive_goods')::int expected,
      count(*) filter(where next_action in ('resolve_no_po','review_exception','needs_review','failed'))::int attention,
      count(*) filter(where next_action='none')::int complete
      from (${projection}) inbound where ${searchPredicate}`, [companyIds, locationIds, search]);
    const result = await client.query(`select * from (${projection}) inbound
      where ${viewPredicate(view)} and ${searchPredicate}
      order by updated_at desc nulls last,id limit 101 offset $4`,
    [companyIds, locationIds, search, (page - 1) * 100]);
    const counts = countsResult.rows[0];
    return {
      items: result.rows.slice(0, 100).map(mapInboundRow),
      page,
      hasMore: result.rows.length > 100,
      counts: {
        myWork: counts.my_work,
        expected: counts.expected,
        attention: counts.attention,
        complete: counts.complete,
      },
    };
  } finally {
    client.release();
  }
}

export async function readInbound(input) {
  const client = await getPool().connect();
  try {
    const result = await client.query(`select * from (${projection}) inbound where id=$3`, [input.companyIds, input.locationIds, input.id]);
    if (result.rows[0]) return mapInboundRow(result.rows[0]);
    const deliveryResult = await client.query(`select delivery.id delivery_id,delivery.order_id,delivery.invoice_run_id,
        delivery.location_id,delivery.status delivery_status,delivery.reference delivery_reference,delivery.notes delivery_notes,
        delivery.received_at delivery_received_at,delivery.received_by,receiver.display_name received_by_name,
        location.name location_name,order_row.number po_number,order_row.status po_status,supplier.name supplier_name,
        coalesce(nullif(coalesce(run.reviewed_draft,run.extracted_draft)#>>'{vendorName,value}',''),'Supplier not set') invoice_supplier,
        coalesce(nullif(coalesce(run.reviewed_draft,run.extracted_draft)#>>'{invoiceNumber,value}',''),run.file_name) invoice_number,
        coalesce(sum(line.expected_quantity),0) delivery_expected_quantity,
        coalesce(sum(line.actual_quantity),0) delivery_actual_quantity,
        coalesce(sum(line.usable_quantity),0) delivery_usable_quantity,
        coalesce(sum(line.held_quantity),0) delivery_held_quantity,
        coalesce(sum(line.rejected_quantity),0) delivery_rejected_quantity,
        coalesce(sum(case when line.outcome='shortage' then line.expected_quantity else 0 end),0) delivery_short_quantity,
        coalesce(array_agg(distinct line.uom_code order by line.uom_code) filter(where line.uom_code is not null),array[]::text[]) delivery_uom_codes,
        coalesce(jsonb_agg(jsonb_build_object('id',line.id,'outcome',line.outcome,'expectedQuantity',line.expected_quantity,
          'actualQuantity',line.actual_quantity,'usableQuantity',line.usable_quantity,'heldQuantity',line.held_quantity,
          'rejectedQuantity',line.rejected_quantity,'uomCode',line.uom_code,'reason',line.reason) order by line.created_at,line.id)
          filter(where line.id is not null),'[]'::jsonb) delivery_lines
      from inventory_purchase_deliveries delivery
      join locations location on location.company_id=delivery.company_id and location.id=delivery.location_id and location.active
      left join inventory_purchase_orders order_row on order_row.company_id=delivery.company_id and order_row.id=delivery.order_id
      left join inventory_suppliers supplier on supplier.company_id=order_row.company_id and supplier.id=order_row.supplier_id
      left join invoice_extraction_runs run on run.company_id=delivery.company_id and run.id=delivery.invoice_run_id
      left join user_profiles receiver on receiver.id=delivery.received_by
      left join inventory_purchase_delivery_lines line on line.company_id=delivery.company_id and line.delivery_id=delivery.id
      where delivery.company_id=any($1::uuid[]) and delivery.location_id=any($2::uuid[])
        and delivery.id=$3 and delivery.status='posted'
      group by delivery.id,location.name,order_row.number,order_row.status,supplier.name,run.reviewed_draft,
        run.extracted_draft,run.file_name,receiver.display_name`, [input.companyIds, input.locationIds, input.id]);
    const delivery = deliveryResult.rows[0];
    if (!delivery) return null;
    const selectedDelivery = mapSelectedDelivery(delivery);
    if (delivery.order_id) {
      const orderResult = await client.query(`select * from (${projection}) inbound where id=$3`, [input.companyIds, input.locationIds, delivery.order_id]);
      if (!orderResult.rows[0]) return null;
      return { ...mapInboundRow(orderResult.rows[0]), selectedDelivery };
    }
    const hasException = selectedDelivery.lines.some((line) => line.outcome !== 'accepted');
    return {
      id: delivery.invoice_run_id || delivery.delivery_id,
      kind: 'delivery',
      locationId: delivery.location_id,
      locationName: delivery.location_name,
      supplier: delivery.invoice_supplier || 'Supplier not set',
      poId: null,
      poNumber: null,
      invoiceRunId: delivery.invoice_run_id,
      invoiceNumber: delivery.invoice_number || null,
      invoiceNumbers: delivery.invoice_number ? [delivery.invoice_number] : [],
      invoiceCount: delivery.invoice_run_id ? 1 : 0,
      expectedQuantity: selectedDelivery.expectedQuantity,
      receivedQuantity: selectedDelivery.actualQuantity,
      heldQuantity: selectedDelivery.heldQuantity,
      rejectedQuantity: selectedDelivery.rejectedQuantity,
      shortQuantity: selectedDelivery.shortQuantity,
      remainingQuantity: selectedDelivery.shortQuantity,
      uomCodes: selectedDelivery.uomCodes,
      noPoUsed: true,
      noPoReason: delivery.delivery_notes || delivery.delivery_reference || 'No purchase order was used.',
      updatedAt: delivery.delivery_received_at,
      ownerLabel: hasException ? 'Inventory review' : 'Complete',
      nextAction: hasException ? 'review_exception' : 'none',
      selectedDelivery,
    };
  } finally {
    client.release();
  }
}
