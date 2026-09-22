import { readApprovalPolicy, canApprovePurchase } from './purchase-approval-settings.repo.js';
import { createHash, randomUUID } from "node:crypto";
import { getPool } from "../pool.js";
import { InventoryError, inventoryNotFound } from "../../modules/inventory/inventory.errors.js";
import { getUnitDefinition } from "../../../../shared/units-of-measure.js";

const fail = (message, code = "INVENTORY_PURCHASE_CONFLICT") => { throw new InventoryError(message, { code, statusCode: 409 }); };
async function location(client, input) {
  const result = await client.query(`select id,company_id from locations where id=$1 and company_id=any($2::uuid[]) and ($4::boolean or id=any($3::uuid[])) and active=true`, [input.locationId,input.companyIds,input.locationIds,input.isAdmin]);
  if (!result.rows[0]) throw inventoryNotFound();
  return result.rows[0];
}
async function orderDetail(client, companyId, orderId) {
  const result = await client.query(`select o.*,(select sum(l.quantity*l.unit_price) from inventory_purchase_lines l where l.company_id=o.company_id and l.order_id=o.id having count(*)=count(l.unit_price)) as total,to_char(o.expected_delivery_date,'YYYY-MM-DD') as expected_delivery_date,s.name as supplier_name from inventory_purchase_orders o join inventory_suppliers s on s.company_id=o.company_id and s.id=o.supplier_id where o.company_id=$1 and o.id=$2`, [companyId,orderId]);
  const lines = await client.query(`select l.*,coalesce(p.tracking_mode,l.tracking_mode) as tracking_mode,p.version as part_version,coalesce(p.uom_code,l.uom_code) as current_uom_code,
    coalesce((select jsonb_agg(jsonb_build_object('sourceType',source.source_type,'sourceId',source.source_id,
      'plannedQuantity',source.planned_quantity,'receivedQuantity',source.received_quantity,'cancelledQuantity',source.cancelled_quantity)
      order by source.created_at,source.source_type,source.source_id)
      from inventory_purchase_line_sources source where source.company_id=l.company_id and source.purchase_line_id=l.id),'[]'::jsonb) as demand_sources
    from inventory_purchase_lines l left join parts_catalog p on p.company_id=l.company_id and p.id=l.catalog_part_id where l.company_id=$1 and l.order_id=$2 order by l.id`, [companyId,orderId]);
  return { ...result.rows[0], lines: lines.rows };
}
async function purchasingDemand(client, companyId, locationId, catalogPartId = null, uomCode = null) {
  const result = await client.query(`with request_supply as (
      select pa.part_request_id,pa.uom_code,sum(pa.quantity) as quantity
      from part_allocations pa
      where pa.status not in ('proposed','cancelled','returned') and pa.source_type<>'purchase'
      group by pa.part_request_id,pa.uom_code
    ), workorder_rows as (
      select pr.id,pr.catalog_part_id,pr.uom_code,wo.id as workorder_id,wo.serial as workorder_serial,
        greatest(pr.quantity-coalesce(supply.quantity,0),0) as requested_quantity
      from workorder_part_requests pr
      join operational_workorders wo on wo.id=pr.workorder_id
      left join request_supply supply on supply.part_request_id=pr.id and supply.uom_code=pr.uom_code
      where wo.company_id=$1 and wo.location_id=$2
        and wo.status not in ('mechanic_done','closed','odoo_entered','cancelled')
        and pr.catalog_part_id is not null and pr.approval_status='approved'
        and pr.usage_status not in ('installed','not_used','returned')
        and pr.quantity>coalesce(supply.quantity,0)
    ), workorder_demand as (
      select catalog_part_id,uom_code,sum(requested_quantity) as quantity,
        jsonb_agg(jsonb_build_object(
          'requestId',id,'workorderId',workorder_id,'workorderNumber',workorder_serial,
          'requestedQuantity',requested_quantity,'uomCode',uom_code
        ) order by workorder_serial,id) as workorders
      from workorder_rows group by catalog_part_id,uom_code
    ), legacy_demand as (
      select request.catalog_part_id,request.uom_code,sum(request.quantity) as quantity,
        jsonb_agg(jsonb_build_object(
          'requestId',request.id,'requestedQuantity',request.quantity,'uomCode',request.uom_code,
          'description',request.description
        ) order by request.created_at,request.id) as requests
      from inventory_purchase_requests request
      where request.company_id=$1 and request.location_id=$2 and request.status='approved'
        and request.workorder_id is null and request.catalog_part_id is not null
      group by request.catalog_part_id,request.uom_code
    ), stock as (
      select catalog_part_id,uom_code,sum(quantity_on_hand) as on_hand,sum(quantity_reserved) as reserved
      from inventory_items
      where company_id=$1 and location_id=$2 and source_provider='local' and catalog_part_id is not null
      group by catalog_part_id,uom_code
    ), incoming as (
      select line.catalog_part_id,line.uom_code,sum(line.quantity-line.received_quantity-line.cancelled_quantity) as quantity
      from inventory_purchase_lines line
      join inventory_purchase_orders purchase on purchase.company_id=line.company_id and purchase.id=line.order_id
      where line.company_id=$1 and purchase.location_id=$2
        and (purchase.status in ('ordered','partially_received') or (
          purchase.status in ('draft','awaiting_approval') and exists (
            select 1 from inventory_purchase_line_sources source
            where source.company_id=line.company_id and source.purchase_line_id=line.id
          )
        ))
      group by line.catalog_part_id,line.uom_code
    ), demand_keys as (
      select catalog_part_id,uom_code from workorder_demand
      union
      select catalog_part_id,uom_code from legacy_demand
      union
      select policy.catalog_part_id,part.uom_code
      from inventory_stocking_policies policy
      join parts_catalog part on part.company_id=policy.company_id and part.id=policy.catalog_part_id
      where policy.company_id=$1 and policy.location_id=$2 and policy.alert_enabled=true
    ), calculated as (
      select key.catalog_part_id,key.uom_code,part.part_number,part.description,part.tracking_mode,
        coalesce(work.quantity,0) as workorder_quantity,
        coalesce(legacy.quantity,0) as legacy_quantity,
        greatest(coalesce(stock.on_hand,0)-coalesce(stock.reserved,0),0) as available_quantity,
        coalesce(stock.on_hand,0) as on_hand_quantity,coalesce(stock.reserved,0) as reserved_quantity,
        coalesce(incoming.quantity,0) as incoming_quantity,
        policy.minimum_available,policy.target_quantity,coalesce(work.workorders,'[]'::jsonb) as workorders,
        coalesce(legacy.requests,'[]'::jsonb) as legacy_requests,
        case when policy.catalog_part_id is not null
          and greatest(coalesce(stock.on_hand,0)-coalesce(stock.reserved,0),0)+coalesce(incoming.quantity,0)-coalesce(work.quantity,0)-coalesce(legacy.quantity,0)<=policy.minimum_available
          then coalesce(policy.target_quantity,policy.minimum_available) else 0 end as replenishment_quantity
      from demand_keys key
      join parts_catalog part on part.company_id=$1 and part.id=key.catalog_part_id and part.uom_code=key.uom_code
      left join workorder_demand work on work.catalog_part_id=key.catalog_part_id and work.uom_code=key.uom_code
      left join legacy_demand legacy on legacy.catalog_part_id=key.catalog_part_id and legacy.uom_code=key.uom_code
      left join stock on stock.catalog_part_id=key.catalog_part_id and stock.uom_code=key.uom_code
      left join incoming on incoming.catalog_part_id=key.catalog_part_id and incoming.uom_code=key.uom_code
      left join inventory_stocking_policies policy on policy.company_id=$1 and policy.location_id=$2
        and policy.catalog_part_id=key.catalog_part_id and policy.alert_enabled=true
      where ($3::uuid is null or key.catalog_part_id=$3) and ($4::text is null or key.uom_code=$4)
    )
    select *,greatest(workorder_quantity+legacy_quantity+replenishment_quantity-available_quantity-incoming_quantity,0) as buy_quantity,
      case when legacy_quantity>0 and (workorder_quantity>0 or replenishment_quantity>0) then 'mixed'
        when legacy_quantity>0 then 'legacy'
        when workorder_quantity>0 and replenishment_quantity>0 then 'both'
        when workorder_quantity>0 then 'workorder' else 'minimum_stock' end as source
    from calculated
    where workorder_quantity>0 or legacy_quantity>0 or replenishment_quantity>0
    order by part_number,catalog_part_id`,[companyId,locationId,catalogPartId,uomCode]);
  return result.rows.filter(row=>Number(row.buy_quantity)>0);
}
export async function readPurchaseOrderForReceipt(input) {
  const client = await getPool().connect();
  try {
    const shop = await location(client, input);
    const order = await orderDetail(client, shop.company_id, input.orderId);
    if (!order || order.location_id !== shop.id) throw inventoryNotFound();
    return order;
  } finally { client.release(); }
}
export async function readPurchasing(input) {
  const client = await getPool().connect();
  try {
    const shop = await location(client,input);
    const suppliers = await client.query("select id,name,contact from inventory_suppliers where company_id=$1 and active=true order by lower(name) limit 500", [shop.company_id]);
    const orders = await client.query(`select id from inventory_purchase_orders where company_id=$1 and location_id=$2 and ($4::boolean=false or status in ('ordered','partially_received')) and ($5='all' or status=$5) and ($6='' or supplier_id=nullif($6,'')::uuid) and ($7='' or number ilike '%'||$7||'%' or supplier_id in (select id from inventory_suppliers where company_id=$1 and name ilike '%'||$7||'%')) order by created_at desc,id desc limit 26 offset $3`,[shop.company_id,shop.id,(input.page-1)*25,input.view==='receiving',input.status||'all',input.supplierId||'',input.query||'']);
    const items = [];
    for (const row of orders.rows.slice(0,25)) items.push(await orderDetail(client,shop.company_id,row.id));
    const demand=await purchasingDemand(client,shop.company_id,shop.id);
    const receipts=await client.query(`select r.id,r.posted_at,r.source_type,r.source_reference,l.part_number,l.quantity,l.uom_code from local_inventory_receipts r join local_inventory_receipt_lines l on l.company_id=r.company_id and l.receipt_id=r.id where r.company_id=$1 and r.location_id=$2 order by r.posted_at desc,r.id desc,l.line_index limit 25`,[shop.company_id,shop.id]);
    const approvalPolicy=await readApprovalPolicy(client,shop.company_id);
    return { suppliers:suppliers.rows,items,demand,receipts:receipts.rows,hasMore:orders.rows.length>25,page:input.page,
      purchaseDefaults:{currency:approvalPolicy?.currency||'USD',approvalConfigured:Boolean(approvalPolicy)},
      canApprove:await canApprovePurchase(client,shop.company_id,input.actorId,approvalPolicy) };
  } finally { client.release(); }
}
export async function purchaseCommand(input) {
  const client=await getPool().connect();
  try {
    await client.query("begin");
    const shop=await location(client,input);
    const requestHash=createHash("sha256").update(JSON.stringify(input.command)).digest("hex");
    const command=input.command;
    await client.query("select pg_advisory_xact_lock(hashtext($1))",[`purchase-command:${shop.company_id}:${input.actorId}:${command.idempotencyKey}`]);
    const prior=await client.query("select request_hash,result from inventory_workflow_commands where company_id=$1 and actor_id=$2 and idempotency_key=$3",[shop.company_id,input.actorId,command.idempotencyKey]);
    if(prior.rows[0]) {
      if(prior.rows[0].request_hash!==requestHash)fail("This command was already used with different details.");
      await client.query("commit"); return {...prior.rows[0].result,replayed:true};
    }
    let result;
    if(command.action==='supplier') {
      const supplier=await client.query(`insert into inventory_suppliers(company_id,name,contact) values($1,$2,$3) on conflict do nothing returning id,name,contact`,[shop.company_id,command.name,command.contact]);
      if(!supplier.rows[0])fail("A supplier with this name already exists. Select that supplier.");
      result={supplier:supplier.rows[0]};
    } else {
      let orderId=command.orderId;
      if(['create','revise'].includes(command.action)) {
        const supplier=await client.query("select id from inventory_suppliers where company_id=$1 and id=$2 and active=true for share",[shop.company_id,command.supplierId]);
        if(!supplier.rows[0])throw inventoryNotFound();
        if(new Set(command.lines.map(line=>line.catalogPartId||String(line.partNumber).trim().toUpperCase())).size!==command.lines.length)fail("Combine repeated parts into one order line.");
        if(command.action==='revise') {
          const existing=await client.query('select * from inventory_purchase_orders where company_id=$1 and location_id=$2 and id=$3 for update',[shop.company_id,shop.id,orderId]);
          if(!existing.rows[0])throw inventoryNotFound();
          if(existing.rows[0].status!=='draft'||existing.rows[0].version!==command.expectedVersion)fail('Only the current draft revision can be edited.');
          const linked=await client.query(`select 1 from inventory_purchase_line_sources source join inventory_purchase_lines line on line.company_id=source.company_id and line.id=source.purchase_line_id where line.company_id=$1 and line.order_id=$2 limit 1`,[shop.company_id,orderId]);
          if(linked.rows[0])fail('A Needs ordering draft keeps its demand links. Cancel it and add the refreshed demand to a new purchase order.','INVENTORY_PURCHASE_DEMAND_LINKED');
          await client.query('delete from inventory_purchase_lines where company_id=$1 and order_id=$2',[shop.company_id,orderId]);
          await client.query('update inventory_purchase_orders set supplier_id=$3,currency=$4,notes=$5,expected_delivery_date=$6,version=version+1,updated_at=now() where company_id=$1 and id=$2',[shop.company_id,orderId,command.supplierId,command.currency,command.notes,command.expectedDeliveryDate]);
        } else {
          orderId=randomUUID();
          await client.query(`insert into inventory_purchase_orders(id,company_id,location_id,supplier_id,created_by,number,currency,notes,expected_delivery_date) values($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[orderId,shop.company_id,shop.id,command.supplierId,input.actorId,`PO-${orderId.slice(0,8).toUpperCase()}`,command.currency,command.notes,command.expectedDeliveryDate]);
        }
        for(const line of [...command.lines].sort((a,b)=>String(a.catalogPartId||a.partNumber).localeCompare(String(b.catalogPartId||b.partNumber)))) {
          const selected=await client.query("select * from parts_catalog where company_id=$1 and id=$2 for share",[shop.company_id,line.catalogPartId]);
          const part=line.catalogPartId?selected.rows[0]:{part_number:line.partNumber,description:line.description||line.partNumber,uom_code:line.uomCode,tracking_mode:line.trackingMode}; if(!part)throw inventoryNotFound();
          if(!part.part_number)fail('Enter the part number or description.');
          const unit=getUnitDefinition(part.uom_code);
          if(!part.tracking_mode || !unit || unit.category==='time')fail("Review physical part tracking and stocking unit before ordering.");
          if(part.tracking_mode==='serialized'&&!Number.isInteger(line.quantity))fail('Serialized order quantities must be whole units.');
          if(Math.round(line.quantity*10**unit.decimalScale)/10**unit.decimalScale!==line.quantity)fail("Quantity does not match the stocking unit precision.");
          if(line.demandSources.length) {
            if(!part.id)fail('Automatic demand must use a catalog part.');
            await client.query('select pg_advisory_xact_lock(hashtext($1))',[`purchase-demand:${shop.company_id}:${shop.id}:${part.id}:${part.uom_code}`]);
            const [currentDemand]=await purchasingDemand(client,shop.company_id,shop.id,part.id,part.uom_code);
            if(!currentDemand||Number(line.quantity)>Number(currentDemand.buy_quantity)+0.0005)fail('Demand changed. Refresh Needs ordering before adding it to a purchase order.','INVENTORY_PURCHASE_DEMAND_STALE');
            const planned=line.demandSources.reduce((sum,source)=>sum+Number(source.plannedQuantity),0);
            if(Math.abs(planned-Number(line.quantity))>0.0005)fail('Demand sources must explain the full purchase quantity.');
            const workorders=new Map((currentDemand.workorders||[]).map(row=>[row.requestId,Number(row.requestedQuantity)]));
            const legacyRequests=new Map((currentDemand.legacy_requests||[]).map(row=>[row.requestId,Number(row.requestedQuantity)]));
            let workorderPlanned=0,legacyPlanned=0,policyPlanned=0;
            for(const source of line.demandSources) {
              if(source.sourceType==='workorder_request') {
                if(!workorders.has(source.sourceId)||Number(source.plannedQuantity)>workorders.get(source.sourceId)+0.0005)fail('A Workorder demand source changed. Refresh Needs ordering.','INVENTORY_PURCHASE_DEMAND_STALE');
                workorderPlanned+=Number(source.plannedQuantity);
              } else if(source.sourceType==='stocking_policy') {
                if(source.sourceId!==part.id)fail('The stock-policy source does not match this part.');
                policyPlanned+=Number(source.plannedQuantity);
              } else if(source.sourceType==='legacy_request') {
                if(!legacyRequests.has(source.sourceId)||Number(source.plannedQuantity)>legacyRequests.get(source.sourceId)+0.0005)fail('A legacy demand source changed. Refresh Needs ordering.','INVENTORY_PURCHASE_DEMAND_STALE');
                legacyPlanned+=Number(source.plannedQuantity);
              } else fail('The purchase demand source is not supported.');
            }
            if(workorderPlanned>Number(currentDemand.workorder_quantity)+0.0005||legacyPlanned>Number(currentDemand.legacy_quantity)+0.0005||policyPlanned>Number(currentDemand.replenishment_quantity)+0.0005)fail('Demand source quantities changed. Refresh Needs ordering.','INVENTORY_PURCHASE_DEMAND_STALE');
          }
          const insertedLine=await client.query(`insert into inventory_purchase_lines(company_id,order_id,catalog_part_id,part_number,description,uom_code,quantity,unit_price,tracking_mode) values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,[shop.company_id,orderId,part.id,part.part_number,part.description,part.uom_code,line.quantity,line.unitPrice,part.tracking_mode]);
          for(const source of line.demandSources) await client.query(`insert into inventory_purchase_line_sources(company_id,purchase_line_id,source_type,source_id,planned_quantity) values($1,$2,$3,$4,$5)`,[shop.company_id,insertedLine.rows[0].id,source.sourceType,source.sourceId,source.plannedQuantity]);
        }
        if(command.placeOrder) await placePurchase(client,shop.company_id,orderId,input.actorId);
      } else {
        const selected=await client.query("select * from inventory_purchase_orders where company_id=$1 and location_id=$2 and id=$3 for update",[shop.company_id,shop.id,orderId]);
        const order=selected.rows[0]; if(!order)throw inventoryNotFound();
        if(order.version!==command.expectedVersion)fail("The order changed. Refresh it before continuing.");
        let status=order.status;
        if(['submit','place'].includes(command.action) && status==='draft') {
          status=await placePurchase(client,shop.company_id,orderId,input.actorId);
        } else if(command.action==='approve' && status==='awaiting_approval') {
          const policy=await readApprovalPolicy(client,shop.company_id,true);
          if(!await canApprovePurchase(client,shop.company_id,input.actorId,policy)) throw new InventoryError('You are not an authorized purchase order approver.',{code:'PURCHASE_APPROVAL_FORBIDDEN',statusCode:403});
          status='ordered';
          await client.query('update inventory_purchase_orders set placed_at=now(),placed_by=$3 where company_id=$1 and id=$2',[shop.company_id,orderId,input.actorId]);
        }
        else if(command.action==='receive') fail('Record the delivered quantities. Purchase order status follows accepted stock.', 'INVENTORY_PURCHASE_RECEIPT_LINES_REQUIRED');
        else if(command.action==='cancel' && !['received','cancelled'].includes(status) && command.reason){
          const receiptState=await client.query(`select exists(
            select 1 from inventory_purchase_lines where company_id=$1 and order_id=$2 and received_quantity>0
            union all
            select 1 from inventory_purchase_deliveries delivery
            join inventory_purchase_delivery_lines line on line.company_id=delivery.company_id and line.delivery_id=delivery.id
            where delivery.company_id=$1 and delivery.order_id=$2 and delivery.status='posted'
              and (line.actual_quantity>0 or line.expected_quantity>0)
          ) as has_delivery_activity`,[shop.company_id,orderId]);
          status=receiptState.rows[0].has_delivery_activity?'closed_with_discrepancy':'cancelled';
          await client.query("update inventory_purchase_lines set cancelled_quantity=quantity-received_quantity where company_id=$1 and order_id=$2",[shop.company_id,orderId]);
        } else if(command.action==='record_sent' && status==='ordered' && command.reason){
          await client.query("update inventory_purchase_orders set communication_reference=$3 where company_id=$1 and id=$2",[shop.company_id,orderId,command.reason]);
        } else fail("This action is not permitted for the order's current state and your access.");
        await client.query("update inventory_purchase_orders set status=$3,version=version+1,updated_at=now() where company_id=$1 and id=$2",[shop.company_id,orderId,status]);
      }
      await client.query("insert into inventory_purchase_events(company_id,order_id,actor_id,action,details) values($1,$2,$3,$4,$5)",[shop.company_id,orderId,input.actorId,command.action,JSON.stringify(command)]);
      result={order:await orderDetail(client,shop.company_id,orderId)};
    }
    await client.query("insert into inventory_workflow_commands(company_id,actor_id,idempotency_key,request_hash,result,location_id) values($1,$2,$3,$4,$5,$6)",[shop.company_id,input.actorId,command.idempotencyKey,requestHash,JSON.stringify(result),shop.id]);
    await client.query("commit");return result;
  } catch(error){await client.query("rollback").catch(()=>{});throw error;}finally{client.release();}
}

