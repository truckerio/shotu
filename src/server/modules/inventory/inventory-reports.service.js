import { z } from "zod";
import { getPool } from "../../db/pool.js";
import { inventoryNotFound } from "./inventory.errors.js";
import { effectiveInventoryScope } from "./inventory-effective-scope.js";

const schema = z.object({
  locationId: z.string().uuid(),
  page: z.coerce.number().int().positive().max(100000).default(1),
}).strict();

const CUSTODY_LIMIT = 100;
const REPORT_LIMIT = 100;

export async function getInventoryReports(params, context, dependencies = {}) {
  const { locationId, page } = schema.parse(Object.fromEntries(params));
  const client = await (dependencies.pool || getPool()).connect();
  try {
    await client.query("begin isolation level repeatable read read only");
    const location = (await client.query(
      "select company_id,name from locations where id=$1 and company_id=any($2::uuid[]) and active=true",
      [locationId, [...context.companyIds]],
    )).rows[0];
    if (!location) throw inventoryNotFound();
    effectiveInventoryScope(context, {
      companyId: location.company_id,
      locationId,
      code: "INVENTORY_REPORTS_FORBIDDEN",
      message: "Reports require Office or Admin access.",
    });

    const stock = await client.query(`select p.id,p.part_number,p.description,i.uom_code,i.quantity_on_hand as usable_on_hand,i.quantity_reserved,greatest(i.quantity_on_hand-i.quantity_reserved,0) as available,coalesce(held.quantity,0) as held_quantity,i.quantity_on_hand+coalesce(held.quantity,0) as physical_on_hand,coalesce(used.quantity,0) as used_last_30_days
      from inventory_items i join parts_catalog p on p.company_id=i.company_id and p.id=i.catalog_part_id
      left join lateral(select sum(quantity) as quantity from inventory_stock_tasks t where t.company_id=i.company_id and t.location_id=i.location_id and t.catalog_part_id=i.catalog_part_id and t.kind='damage' and t.status in ('inspection','repair')) held on true
      left join lateral(select -sum(quantity_delta) as quantity from inventory_stock_movements m where m.company_id=i.company_id and m.location_id=i.location_id and m.catalog_part_id=i.catalog_part_id and m.movement_type='issue' and m.created_at>=now()-interval '30 days') used on true
      where i.company_id=$1 and i.location_id=$2 and i.source_provider='local' order by p.part_number,p.id limit 101 offset $3`, [location.company_id, locationId, (page - 1) * 100]);
    const commitments = await client.query(`select o.currency,count(distinct o.id)::integer as orders,sum((l.quantity-l.received_quantity-l.cancelled_quantity)*l.unit_price) filter(where l.unit_price is not null) as priced_commitment,count(*) filter(where l.unit_price is null)::integer as unpriced_lines from inventory_purchase_orders o join inventory_purchase_lines l on l.company_id=o.company_id and l.order_id=o.id where o.company_id=$1 and o.location_id=$2 and o.status in ('ordered','partially_received') and l.quantity>l.received_quantity+l.cancelled_quantity group by o.currency order by o.currency`, [location.company_id, locationId]);
    const transfers = await client.query(`select t.id,p.part_number,t.quantity as dispatched_quantity,
      greatest(t.quantity-t.completed_quantity,0) as in_transit_quantity,
      greatest(t.completed_quantity-t.returned_quantity-t.lost_quantity-coalesce(damaged.quantity,0),0) as received_quantity,
      coalesce(damaged.quantity,0) as damaged_quantity,t.returned_quantity,t.lost_quantity,t.uom_code,
      source.name as source,destination.name as destination,t.holder,t.created_at,t.transfer_state,
      case when t.transfer_state<>'completed' then t.transfer_state
        when t.lost_quantity>0 then 'completed_with_loss'
        when t.returned_quantity=t.quantity then 'returned'
        when t.returned_quantity>0 then 'part_received_part_returned'
        else 'received' end as outcome,
      coalesce(discrepancy.open_count,0)::integer as open_discrepancies
     from inventory_stock_tasks t
     join parts_catalog p on p.company_id=t.company_id and p.id=t.catalog_part_id
     join locations source on source.company_id=t.company_id and source.id=t.location_id
     join locations destination on destination.company_id=t.company_id and destination.id=t.destination_id
     left join lateral(select sum(quantity) quantity from inventory_stock_tasks damage
       where damage.company_id=t.company_id and damage.parent_transfer_id=t.id and damage.kind='damage') damaged on true
     left join lateral(select count(*) open_count from inventory_transfer_discrepancies exception
       where exception.company_id=t.company_id and exception.task_id=t.id and exception.status='open') discrepancy on true
     where t.company_id=$1 and (t.location_id=$2 or t.destination_id=$2) and t.kind='transfer'
       and (t.transfer_state<>'completed' or coalesce(discrepancy.open_count,0)>0 or t.updated_at>=now()-interval '90 days')
     order by (t.transfer_state<>'completed' or coalesce(discrepancy.open_count,0)>0) desc,t.updated_at desc,t.id desc limit 100`, [location.company_id, locationId]);
    const coverage = await client.query(`select count(*)::integer as receipt_lines,count(*) filter(where l.unit_cost is null)::integer as unknown_cost_lines from local_inventory_receipt_lines l join local_inventory_receipts r on r.company_id=l.company_id and r.id=l.receipt_id where l.company_id=$1 and r.location_id=$2`, [location.company_id, locationId]);
    const bills = await client.query(`select currency,sum(subtotal+tax-paid-credited) as outstanding,sum(subtotal+tax-paid-credited) filter(where due_date<current_date) as overdue from inventory_supplier_bills where company_id=$1 and location_id=$2 group by currency`, [location.company_id, locationId]);

    const custodySummary = await client.query(`select
      count(*) filter(where status='awaiting_handoff')::integer as awaiting_handoff,
      count(*) filter(where status in ('received_pending_review','repair_complete_pending_review'))::integer as pending_inspection,
      count(*) filter(where status='hold')::integer as hold,
      count(*) filter(where status='repair')::integer as repair,
      count(*) filter(where status='quarantine')::integer as quarantine,
      count(*) filter(where status='core_pending_return')::integer as core_pending,
      count(*) filter(where status='scrap_pending_approval')::integer as scrap_pending,
      count(*) filter(where status='released' and release_position_id is not null)::integer as released_exact_position,
      count(*) filter(where status='core_returned')::integer as core_returned,
      count(*) filter(where status='scrapped')::integer as scrapped
      from inventory_reuse_cases where company_id=$1 and location_id=$2`, [location.company_id, locationId]);
    const custodyRows = await client.query(`select c.id,c.status,c.created_at,c.updated_at,c.completed_at,
      greatest(0,extract(epoch from (coalesce(c.completed_at,now())-c.created_at)))::bigint as age_seconds,
      line.part_number,line.description,unit.serial_number,
      c.asset_id,asset.unit_no,
      c.original_workorder_id,original_workorder.serial as original_workorder_serial,
      c.removal_workorder_id,removal_workorder.serial as removal_workorder_serial,
      receipt.id as receipt_id,receipt.invoice_run_id,receipt.provider as receipt_provider,
      invoice.file_name as invoice_file_name,
      coalesce(invoice.reviewed_draft,invoice.extracted_draft) #>> '{invoiceNumber,value}' as invoice_number,
      line.currency,line.unit_cost,line.cost_source,
      location.name as location_name,position.id as position_id,position.code as position_code,
      position.name as position_name,position_path.path as position_path,
      unit.custody_holder_type,unit.custody_bin_location,unit.custody_external_reference,
      c.intended_route,c.final_route,c.external_reference,c.disposition_occurred_on
      from inventory_reuse_cases c
      join inventory_serialized_units unit on unit.company_id=c.company_id and unit.id=c.unit_id
      join inventory_receipt_lines line on line.company_id=unit.company_id and line.id=unit.receipt_line_id
      join inventory_receipts receipt on receipt.company_id=unit.company_id and receipt.id=unit.receipt_id
      join assets asset on asset.company_id=c.company_id and asset.id=c.asset_id
      join operational_workorders original_workorder on original_workorder.company_id=c.company_id and original_workorder.id=c.original_workorder_id
      left join operational_workorders removal_workorder on removal_workorder.company_id=c.company_id and removal_workorder.id=c.removal_workorder_id
      join locations location on location.company_id=c.company_id and location.id=c.location_id
      left join invoice_extraction_runs invoice on invoice.company_id=receipt.company_id and invoice.id=receipt.invoice_run_id
      left join inventory_positions position on position.company_id=c.company_id and position.location_id=c.location_id
        and position.id=case when c.status='released' then c.release_position_id else unit.current_position_id end
      left join lateral (
        with recursive ancestors as (
          select child.id,child.parent_id,child.name,0 as depth from inventory_positions child
          where child.company_id=c.company_id and child.location_id=c.location_id and child.id=position.id
          union all
          select parent.id,parent.parent_id,parent.name,ancestors.depth+1 from inventory_positions parent
          join ancestors on ancestors.parent_id=parent.id
          where parent.company_id=c.company_id and parent.location_id=c.location_id
        ) select string_agg(name,' / ' order by depth desc) as path from ancestors
      ) position_path on true
      where c.company_id=$1 and c.location_id=$2
      order by (c.status in ('released','core_returned','scrapped')) asc,c.updated_at desc,c.id desc
      limit $3`, [location.company_id, locationId, CUSTODY_LIMIT + 1]);

    // These projections deliberately keep quantity/UOM boundaries intact. A report may
    // compare one item to its position balances, but must never add unlike UOMs together.
    const reconciliation = await client.query(`select i.id as inventory_item_id,i.catalog_part_id,p.part_number,p.description,i.uom_code,
      i.quantity_on_hand as item_quantity_on_hand,i.quantity_reserved as item_quantity_reserved,
      position.quantity as position_quantity,position.quantity_reserved as position_quantity_reserved,
      position.position_count,position.active_position_count,
      (i.quantity_on_hand-position.quantity) as quantity_delta,
      (i.quantity_reserved-position.quantity_reserved) as reserved_delta
      from inventory_items i
      join parts_catalog p on p.company_id=i.company_id and p.id=i.catalog_part_id
      left join lateral (
        select sum(b.quantity) filter(where b.uom_code=i.uom_code) as quantity,
          sum(b.quantity_reserved) filter(where b.uom_code=i.uom_code) as quantity_reserved,
          count(*) filter(where b.uom_code=i.uom_code)::integer as position_count,
          count(*) filter(where b.uom_code=i.uom_code and pos.is_active)::integer as active_position_count
        from inventory_position_balances b
        join inventory_positions pos on pos.company_id=b.company_id and pos.location_id=b.location_id and pos.id=b.position_id
        where b.company_id=i.company_id and b.location_id=i.location_id and b.inventory_item_id=i.id
      ) position on true
      where i.company_id=$1 and i.location_id=$2 and i.source_provider='local'
      order by p.part_number,p.id limit $3 offset $4`, [location.company_id, locationId, REPORT_LIMIT + 1, (page - 1) * REPORT_LIMIT]);
    const openPurchaseOrders = await client.query(`select o.id as order_id,o.number,o.status,o.currency,o.supplier_id,s.name as supplier_name,
      o.created_by as purchaser_id, purchaser.display_name as purchaser_name,
      count(l.id)::integer as line_count,array_agg(l.id order by l.id) as line_ids,
      sum(l.quantity-l.received_quantity-l.cancelled_quantity) as remaining_quantity,
      case when count(*) filter(where l.unit_price is null)>0 then null
        else sum((l.quantity-l.received_quantity-l.cancelled_quantity)*l.unit_price) end as remaining_value
      from inventory_purchase_orders o
      join inventory_purchase_lines l on l.company_id=o.company_id and l.order_id=o.id
      join inventory_suppliers s on s.company_id=o.company_id and s.id=o.supplier_id
      left join user_profiles purchaser on purchaser.id=o.created_by
      where o.company_id=$1 and o.location_id=$2 and o.status in ('awaiting_approval','ordered','partially_received')
        and l.quantity>l.received_quantity+l.cancelled_quantity
      group by o.id,o.number,o.status,o.currency,o.supplier_id,s.name,o.created_by,purchaser.display_name
      order by o.updated_at desc,o.id desc limit $3`, [location.company_id, locationId, REPORT_LIMIT + 1]);
    const receiptBatches = await client.query(`select d.id as delivery_id,d.order_id,d.invoice_run_id,d.received_at,d.status,d.reference,
      o.number as order_number,s.id as supplier_id,s.name as supplier_name,
      coalesce(invoice.reviewed_draft,invoice.extracted_draft) #>> '{invoiceNumber,value}' as invoice_number,
      coalesce(invoice.reviewed_draft,invoice.extracted_draft) #>> '{vendorName,value}' as invoice_vendor,
      count(dl.id)::integer as line_count,
      count(rl.id) filter(where rl.unit_cost is not null)::integer as known_cost_lines,
      count(rl.id) filter(where rl.id is not null and rl.unit_cost is null)::integer as unknown_cost_lines,
      sum(rl.line_total) filter(where rl.line_total is not null) as known_cost_total,
      case when count(distinct generic.currency) filter(where generic.currency is not null)=1 then max(generic.currency) end as currency
      from inventory_purchase_deliveries d
      left join inventory_purchase_orders o on o.company_id=d.company_id and o.id=d.order_id
      left join inventory_suppliers s on s.company_id=o.company_id and s.id=o.supplier_id
      left join invoice_extraction_runs invoice on invoice.company_id=d.company_id and invoice.id=d.invoice_run_id
      left join inventory_purchase_delivery_lines dl on dl.company_id=d.company_id and dl.delivery_id=d.id
      left join local_inventory_receipt_lines rl on rl.company_id=dl.company_id and rl.id=dl.receipt_line_id
      left join inventory_receipt_lines generic on generic.company_id=rl.company_id and generic.id=rl.id
      where d.company_id=$1 and d.location_id=$2
      group by d.id,d.order_id,d.invoice_run_id,d.received_at,d.status,d.reference,o.number,s.id,s.name,invoice.reviewed_draft,invoice.extracted_draft
      order by d.received_at desc,d.id desc limit $3`, [location.company_id, locationId, REPORT_LIMIT + 1]);
    const taskSummary = await client.query(`select t.kind,t.status,count(*)::integer as count,
      count(*) filter(where t.kind='transfer' and coalesce(d.open_count,0)>0)::integer as open_exception_count
      from inventory_stock_tasks t
      left join lateral (select count(*)::integer as open_count from inventory_transfer_discrepancies d where d.company_id=t.company_id and d.task_id=t.id and d.status='open') d on true
      where t.company_id=$1 and (t.location_id=$2 or t.destination_id=$2) and t.status not in ('cancelled','approved','released','scrapped')
        and not (t.kind='transfer' and t.status='received' and t.transfer_state='completed' and coalesce(d.open_count,0)=0)
      group by t.kind,t.status order by t.kind,t.status`, [location.company_id, locationId]);
    const taskItems = await client.query(`select t.id as task_id,t.kind,t.status,t.catalog_part_id,p.part_number,t.quantity,t.completed_quantity,t.uom_code,
      t.location_id,t.destination_id,coalesce(assignment.assigned_user_id,t.created_by) as owner_id,owner.display_name as owner_name,t.reason,t.created_at,t.updated_at,
      count(d.id) filter(where d.status='open')::integer as open_discrepancies,
      array_agg(d.id) filter(where d.status='open') as discrepancy_ids
      from inventory_stock_tasks t join parts_catalog p on p.company_id=t.company_id and p.id=t.catalog_part_id
      left join inventory_transfer_discrepancies d on d.company_id=t.company_id and d.task_id=t.id
      left join inventory_task_assignments assignment on assignment.company_id=t.company_id and assignment.source_id=t.id
        and assignment.source_type=case when t.kind='transfer' then 'transfer_receipt' when t.kind='damage' then 'damage_inspection' end
      left join user_profiles owner on owner.id=coalesce(assignment.assigned_user_id,t.created_by)
      where t.company_id=$1 and (t.location_id=$2 or t.destination_id=$2) and t.status not in ('cancelled','approved','released','scrapped')
        and not (t.kind='transfer' and t.status='received' and t.transfer_state='completed'
          and not exists(select 1 from inventory_transfer_discrepancies open_discrepancy where open_discrepancy.company_id=t.company_id and open_discrepancy.task_id=t.id and open_discrepancy.status='open'))
      group by t.id,p.part_number,assignment.assigned_user_id,owner.display_name order by t.updated_at desc,t.id desc limit $3`, [location.company_id, locationId, REPORT_LIMIT + 1]);
    const noPo = await client.query(`with records as (
      select receipt.id as receipt_id,approval.id as approval_request_id,
        coalesce(approval.status,case when receipt.status='posted' then 'posted' else receipt.status end) as status,
        receipt.posted_at as created_at,approval.decided_at,
        receipt.created_by as purchaser_id,submitter.display_name as purchaser_name,
        approval.decision_by as approver_id,approver.display_name as approver_name,
        receipt.no_purchase_order_reason as reason,totals.amount,totals.currency,
        l.id as location_id,l.name as location_name,
        coalesce(invoice.reviewed_draft,invoice.extracted_draft) #>> '{invoiceNumber,value}' as invoice_number,
        coalesce(invoice.reviewed_draft,invoice.extracted_draft) #>> '{vendorName,value}' as vendor
        from local_inventory_receipts receipt
        join locations l on l.company_id=receipt.company_id and l.id=receipt.location_id
        join user_profiles submitter on submitter.id=receipt.created_by
        left join inventory_direct_receipt_approval_requests approval on approval.company_id=receipt.company_id and approval.receipt_id=receipt.id
        left join user_profiles approver on approver.id=approval.decision_by
        left join invoice_extraction_runs invoice on invoice.company_id=receipt.company_id and invoice.id=receipt.invoice_run_id
        left join lateral (
          select sum(line.line_total) filter(where line.line_total is not null) as amount,
            case when count(distinct generic.currency) filter(where generic.currency is not null)=1 then max(generic.currency) end as currency
          from local_inventory_receipt_lines line
          join inventory_receipt_lines generic on generic.company_id=line.company_id and generic.id=line.id
          where line.company_id=receipt.company_id and line.receipt_id=receipt.id
        ) totals on true
        where receipt.company_id=$1 and receipt.location_id=$2 and receipt.posting_route='no_purchase_order'
      union all
      select null::uuid,request.id,request.status,request.created_at,request.decided_at,
        request.submitted_by,submitter.display_name,request.decision_by,approver.display_name,
        request.original_command #>> '{noPurchaseOrderReason}',
        case when request.original_command #>> '{amount}' ~ '^[0-9]+(\\.[0-9]+)?$' then (request.original_command #>> '{amount}')::numeric end,
        nullif(request.original_command #>> '{currency}',''),l.id,l.name,null::text,
        nullif(request.original_command #>> '{sourceReference}','')
        from inventory_direct_receipt_approval_requests request
        join locations l on l.company_id=request.company_id and l.id=request.location_id
        join user_profiles submitter on submitter.id=request.submitted_by
        left join user_profiles approver on approver.id=request.decision_by
        where request.company_id=$1 and request.location_id=$2 and request.receipt_id is null
      ) select * from records order by created_at desc,coalesce(receipt_id,approval_request_id) desc limit $3`, [location.company_id, locationId, REPORT_LIMIT + 1]);
    const noPoTrend = await client.query(`with records as (
      select receipt.posted_at as occurred_at,coalesce(approval.status,'posted') as status,totals.amount,totals.currency
        from local_inventory_receipts receipt
        left join inventory_direct_receipt_approval_requests approval on approval.company_id=receipt.company_id and approval.receipt_id=receipt.id
        left join lateral (
          select sum(line.line_total) filter(where line.line_total is not null) as amount,
            case when count(distinct generic.currency) filter(where generic.currency is not null)=1 then max(generic.currency) end as currency
          from local_inventory_receipt_lines line
          join inventory_receipt_lines generic on generic.company_id=line.company_id and generic.id=line.id
          where line.company_id=receipt.company_id and line.receipt_id=receipt.id
        ) totals on true
        where receipt.company_id=$1 and receipt.location_id=$2 and receipt.posting_route='no_purchase_order'
      union all
      select request.created_at,request.status,
        case when request.original_command #>> '{amount}' ~ '^[0-9]+(\\.[0-9]+)?$' then (request.original_command #>> '{amount}')::numeric end,
        nullif(request.original_command #>> '{currency}','')
        from inventory_direct_receipt_approval_requests request
        where request.company_id=$1 and request.location_id=$2 and request.receipt_id is null
      ) select date_trunc('month',occurred_at)::date as month,currency,count(*)::integer as count,
        count(*) filter(where status='approved')::integer as approved,
        count(*) filter(where status='pending')::integer as pending,
        sum(amount) filter(where amount is not null) as amount
        from records where occurred_at>=date_trunc('month',current_date)-interval '11 months'
        group by 1,2 order by 1,2`, [location.company_id, locationId]);

    await client.query("commit");
    return {
      locationName: location.name,
      page,
      hasMore: stock.rows.length > 100,
      stock: stock.rows.slice(0, 100),
      commitments: commitments.rows,
      transit: transfers.rows.filter((row) => Number(row.in_transit_quantity) > 0),
      transfers: transfers.rows,
      costCoverage: coverage.rows[0],
      bills: bills.rows,
      custody: {
        summary: custodySummary.rows[0],
        items: custodyRows.rows.slice(0, CUSTODY_LIMIT),
        hasMore: custodyRows.rows.length > CUSTODY_LIMIT,
        limit: CUSTODY_LIMIT,
      },
      reconciliation: { rows: reconciliation.rows.slice(0, REPORT_LIMIT), limit: REPORT_LIMIT, hasMore: reconciliation.rows.length > REPORT_LIMIT },
      openPurchaseOrders: { items: openPurchaseOrders.rows.slice(0, REPORT_LIMIT), limit: REPORT_LIMIT, hasMore: openPurchaseOrders.rows.length > REPORT_LIMIT },
      receiptBatches: { items: receiptBatches.rows.slice(0, REPORT_LIMIT), limit: REPORT_LIMIT, hasMore: receiptBatches.rows.length > REPORT_LIMIT },
      tasks: { summary: taskSummary.rows, items: taskItems.rows.slice(0, REPORT_LIMIT), limit: REPORT_LIMIT, hasMore: taskItems.rows.length > REPORT_LIMIT },
      noPo: { items: noPo.rows.slice(0, REPORT_LIMIT), trend: noPoTrend.rows, limit: REPORT_LIMIT, hasMore: noPo.rows.length > REPORT_LIMIT, trendMonths: 12 },
    };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
