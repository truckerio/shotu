import { createHash } from 'node:crypto';
import { getPool } from '../pool.js';
import { getUnitDefinition } from '../../../../shared/units-of-measure.js';
import { InventoryError, inventoryNotFound } from '../../modules/inventory/inventory.errors.js';

function conflict(message) {
  throw new InventoryError(message, { code:'PURCHASE_REQUEST_CONFLICT', statusCode:409 });
}
async function location(client, input) {
  const result = await client.query(`select id,company_id from locations where id=$1 and company_id=any($2::uuid[])
    and ($4::boolean or id=any($3::uuid[])) and active=true`, [input.locationId,input.companyIds,input.locationIds,input.isAdmin]);
  if (!result.rows[0]) throw inventoryNotFound();
  return result.rows[0];
}
// Suggestions and saved requests share one list; work order requests are deliberately independent.
const suggestionsSql = `select p.id as catalog_part_id,p.part_number,p.description,p.uom_code,
  greatest(coalesce(policy.target_quantity,policy.minimum_available)-coalesce(stock.quantity_on_hand-stock.quantity_reserved,0)-coalesce(incoming.quantity,0),0) as quantity
  from inventory_stocking_policies policy
  join parts_catalog p on p.company_id=policy.company_id and p.id=policy.catalog_part_id
  left join inventory_items stock on stock.company_id=policy.company_id and stock.location_id=policy.location_id
    and stock.catalog_part_id=p.id and stock.source_provider='local' and stock.uom_code=p.uom_code
  left join lateral(select sum(l.quantity-l.received_quantity-l.cancelled_quantity) as quantity
    from inventory_purchase_lines l join inventory_purchase_orders o on o.company_id=l.company_id and o.id=l.order_id
    where l.company_id=policy.company_id and l.catalog_part_id=p.id and o.location_id=policy.location_id
      and o.status in ('ordered','partially_received')) incoming on true
  where policy.company_id=$1 and policy.location_id=$2 and policy.alert_enabled=true
    and coalesce(stock.quantity_on_hand-stock.quantity_reserved,0)<=policy.minimum_available
    and not exists(select 1 from inventory_purchase_requests r where r.company_id=$1 and r.location_id=$2
      and r.catalog_part_id=p.id and (r.status in ('approval_waiting','approved')
        or (r.status='added' and r.added_at>=greatest(policy.updated_at,stock.updated_at))))`;

export async function readPurchaseRequests(input) {
  const client=await getPool().connect();
  try {
    const shop=await location(client,input);
    if (input.workorderId) {
      const workorder=await client.query('select id from operational_workorders where id=$1 and company_id=$2 and location_id=$3',[input.workorderId,shop.company_id,shop.id]);
      if (!workorder.rows[0]) throw inventoryNotFound();
      const requests=await client.query(`select r.*,approver.display_name as approved_by_name,buyer.display_name as added_by_name,
        (select coalesce(sum(stock.quantity_on_hand-stock.quantity_reserved),0) from inventory_items stock
          where stock.company_id=r.company_id and stock.location_id=$3 and stock.catalog_part_id=r.catalog_part_id
            and stock.uom_code=r.uom_code and stock.source_provider='local') as available_quantity
        from inventory_purchase_requests r
        left join user_profiles approver on approver.id=r.approved_by
        left join user_profiles buyer on buyer.id=r.added_by
        where r.company_id=$1 and r.workorder_id=$2 order by r.created_at,r.id`,[shop.company_id,input.workorderId,shop.id]);
      return {items:requests.rows,hasMore:false,page:1};
    }
    const result=await client.query(`with suggestions as (${suggestionsSql}), queue as (
      select to_jsonb(r)||jsonb_build_object('approved_by_name',approver.display_name,'added_by_name',buyer.display_name) as item,
        r.created_at as sort_date, r.id as sort_id, false as is_suggestion
      from inventory_purchase_requests r
      left join user_profiles approver on approver.id=r.approved_by
      left join user_profiles buyer on buyer.id=r.added_by
      where r.company_id=$1 and r.location_id=$2
        and (($3='needs_ordering' and r.status in ('approval_waiting','approved')) or r.status=$3)
      union all
      select to_jsonb(s)||jsonb_build_object('id',s.catalog_part_id,'category','suggestion','status','suggestion','notes','','supplier',''),
        null::timestamptz,s.catalog_part_id,true
      from suggestions s where $3='needs_ordering' and s.quantity>0
    ) select item from queue order by is_suggestion,sort_date desc,sort_id limit 26 offset $4`,
    [shop.company_id,shop.id,input.status,(input.page-1)*25]);
    return { items:result.rows.slice(0,25).map(row=>row.item),hasMore:result.rows.length>25,page:input.page };
  } finally { client.release(); }
}

function validateQuantity(quantity, uomCode) {
  const unit=getUnitDefinition(uomCode);
  if (!unit || unit.category==='time') conflict('Choose a physical stocking unit.');
  if (Math.round(quantity*10**unit.decimalScale)/10**unit.decimalScale!==quantity) conflict('Quantity does not match the stocking unit precision.');
}