export async function readPurchaseCommand(input) {
  const client=await getPool().connect();
  try {
    const shop=await location(client,input);
    const result=await client.query('select result from inventory_workflow_commands where company_id=$1 and location_id=$2 and actor_id=$3 and idempotency_key=$4',[shop.company_id,shop.id,input.actorId,input.idempotencyKey]);
    return result.rows[0]?{status:'posted',...result.rows[0].result}:{status:'not_found'};
  } finally {client.release();}
}

async function placePurchase(client, companyId, orderId, actorId) {
  const policy = await readApprovalPolicy(client,companyId,true);
  if (!policy) fail('Configure Purchase Order Approval in Settings before placing an order.', 'PURCHASE_APPROVAL_NOT_CONFIGURED');
  // PostgreSQL numeric arithmetic preserves the exact threshold at equality.
  const result = await client.query(`select o.currency,count(l.id)::integer as lines,
    count(l.unit_price)::integer as priced_lines,
    coalesce(bool_or(l.unit_price is null),false) or coalesce(sum(l.quantity*l.unit_price)>$3::numeric,false) as needs_approval
    from inventory_purchase_orders o join inventory_purchase_lines l on l.company_id=o.company_id and l.order_id=o.id
    where o.company_id=$1 and o.id=$2 group by o.id`, [companyId,orderId,policy.approval_limit]);
  const order=result.rows[0];
  if (!order || !order.lines) fail('Add at least one part before placing the order.');
  if (order.currency!==policy.currency) fail(`The approval limit is in ${policy.currency}. Use that currency or update Purchase Order Approval in Settings.`, 'PURCHASE_APPROVAL_CURRENCY');
  // An incomplete commercial total cannot be bounded, so it always requires the configured approval path.
  const status=order.needs_approval?'awaiting_approval':'ordered';
  await client.query(`update inventory_purchase_orders set status=$3,
    placed_at=case when $3='ordered' then now() else null end,
    placed_by=case when $3='ordered' then $4::uuid else null end where company_id=$1 and id=$2`, [companyId,orderId,status,actorId]);
  return status;
}