export async function savePurchaseRequest(input) {
  const client=await getPool().connect();
  try {
    await client.query('begin');
    const shop=await location(client,input), command=input.command;
    const requestHash=createHash('sha256').update(JSON.stringify(command)).digest('hex');
    await client.query('select pg_advisory_xact_lock(hashtext($1))',[`purchase-command:${shop.company_id}:${input.actorId}:${command.idempotencyKey}`]);
    const previous=await client.query('select request_hash,result from inventory_workflow_commands where company_id=$1 and actor_id=$2 and idempotency_key=$3',[shop.company_id,input.actorId,command.idempotencyKey]);
    if (previous.rows[0]) {
      if (previous.rows[0].request_hash!==requestHash) conflict('This command was already used with different details.');
      await client.query('commit');
      return {...previous.rows[0].result,replayed:true};
    }
    let request;
    if (command.action==='request_create') {
      if (command.workorderId) {
        const workorder=await client.query('select status from operational_workorders where id=$1 and company_id=$2 and location_id=$3 for share',[command.workorderId,shop.company_id,shop.id]);
        if (!workorder.rows[0]) throw inventoryNotFound();
        if (['mechanic_done','closed','odoo_entered','cancelled'].includes(workorder.rows[0].status)) conflict('Parts cannot be requested on a completed work order.');
      }
      validateQuantity(command.quantity,command.uomCode);
      let partNumber=command.partNumber;
      if (command.catalogPartId) {
        const part=await client.query('select part_number,uom_code,tracking_mode from parts_catalog where company_id=$1 and id=$2 for share',[shop.company_id,command.catalogPartId]);
        if (!part.rows[0]) throw inventoryNotFound();
        if (part.rows[0].uom_code!==command.uomCode) conflict('The stocking unit changed. Select the part again.');
        if (part.rows[0].tracking_mode==='serialized'&&!Number.isInteger(command.quantity)) conflict('Serialized quantities must be whole units.');
        partNumber=part.rows[0].part_number;
      }
      if (command.category==='suggestion') {
        if (!command.catalogPartId) conflict('Select a stock suggestion.');
        await client.query('select pg_advisory_xact_lock(hashtext($1))',[`purchase-suggestion:${shop.id}:${command.catalogPartId}`]);
        const suggestions=await client.query(suggestionsSql,[shop.company_id,shop.id]);
        if (!suggestions.rows.some(row=>row.catalog_part_id===command.catalogPartId && Number(row.quantity)>0)) conflict('This suggestion changed or already has a request. Refresh the list.');
      }
      const saved=await client.query(`insert into inventory_purchase_requests(company_id,location_id,catalog_part_id,category,
        part_number,description,quantity,uom_code,supplier,notes,created_by,workorder_id)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning *`,
      [shop.company_id,shop.id,command.catalogPartId,command.category,partNumber,command.description,command.quantity,command.uomCode,command.supplier,command.notes,input.actorId,command.workorderId||null]);
      request=saved.rows[0];
    } else {
      const existing=await client.query('select * from inventory_purchase_requests where company_id=$1 and location_id=$2 and id=$3 for update',[shop.company_id,shop.id,command.requestId]);
      request=existing.rows[0];
      if (!request) throw inventoryNotFound();
      if (request.version!==command.expectedVersion) conflict('This request changed. Refresh before continuing.');
      let saved;
      if (command.action==='request_approve') {
        if (request.status!=='approval_waiting') conflict('Only a request waiting for approval can be approved.');
        saved=await client.query(`update inventory_purchase_requests set status='approved',approved_by=$2,approved_at=now(),version=version+1,updated_at=now() where id=$1 returning *`,[request.id,input.actorId]);
      } else if (command.action==='request_update') {
        if (request.status!=='approved') conflict('Approve the request before updating it.');
        validateQuantity(command.quantity,request.uom_code);
        saved=await client.query(`update inventory_purchase_requests set quantity=$2,supplier=$3,notes=$4,version=version+1,updated_at=now() where id=$1 returning *`,[request.id,command.quantity,command.supplier,command.notes]);
      } else if (command.action==='request_add') {
        conflict('Receive the approved request into inventory to mark it Added.');
      } else conflict('Unknown request action.');
      request=saved.rows[0];
    }
    await client.query('insert into inventory_purchase_request_events(company_id,request_id,actor_id,action,details) values($1,$2,$3,$4,$5)',[shop.company_id,request.id,input.actorId,command.action,JSON.stringify(request)]);
    const result={request};
    await client.query('insert into inventory_workflow_commands(company_id,location_id,actor_id,idempotency_key,request_hash,result) values($1,$2,$3,$4,$5,$6)',[shop.company_id,shop.id,input.actorId,command.idempotencyKey,requestHash,JSON.stringify(result)]);
    await client.query('commit');
    return result;
  } catch(error) {
    await client.query('rollback').catch(()=>{});
    if(error.code==='23505'&&error.constraint==='inventory_purchase_request_active_suggestion') conflict('This suggestion already has an active request. Refresh the list.');
    throw error;
  } finally { client.release(); }
}
