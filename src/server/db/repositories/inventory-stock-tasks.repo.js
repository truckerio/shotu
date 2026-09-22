import { inventoryTokenFromCode,readInventoryQrToken } from '../../modules/inventory/inventory-qr.js';
import { createHash,randomUUID } from 'node:crypto';
import { getPool } from '../pool.js';
import { InventoryError,inventoryNotFound } from '../../modules/inventory/inventory.errors.js';
import { getUnitDefinition } from '../../../../shared/units-of-measure.js';
import { placeAggregateInventoryReceipt,placeSerializedInventoryReceipt } from './inventory-positions.repo.js';
const fail=message=>{throw new InventoryError(message,{code:'INVENTORY_TASK_CONFLICT',statusCode:409});};
const positionFail=message=>{throw new InventoryError(message,{code:'INVENTORY_TASK_POSITION_REQUIRED',statusCode:409});};
async function shop(client,input,id=input.locationId){
 const r=await client.query('select id,company_id from locations where id=$1 and active=true and company_id=any($2::uuid[]) and ($4::boolean or id=any($3::uuid[]))',[id,input.companyIds,input.locationIds,input.isAdmin]);
 if(!r.rows[0])throw inventoryNotFound();return r.rows[0];
}
async function resolveTaskTracking(client,part,companyId,partId){
 if(!part || part.tracking_mode)return part;
 const evidence=await client.query(`select 1 from inventory_serialized_units u
   join inventory_receipt_lines l on l.company_id=u.company_id and l.id=u.receipt_line_id
   where u.company_id=$1 and l.catalog_part_id=$2 limit 1`,[companyId,partId]);
 if(evidence.rows.length)part.tracking_mode='serialized';
 return part;
}
async function detail(client,companyId,id,input={}){
 const r=await client.query(`select t.*,p.part_number,p.description,p.tracking_mode,l.name as location_name,d.name as destination_name from inventory_stock_tasks t join parts_catalog p on p.company_id=t.company_id and p.id=t.catalog_part_id join locations l on l.company_id=t.company_id and l.id=t.location_id left join locations d on d.company_id=t.company_id and d.id=t.destination_id where t.company_id=$1 and t.id=$2`,[companyId,id]);
 const units=await client.query('select u.serial_number,u.id,tu.received_at,tu.transfer_disposition from inventory_stock_task_units tu join inventory_serialized_units u on u.company_id=tu.company_id and u.id=tu.unit_id where tu.company_id=$1 and tu.task_id=$2 order by u.serial_number',[companyId,id]);
 const events=await client.query('select action,details,created_at from inventory_stock_task_events where company_id=$1 and task_id=$2 order by created_at desc,id desc limit 50',[companyId,id]);
 await resolveTaskTracking(client,r.rows[0],companyId,r.rows[0]?.catalog_part_id);
 const task={...r.rows[0],units:units.rows,events:events.rows};
 if(task.kind==='transfer'){
  task.exceptions=(await client.query('select *,kind as discrepancy_type from inventory_transfer_discrepancies where company_id=$1 and task_id=$2 order by created_at,id',[companyId,id])).rows;
  for(const exception of task.exceptions)if(exception.kind==='short')Object.assign(exception,await transferShortageProgress(client,task,exception));
  task.outstanding_quantity=Number(task.quantity)-Number(task.completed_quantity);
  task.transfer_outcome=task.transfer_state!=='completed'?task.transfer_state:Number(task.lost_quantity)>0?'completed_with_loss':Number(task.returned_quantity)===Number(task.quantity)?'returned':Number(task.returned_quantity)>0?'part_received_part_returned':'received';
  if(task.blind_receiving&&input.locationId===task.destination_id){
   task.units=units.rows.filter(unit=>['received','damaged'].includes(unit.transfer_disposition));task.source_allocations=[];task.source_provenance={};task.identity_observation=null;
   task.events=events.rows.map(({action,created_at})=>({action,created_at,details:{}}));
   task.blind_details_hidden=true;
  }
 }
 return task;
}
export async function listStockTasks(input){
 const client=await getPool().connect();try{
  const loc=await shop(client,input);
  const ids=await client.query(`select * from (
    select id,'task' as source,created_at,(status in ('released','scrapped','received','approved','cancelled')) as closed
    from inventory_stock_tasks where company_id=$1 and (location_id=$2 or destination_id=$2) and ($3::text is null or kind=$3)
    union all
    select o.id,'delivery' as source,o.delivery_confirmed_at as created_at,false as closed
    from inventory_purchase_orders o where o.company_id=$1 and o.location_id=$2 and $3='damage'
      and o.status='received' and o.delivery_condition='damaged'
      and exists(select 1 from inventory_purchase_lines l where l.company_id=o.company_id and l.order_id=o.id and l.received_quantity+l.cancelled_quantity<l.quantity)
    ) entries order by closed,created_at desc,id desc limit 26 offset $4`,[loc.company_id,loc.id,input.kind||null,(input.page-1)*25]);
  const items=[];for(const r of ids.rows.slice(0,25)){
    if(r.source==='task')items.push(await detail(client,loc.company_id,r.id,input));
    else {
      const report=await client.query(`select o.id,o.number as part_number,o.delivery_damage_details as reason,
        s.name as holder,'damage' as kind,'awaiting_inventory' as status,true as delivery_report,
        o.delivery_confirmed_at as created_at,l.name as location_name
        from inventory_purchase_orders o join inventory_suppliers s on s.company_id=o.company_id and s.id=o.supplier_id
        join locations l on l.company_id=o.company_id and l.id=o.location_id where o.company_id=$1 and o.id=$2`,[loc.company_id,r.id]);
      if(report.rows[0])items.push({...report.rows[0],quantity:null,uom_code:'',units:[],events:[]});
    }
  }
  return {items,page:input.page,hasMore:ids.rows.length>25,canApprove:input.isAdmin};
 }finally{client.release();}
}
export async function readStockTask(input){
 const client=await getPool().connect();try{
  const loc=await shop(client,input);
  const scoped=await client.query(`select id from inventory_stock_tasks
    where company_id=$1 and id=$2 and kind=$3 and (location_id=$4 or destination_id=$4)`,
  [loc.company_id,input.taskId,input.kind,loc.id]);
  if(!scoped.rows[0])throw inventoryNotFound();
  return {task:await detail(client,loc.company_id,input.taskId,input)};
 }finally{client.release();}
}
export async function stockTaskSnapshot(input){
 const client=await getPool().connect();try{
  const loc=await shop(client,input);
  const row=await client.query(`select i.id,i.xmin::text as revision,i.quantity_on_hand,i.quantity_reserved,p.part_number,p.tracking_mode,p.uom_code from inventory_items i join parts_catalog p on p.company_id=i.company_id and p.id=i.catalog_part_id where i.company_id=$1 and i.location_id=$2 and i.catalog_part_id=$3 and i.source_provider='local' and i.uom_code=p.uom_code`,[loc.company_id,loc.id,input.catalogPartId]);
  if(row.rows.length!==1)fail('This part needs a reconciled local stock balance before this action.');
  const result=await resolveTaskTracking(client,row.rows[0],loc.company_id,input.catalogPartId);
  result.positions=(await client.query(`select p.id as "positionId",p.code,p.name,b.quantity,b.quantity_reserved as "quantityReserved",b.quantity-b.quantity_reserved as "availableQuantity"
   from inventory_position_balances b join inventory_positions p on p.company_id=b.company_id and p.id=b.position_id
   where b.company_id=$1 and b.inventory_item_id=$2 and p.location_id=$3 and p.is_active and p.can_store and p.is_pickable and b.quantity>b.quantity_reserved order by p.code,p.id`,[loc.company_id,result.id,loc.id])).rows;
  return result;
 }finally{client.release();}
}
async function movement(client,input,task,locationId,delta,type){
 if(delta===0)return;
 const updated=await client.query(`update inventory_items set quantity_on_hand=quantity_on_hand+$4,updated_at=now() where company_id=$1 and location_id=$2 and catalog_part_id=$3 and source_provider='local' and uom_code=$5 and quantity_on_hand+$4>=quantity_reserved returning id`,[task.company_id,locationId,task.catalog_part_id,delta,task.uom_code]);
 if(updated.rows.length!==1)fail('Stock changed or is reserved. Refresh the balance before continuing.');
 await client.query(`insert into inventory_stock_movements(company_id,location_id,catalog_part_id,movement_type,quantity_delta,uom_code,actor_id,reason,idempotency_key,stock_task_id) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[task.company_id,locationId,task.catalog_part_id,type,delta,task.uom_code,input.actorId,input.command.reason,`stock-task:${input.command.idempotencyKey}:${locationId}`,task.id]);
}
async function positionOperation(client,input,task,locationId,suffix){
 const id=randomUUID(),idempotencyKey=`stock-task-position:${input.command.idempotencyKey}:${suffix}`;
 await client.query(`insert into inventory_position_operations(id,company_id,location_id,actor_id,command_type,idempotency_key,request_hash,reason)
  values($1,$2,$3,$4,'move',$5,$6,$7)`,[id,task.company_id,locationId,input.actorId,idempotencyKey,createHash('sha256').update(JSON.stringify({taskId:task.id,locationId,suffix})).digest('hex'),`Stock task ${task.id}: ${input.command.reason}`]);
 return id;
}
async function removeTaskStockFromPositions(client,input,task,part,balance,units){
 if(part.tracking_mode==='serialized'){
  if(units.some(unit=>!unit.current_position_id))positionFail('An exact unit has no physical position. Reconcile it in Inventory locations before starting this task.');
  const positionIds=[...new Set(units.map(unit=>unit.current_position_id))].sort();
  const positions=await client.query(`select id from inventory_positions where company_id=$1 and location_id=$2 and id=any($3::uuid[])
    and is_active and can_store and is_pickable order by id for update`,[task.company_id,task.location_id,positionIds]);
  if(positions.rowCount!==positionIds.length)positionFail('An exact unit position is unavailable. Reconcile it in Inventory locations before starting this task.');
  const operationId=await positionOperation(client,input,task,task.location_id,'remove');
  const updated=await client.query(`update inventory_serialized_units set current_position_id=null,custody_bin_location='',custody_version=custody_version+1,updated_at=now()
    where company_id=$1 and id=any($2::uuid[]) and current_position_id is not null returning id`,[task.company_id,units.map(unit=>unit.id)]);
  if(updated.rowCount!==units.length)positionFail('An exact unit position changed. Refresh and retry this task.');
  await client.query(`insert into inventory_position_movements(operation_id,company_id,location_id,catalog_part_id,uom_code,quantity,unit_id,from_position_id)
    select $1,$2,$3,$4,$5,1,input.id,input.position_id from unnest($6::uuid[],$7::uuid[]) input(id,position_id)`,
  [operationId,task.company_id,task.location_id,task.catalog_part_id,task.uom_code,units.map(unit=>unit.id),units.map(unit=>unit.current_position_id)]);
  if(task.kind==='transfer')await client.query('update inventory_stock_tasks set source_allocations=$3 where company_id=$1 and id=$2',[task.company_id,task.id,JSON.stringify(units.map(unit=>({positionId:unit.current_position_id,quantity:1,unitId:unit.id,receiptLineId:unit.receipt_line_id,custodyVersion:unit.custody_version})))]);
  return;
 }
 const blocked=await client.query(`select 1 where exists(select 1 from inventory_position_reconciliation_exceptions
   where company_id=$1 and inventory_item_id=$2 and status='open') or exists(select 1 from part_allocations
   where inventory_item_id=$2 and status in ('reserved','issued'))`,[task.company_id,balance.id]);
 if(blocked.rows[0])positionFail('This stock balance needs position reconciliation before starting a damage or transfer task.');
 const positions=await client.query(`select position.id from inventory_positions position where position.company_id=$1 and position.location_id=$2
   and position.is_active and position.can_store and position.is_pickable and exists(select 1 from inventory_position_balances position_balance
     where position_balance.company_id=position.company_id and position_balance.position_id=position.id and position_balance.inventory_item_id=$3)
   order by case position.usage when 'storage' then 0 when 'receiving' then 1 else 2 end,position.code,position.id for update`,[task.company_id,task.location_id,balance.id]);
 const positionIds=positions.rows.map(row=>row.id);
 const balances=positionIds.length?await client.query(`select position_balance.* from inventory_position_balances position_balance join inventory_positions position
   on position.company_id=position_balance.company_id and position.id=position_balance.position_id
   where position_balance.company_id=$1 and position_balance.location_id=$2 and position_balance.inventory_item_id=$3
     and position_balance.position_id=any($4::uuid[])
   order by case position.usage when 'storage' then 0 when 'receiving' then 1 else 2 end,position.code,position.id for update of position_balance`,[task.company_id,task.location_id,balance.id,positionIds]):{rows:[]};
 let remaining=Number(task.quantity);const removals=[];
 if(task.kind==='transfer'){
  const selected=input.command.sourceAllocations||[];
  if(!selected.length||new Set(selected.map(row=>row.positionId)).size!==selected.length)positionFail('Choose each source position and quantity once.');
  for(const allocation of selected){
   validateAmount(part,allocation.quantity);
   const row=balances.rows.find(row=>row.position_id===allocation.positionId);
   if(!row||allocation.quantity<=0||allocation.quantity>Number(row.quantity)-Number(row.quantity_reserved))positionFail('A selected source position has insufficient available stock.');
   removals.push(allocation);remaining=Math.round((remaining-allocation.quantity)*1000)/1000;
  }
  if(remaining!==0)positionFail('Source position quantities must equal the transfer quantity.');
  await client.query('update inventory_stock_tasks set source_allocations=$3 where company_id=$1 and id=$2',[task.company_id,task.id,JSON.stringify(removals)]);
 }else for(const row of balances.rows){const available=Number(row.quantity)-Number(row.quantity_reserved);const take=Math.min(remaining,available);if(take>0){removals.push({positionId:row.position_id,quantity:take});remaining-=take;}if(remaining<=0)break;}
 if(remaining>0)positionFail('Positioned available stock is lower than the task quantity. Reconcile Inventory locations before continuing.');
 const operationId=await positionOperation(client,input,task,task.location_id,'remove');
 for(const removal of removals){
  const updated=await client.query(`update inventory_position_balances set quantity=quantity-$4,version=version+1,updated_at=now()
    where company_id=$1 and position_id=$2 and inventory_item_id=$3 and quantity-quantity_reserved>=$4 returning position_id`,[task.company_id,removal.positionId,balance.id,removal.quantity]);
  if(!updated.rows[0])positionFail('Positioned stock changed. Refresh and retry this task.');
  await client.query(`insert into inventory_position_movements(operation_id,company_id,location_id,catalog_part_id,uom_code,quantity,from_position_id)
    values($1,$2,$3,$4,$5,$6,$7)`,[operationId,task.company_id,task.location_id,task.catalog_part_id,task.uom_code,removal.quantity,removal.positionId]);
 }
}
async function placeReleasedTaskStock(client,input,task,part,locationId,inventoryItemId,unitIds){
 const requestedTargetPositionId=input.command.targetPositionId||null;
 let targetPositionId=requestedTargetPositionId,systemKey='unassigned';
 if(input.command.action==='receive_transfer'&&requestedTargetPositionId){
  const receiving=await client.query(`select id from inventory_positions where company_id=$1 and location_id=$2 and id=$3
    and is_active and can_store and is_pickable and usage='receiving' and system_key='receiving' for share`,[task.company_id,locationId,requestedTargetPositionId]);
  if(receiving.rows[0]){targetPositionId=null;systemKey='receiving';}
 }
 const common={companyId:task.company_id,locationId,catalogPartId:task.catalog_part_id,uomCode:task.uom_code,actorId:input.actorId,
  idempotencyKey:`stock-task-place:${input.command.idempotencyKey}:${locationId}`,requestHash:createHash('sha256').update(JSON.stringify({taskId:task.id,locationId,unitIds,targetPositionId:requestedTargetPositionId})).digest('hex'),
  systemKey,targetPositionId,reason:`Stock task ${task.id}: ${input.command.reason}`};
 if(part.tracking_mode==='serialized')return placeSerializedInventoryReceipt(client,{...common,unitIds});
 return placeAggregateInventoryReceipt(client,{...common,inventoryItemId,quantity:Number(['receive_transfer','receive_transfer_return'].includes(input.command.action)?input.command.quantity:task.quantity)});
}
function validateAmount(part,quantity){
 const unit=getUnitDefinition(part.uom_code);
 if(!unit||unit.category==='time'||!part.tracking_mode)fail('Review physical tracking and stocking units first.');
 if(!Number.isFinite(quantity)||quantity<0||Math.round(quantity*10**unit.decimalScale)/10**unit.decimalScale!==quantity)fail('Quantity does not match the stocking unit precision.');
 if(part.tracking_mode==='serialized'&&!Number.isInteger(quantity))fail('Serialized quantities must be whole units.');
}
export async function saveStockTask(input){
 const client=await getPool().connect();const c={...input.command,serialNumbers:[...(input.command.serialNumbers||[])]};
 try{
  await client.query('begin');
  const loc=await shop(client,input);
  const hash=createHash('sha256').update(JSON.stringify(c)).digest('hex');
  await client.query('select pg_advisory_xact_lock(hashtext($1))',[`purchase-command:${loc.company_id}:${input.actorId}:${c.idempotencyKey}`]);
  const prior=await client.query('select request_hash,result from inventory_workflow_commands where company_id=$1 and actor_id=$2 and idempotency_key=$3',[loc.company_id,input.actorId,c.idempotencyKey]);
  if(prior.rows[0]){if(prior.rows[0].request_hash!==hash)fail('This command was already used with different details.');await client.query('commit');return {...prior.rows[0].result,replayed:true};}
  c.serialNumbers=await resolveTaskCodes(client,loc.company_id,c.serialNumbers);
  if(['count','approve_count','recount','cancel_count'].includes(c.action))positionFail('Use Inventory locations > Position count for physical counts; stock tasks cannot write a second count ledger.');
  let task;
  if(['damage','transfer','count'].includes(c.action)){
   const partResult=await client.query('select * from parts_catalog where company_id=$1 and id=$2 for update',[loc.company_id,c.catalogPartId]);
   const part=partResult.rows[0];if(!part)throw inventoryNotFound();await resolveTaskTracking(client,part,loc.company_id,part.id);validateAmount(part,c.quantity);

   if(c.action!=='count'&&c.quantity<=0)fail('Enter a positive quantity.');
   let units=[];
   if(part.tracking_mode==='serialized'&&c.action!=='count'){
    if(c.sourceAllocations?.length)positionFail('Serialized source positions are derived from the scanned exact units.');
    if(new Set(c.serialNumbers).size!==c.quantity||c.serialNumbers.length!==c.quantity)fail('Scan each exact serial once; the number of identities must equal the quantity.');
    const r=await client.query(`select u.* from inventory_serialized_units u join inventory_receipt_lines l on l.company_id=u.company_id and l.id=u.receipt_line_id where u.company_id=$1 and u.location_id=$2 and l.catalog_part_id=$3 and u.serial_number=any($4::text[]) order by u.id for update of u`,[loc.company_id,loc.id,part.id,c.serialNumbers]);units=r.rows;
    if(units.length!==c.quantity||units.some(u=>u.status!=='in_stock'||u.custody_holder_type!=='inventory_location'||u.custody_location_id!==loc.id))fail('Each scanned unit must be unissued stock physically at this shop.');
   }else if(part.tracking_mode!=='serialized'&&c.serialNumbers.length)fail('Aggregate stock does not accept serial identities.');
   const balance=await client.query(`select *,xmin::text as revision from inventory_items where company_id=$1 and location_id=$2 and catalog_part_id=$3 and source_provider='local' and uom_code=$4 for update`,[loc.company_id,loc.id,part.id,part.uom_code]);
   if(balance.rows.length!==1||balance.rows[0].revision!==c.expectedBalanceRevision)fail('The stock balance changed. Refresh and observe it again.');
   let destination=null;
   if(c.action==='transfer'){
    destination=await shop(client,input,c.destinationId);if(destination.company_id!==loc.company_id||destination.id===loc.id)fail('Choose another shop in the same company.');
   }
   const inserted=await client.query(`insert into inventory_stock_tasks(company_id,location_id,destination_id,catalog_part_id,kind,status,quantity,uom_code,reason,holder,balance_revision,observed_balance,created_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning *`,[loc.company_id,loc.id,destination?.id||null,part.id,c.action,c.action==='damage'?'inspection':c.action==='transfer'?'in_transit':'awaiting_approval',c.quantity,part.uom_code,c.reason,c.holder,balance.rows[0].revision,balance.rows[0].quantity_on_hand,input.actorId]);task=inserted.rows[0];
   await client.query("update inventory_stock_tasks set tracking_snapshot=$3,blind_receiving=$4,transfer_state=case when kind='transfer' then 'in_transit' else null end where company_id=$1 and id=$2",[loc.company_id,task.id,part.tracking_mode,c.action==='transfer'&&Boolean(c.blindReceiving)]);
   if(c.action==='transfer')await snapshotTransferProvenance(client,task,part,units);
   await removeTaskStockFromPositions(client,input,task,part,balance.rows[0],units);
   await movement(client,input,task,loc.id,-c.quantity,c.action==='transfer'?'transfer_out':'adjustment');
   for(const unit of units){
    await client.query('insert into inventory_stock_task_units(company_id,task_id,unit_id) values($1,$2,$3)',[loc.company_id,task.id,unit.id]);
    await client.query(`update inventory_serialized_units set status='removed',condition_code=case when $3='damage' then 'needs_repair' else condition_code end,custody_holder_type=case when $3='transfer' then 'handoff' else 'inventory_location' end,custody_location_id=case when $3='transfer' then null else $4::uuid end,custody_external_reference=$5,current_position_id=null,custody_bin_location='',custody_legacy_available=false,custody_version=custody_version+1,updated_at=now() where company_id=$1 and id=$2`,[loc.company_id,unit.id,c.action,loc.id,c.holder]);
   }
  }else{
   const r=await client.query('select * from inventory_stock_tasks where company_id=$1 and id=$2 and (location_id=$3 or destination_id=$3) for update',[loc.company_id,c.taskId,loc.id]);task=r.rows[0];if(!task)throw inventoryNotFound();
   if(task.version!==c.expectedVersion)fail('This task changed. Refresh before continuing.');
   if(!['receive_transfer','report_transfer_discrepancy','resolve_transfer_discrepancy'].includes(c.action)&&task.location_id!==loc.id)fail('Perform this action at the task source shop.');
   const part=(await client.query('select * from parts_catalog where company_id=$1 and id=$2 for update',[loc.company_id,task.catalog_part_id])).rows[0];
   await resolveTaskTracking(client,part,loc.company_id,task.catalog_part_id);
   if(task.kind==='transfer'&&(task.uom_code!==part.uom_code||(task.tracking_snapshot&&task.tracking_snapshot!==part.tracking_mode)))fail('The part tracking or stocking unit changed. Reconcile this transfer before proceeding.');
   if(['repair','release','scrap'].includes(c.action))await assertDispositionPolicy(client,input,task);
   if(c.action==='repair'&&task.kind==='damage'&&task.status==='inspection'&&c.holder){
    const positioned=await client.query(`select 1 from inventory_stock_task_units task_unit join inventory_serialized_units unit
      on unit.company_id=task_unit.company_id and unit.id=task_unit.unit_id where task_unit.company_id=$1 and task_unit.task_id=$2 and unit.current_position_id is not null limit 1`,[loc.company_id,task.id]);
    if(positioned.rows[0])positionFail('This damage task still points at shelf stock. Reconcile its exact positions before sending it for repair.');
    await client.query("update inventory_stock_tasks set status='repair',holder=$3 where company_id=$1 and id=$2",[loc.company_id,task.id,c.holder]);
    await client.query("update inventory_serialized_units set custody_holder_type='external_repair',custody_external_reference=$3,custody_version=custody_version+1,updated_at=now() where company_id=$1 and id in(select unit_id from inventory_stock_task_units where company_id=$1 and task_id=$2)",[loc.company_id,task.id,c.holder]);
   }else if(['release','scrap'].includes(c.action)&&task.kind==='damage'&&['inspection','repair'].includes(task.status)&&input.isAdmin){
    if(!c.holder)fail(c.action==='release'?'Record the inspection or release reference.':'Record the disposal reference.');
    if(part.tracking_mode==='serialized'){
     const taskUnits=(await client.query('select u.id,u.serial_number,u.current_position_id from inventory_stock_task_units t join inventory_serialized_units u on u.company_id=t.company_id and u.id=t.unit_id where t.company_id=$1 and t.task_id=$2 order by u.id for update of u',[loc.company_id,task.id])).rows;
     if(taskUnits.some(unit=>unit.current_position_id))positionFail('This damage task still points at shelf stock. Reconcile its exact positions before disposition.');
     const identities=taskUnits.map(u=>u.serial_number).sort();
     if(JSON.stringify([...c.serialNumbers].sort())!==JSON.stringify(identities))fail('Validate every exact identity before releasing or scrapping.');
    }
    if(c.action==='release')await movement(client,input,task,loc.id,Number(task.quantity),'adjustment');
    await client.query(`update inventory_serialized_units set status=$3,condition_code=$4,custody_holder_type=$5,custody_location_id=$6,custody_external_reference=$7,custody_version=custody_version+1,updated_at=now() where company_id=$1 and id in(select unit_id from inventory_stock_task_units where company_id=$1 and task_id=$2)`,[loc.company_id,task.id,c.action==='release'?'in_stock':'scrapped',c.action==='release'?(task.status==='repair'?'refurbished':'serviceable_used'):'unserviceable',c.action==='release'?'inventory_location':'disposed',c.action==='release'?loc.id:null,c.holder]);
    if(c.action==='release'){
     const item=(await client.query(`select id from inventory_items where company_id=$1 and location_id=$2 and catalog_part_id=$3 and source_provider='local' and uom_code=$4 order by updated_at desc,id limit 1 for update`,[loc.company_id,loc.id,part.id,task.uom_code])).rows[0];
     const unitIds=part.tracking_mode==='serialized'?(await client.query('select unit_id from inventory_stock_task_units where company_id=$1 and task_id=$2 order by unit_id',[loc.company_id,task.id])).rows.map(row=>row.unit_id):[];
     if(!item)positionFail('The local stock balance is missing; reconcile it before releasing this task.');
     await placeReleasedTaskStock(client,input,task,part,loc.id,item.id,unitIds);
    }
    await client.query('update inventory_stock_tasks set status=$3,holder=$4,completed_quantity=quantity where company_id=$1 and id=$2',[loc.company_id,task.id,c.action==='release'?'released':'scrapped',c.holder]);
   }else if(['request_transfer_return','report_transfer_discrepancy','resolve_transfer_discrepancy'].includes(c.action)&&task.kind==='transfer'){
    await transferExceptionCommand(client,input,task,part,loc,c);
   }else if(['receive_transfer','receive_transfer_return'].includes(c.action)&&task.kind==='transfer'&&task.status==='in_transit'&&
    (c.action==='receive_transfer'?task.destination_id===loc.id&&task.transfer_state==='in_transit':task.location_id===loc.id&&task.transfer_state==='returning')){
    validateAmount(part,c.quantity);if(!c.quantity||c.quantity>Number(task.quantity)-Number(task.completed_quantity))fail('Receive only a positive amount still in transit.');
    if(!c.holder)fail('Record the receiving handoff or reference.');
    const outstanding=(await client.query('select u.* from inventory_stock_task_units t join inventory_serialized_units u on u.company_id=t.company_id and u.id=t.unit_id where t.company_id=$1 and t.task_id=$2 and t.received_at is null order by u.id for update of u',[loc.company_id,task.id])).rows;
    let receivedUnits=[];
    if(part.tracking_mode==='serialized'){
     receivedUnits=outstanding.filter(u=>c.serialNumbers.includes(u.serial_number));
     if(new Set(c.serialNumbers).size!==c.quantity||c.serialNumbers.length!==c.quantity||receivedUnits.length!==c.quantity)fail('Scan exactly the outstanding identities physically received.');
    }else if(c.serialNumbers.length)fail('Aggregate stock does not accept serial identities.');
    if(receivedUnits.some(unit=>{
     const dispatch=(task.source_allocations||[]).find(item=>item.unitId===unit.id);
     return unit.status!=='removed'||unit.custody_holder_type!=='handoff'||unit.location_id!==task.location_id||unit.current_position_id||unit.custody_location_id||
      (dispatch?.custodyVersion!=null&&Number(unit.custody_version)!==Number(dispatch.custodyVersion)+2);
    }))fail('An exact unit moved out of this transfer. Reconcile its current custody before receiving.');
    if(c.disposition==='damaged'){
     await receiveDamagedTransfer(client,input,task,part,loc,c,receivedUnits);
    }else {
    const dest=await client.query('select * from inventory_items where company_id=$1 and location_id=$2 and normalized_part_number=$3 and uom_code=$4 for update',[loc.company_id,loc.id,part.normalized_part_number,part.uom_code]);
    if(dest.rows[0]&&dest.rows[0].source_provider!=='local')fail('Reconcile destination stock authority before receiving a transfer.');
    if(!dest.rows.length){
     const provider=await client.query('select id from odoo_inventory_balances where company_id=$1 and location_id=$2 and (catalog_part_id=$3 or normalized_part_number=$4) limit 1',[loc.company_id,loc.id,part.id,part.normalized_part_number]);
     if(provider.rows.length)fail('Reconcile destination provider stock before receiving a transfer.');
     await client.query(`insert into inventory_items(company_id,location_id,catalog_part_id,normalized_part_number,part_number,description,quantity_on_hand,quantity_reserved,uom_code,source_provider,external_id) values($1,$2,$3,$4,$5,$6,0,0,$7,'local',$8)`,[loc.company_id,loc.id,part.id,part.normalized_part_number,part.part_number,part.description,part.uom_code,`local:${loc.id}:${part.id}`]);
    }
    await movement(client,input,task,loc.id,c.quantity,'transfer_in');
    for(const unit of receivedUnits){
     await client.query('update inventory_stock_task_units set received_at=now(),transfer_disposition=$4 where company_id=$1 and task_id=$2 and unit_id=$3',[loc.company_id,task.id,unit.id,c.action==='receive_transfer_return'?'returned':'received']);
     await client.query("update inventory_serialized_units set status='in_stock',location_id=$3,custody_holder_type='inventory_location',custody_location_id=$3,custody_external_reference=$4,custody_bin_location='',current_position_id=null,custody_version=custody_version+1,updated_at=now() where company_id=$1 and id=$2",[loc.company_id,unit.id,loc.id,c.holder]);
    }
    const destinationItem=(await client.query(`select id from inventory_items where company_id=$1 and location_id=$2 and catalog_part_id=$3 and source_provider='local' and uom_code=$4 order by updated_at desc,id limit 1 for update`,[loc.company_id,loc.id,part.id,task.uom_code])).rows[0];
    if(!destinationItem)positionFail('The destination local stock balance is missing; reconcile it before receiving this transfer.');
    await placeReleasedTaskStock(client,input,task,part,loc.id,destinationItem.id,receivedUnits.map(unit=>unit.id));
    }
    await client.query(`update inventory_stock_tasks set completed_quantity=completed_quantity+$3,returned_quantity=returned_quantity+case when $4 then $3 else 0 end,
     status=case when completed_quantity+$3=quantity then case when $4 and completed_quantity=returned_quantity then 'cancelled' else 'received' end else 'in_transit' end,
     transfer_state=case when completed_quantity+$3=quantity then 'completed' else transfer_state end where company_id=$1 and id=$2`,[loc.company_id,task.id,c.quantity,c.action==='receive_transfer_return']);
   }else if(c.action==='approve_count'&&task.kind==='count'&&task.status==='awaiting_approval'&&input.isAdmin){
    const balance=await client.query("select *,xmin::text as revision from inventory_items where company_id=$1 and location_id=$2 and catalog_part_id=$3 and source_provider='local' and uom_code=$4 for update",[loc.company_id,loc.id,part.id,task.uom_code]);
    if(balance.rows.length!==1)fail('Stock balance is unavailable.');
    const exactValid=part.tracking_mode!=='serialized'||await validateExactCount(client,task);
    if(balance.rows[0].revision!==task.balance_revision||!exactValid){
     await client.query("update inventory_stock_tasks set status='recount' where company_id=$1 and id=$2",[loc.company_id,task.id]);
    }else{
     if(part.tracking_mode==='serialized')await postExactCount(client,task);
     await movement(client,input,task,loc.id,Number(task.quantity)-Number(task.observed_balance),'adjustment');
     await client.query("update inventory_stock_tasks set status='approved' where company_id=$1 and id=$2",[loc.company_id,task.id]);
    }
   }else if(c.action==='recount'&&task.kind==='count'&&['recount','awaiting_approval'].includes(task.status)){
    validateAmount(part,c.quantity);
    const balance=await client.query("select quantity_on_hand,xmin::text as revision from inventory_items where company_id=$1 and location_id=$2 and catalog_part_id=$3 and source_provider='local' and uom_code=$4 for update",[loc.company_id,loc.id,part.id,task.uom_code]);
    if(balance.rows.length!==1)fail('Stock balance is unavailable.');
    if(part.tracking_mode==='serialized')await observeExactCount(client,task,c,balance.rows[0]);
    await client.query("update inventory_stock_tasks set quantity=$3,observed_balance=$4,balance_revision=$5,status='awaiting_approval' where company_id=$1 and id=$2",[loc.company_id,task.id,c.quantity,balance.rows[0].quantity_on_hand,balance.rows[0].revision]);
   }else if(c.action==='cancel_count'&&task.kind==='count'&&['recount','awaiting_approval'].includes(task.status)){
    await client.query("update inventory_stock_tasks set status='cancelled' where company_id=$1 and id=$2",[loc.company_id,task.id]);
   }else fail('This action is not allowed for this task, shop or your access.');
   await client.query('update inventory_stock_tasks set version=version+1,updated_at=now() where company_id=$1 and id=$2',[loc.company_id,task.id]);
  }
  await client.query('insert into inventory_stock_task_events(company_id,task_id,actor_id,action,details) values($1,$2,$3,$4,$5)',[loc.company_id,task.id,input.actorId,c.action,JSON.stringify(c)]);
  const result={task:await detail(client,loc.company_id,task.id,input)};
  await client.query('insert into inventory_workflow_commands(company_id,location_id,actor_id,idempotency_key,request_hash,result) values($1,$2,$3,$4,$5,$6)',[loc.company_id,loc.id,input.actorId,c.idempotencyKey,hash,JSON.stringify(result)]);
  await client.query('commit');return result;
 }catch(error){await client.query('rollback').catch(()=>{});if(error?.code==='INVENTORY_RECEIPT_POSITION_INVALID')throw new InventoryError('Choose an active, pickable storage position at this shop.',{code:'INVENTORY_RECEIPT_POSITION_INVALID',statusCode:422});throw error;}finally{client.release();}
}

async function requireTransferHold(client,companyId,locationId,positionId){
 const position=(await client.query(`select id from inventory_positions where company_id=$1 and location_id=$2 and id=$3 and is_active and can_store and not is_pickable for update`,[companyId,locationId,positionId||null])).rows[0];
 if(!position)positionFail('Choose an active non-pickable hold location at this shop.');
 return position.id;
}
async function snapshotTransferProvenance(client,task,part,units){
 const serialized=part.tracking_mode==='serialized';
 const lines=(await client.query(`select l.id as receipt_line_id,l.receipt_id,r.invoice_run_id,l.quantity,l.uom_code,l.currency,l.unit_cost,l.cost_source
  from inventory_receipt_lines l join inventory_receipts r on r.company_id=l.company_id and r.id=l.receipt_id
  where l.company_id=$1 and l.catalog_part_id=$2 and ($4::boolean and l.id=any($5::uuid[]) or not $4::boolean and r.location_id=$3)
  order by l.created_at,l.id`,[task.company_id,part.id,task.location_id,serialized,units.map(unit=>unit.receipt_line_id)])).rows;
 await client.query('update inventory_stock_tasks set source_provenance=$3 where company_id=$1 and id=$2',[task.company_id,task.id,JSON.stringify({status:serialized?'exact_units':'unallocated_receipt_candidates',receiptLines:lines,warning:serialized?null:'Position balances do not identify remaining receipt batches. These are historical source candidates, not allocated quantities or a transfer cost.'})]);
}
async function receiveDamagedTransfer(client,input,task,part,loc,c,units){
 const hold=await requireTransferHold(client,loc.company_id,loc.id,c.targetPositionId);
 const balance=(await client.query('select * from inventory_items where company_id=$1 and location_id=$2 and normalized_part_number=$3 for update',[loc.company_id,loc.id,part.normalized_part_number])).rows[0];
 if(balance&&(balance.source_provider!=='local'||balance.uom_code!==task.uom_code))fail('Reconcile destination stock authority before accepting held goods.');
 if(!balance){
  const provider=await client.query('select 1 from odoo_inventory_balances where company_id=$1 and location_id=$2 and (catalog_part_id=$3 or normalized_part_number=$4) limit 1',[loc.company_id,loc.id,part.id,part.normalized_part_number]);
  if(provider.rows.length)fail('Reconcile destination provider stock before accepting held goods.');
  await client.query(`insert into inventory_items(company_id,location_id,catalog_part_id,normalized_part_number,part_number,description,quantity_on_hand,quantity_reserved,uom_code,source_provider,external_id) values($1,$2,$3,$4,$5,$6,0,0,$7,'local',$8)`,[loc.company_id,loc.id,part.id,part.normalized_part_number,part.part_number,part.description,task.uom_code,`local:${loc.id}:${part.id}`]);
 }
 const damage=(await client.query(`insert into inventory_stock_tasks(company_id,location_id,catalog_part_id,kind,status,quantity,uom_code,reason,holder,created_by,parent_transfer_id,hold_position_id,tracking_snapshot)
  values($1,$2,$3,'damage','inspection',$4,$5,$6,$7,$8,$9,$10,$11) returning id`,[loc.company_id,loc.id,part.id,c.quantity,task.uom_code,c.reason,c.holder,input.actorId,task.id,hold,task.tracking_snapshot])).rows[0];
 for(const unit of units){
  await client.query("update inventory_stock_task_units set received_at=now(),transfer_disposition='damaged' where company_id=$1 and task_id=$2 and unit_id=$3",[loc.company_id,task.id,unit.id]);
  await client.query('insert into inventory_stock_task_units(company_id,task_id,unit_id) values($1,$2,$3)',[loc.company_id,damage.id,unit.id]);
  await client.query(`update inventory_serialized_units set location_id=$3,status='removed',condition_code='needs_repair',custody_holder_type='inventory_location',custody_location_id=$3,custody_external_reference=$4,current_position_id=null,custody_version=custody_version+1,updated_at=now() where company_id=$1 and id=$2`,[loc.company_id,unit.id,loc.id,c.holder]);
 }
 await client.query('insert into inventory_stock_task_events(company_id,task_id,actor_id,action,details) values($1,$2,$3,$4,$5)',[loc.company_id,damage.id,input.actorId,'transfer_damage',JSON.stringify({transferId:task.id,holdPositionId:hold,quantity:c.quantity})]);
}
async function transferShortageProgress(client,task,exception){
 const report=(await client.query(`select event.details from inventory_stock_task_events event
  where event.company_id=$1 and event.task_id=$2 and event.action='report_transfer_discrepancy'
   and event.details->>'discrepancyType'='short' and (event.details->>'discrepancyId'=$3::text or event.created_at=(select created_at from inventory_transfer_discrepancies where company_id=$1 and id=$3::uuid))
  order by event.created_at limit 1`,[task.company_id,task.id,exception.id])).rows[0];
 if(!report)return {recovered_quantity:0,resolved_lost_quantity:0,remaining_quantity:Math.min(Number(exception.quantity),Number(task.quantity)-Number(task.completed_quantity)),progress_verified:false};
 const completionEvents=(await client.query(`select action,details from inventory_stock_task_events where company_id=$1 and task_id=$2
  and action in ('receive_transfer','receive_transfer_return','resolve_transfer_discrepancy')
  order by (details->>'expectedVersion')::integer`,[task.company_id,task.id])).rows;
 const reportVersion=Number(report.details.expectedVersion);
 const events=completionEvents.filter(event=>Number(event.details.expectedVersion)>reportVersion);
 const final=exception.status==='resolved'?events.find(event=>event.action==='resolve_transfer_discrepancy'&&event.details.discrepancyId===exception.id&&event.details.shortageProgress?.remaining_quantity===0):null;
 if(final)return {...final.details.shortageProgress,progress_verified:true};
 const lost=events.filter(event=>event.action==='resolve_transfer_discrepancy'&&event.details.discrepancyId===exception.id&&event.details.resolutionType==='lost_in_transit').reduce((total,event)=>total+Number(event.details.quantity),0);
 const completedBeforeReport=completionEvents.filter(event=>Number(event.details.expectedVersion)<=reportVersion).reduce((total,event)=>{
  if(['receive_transfer','receive_transfer_return'].includes(event.action))return total+Number(event.details.quantity);
  if(event.action==='resolve_transfer_discrepancy'&&event.details.resolutionType==='lost_in_transit')return total+Number(event.details.quantity);
  return total;
 },0);
 const outstandingAtReport=Math.max(0,Number(task.quantity)-completedBeforeReport);
 const presentButUnposted=Math.max(0,outstandingAtReport-Number(exception.quantity));
 const physicallyCompletedAfterReport=events.filter(event=>['receive_transfer','receive_transfer_return'].includes(event.action)).reduce((total,event)=>total+Number(event.details.quantity),0);
 const recovered=Math.min(Math.max(0,Number(exception.quantity)-lost),Math.max(0,physicallyCompletedAfterReport-presentButUnposted));
 return {recovered_quantity:recovered,resolved_lost_quantity:lost,remaining_quantity:Math.max(0,Math.round((Number(exception.quantity)-recovered-lost)*1000)/1000),progress_verified:true};
}
async function transferExceptionCommand(client,input,task,part,loc,c){
 const outstanding=Number(task.quantity)-Number(task.completed_quantity);
 if(c.action==='request_transfer_return'){
  if(task.status!=='in_transit'||task.transfer_state!=='in_transit'||loc.id!==task.location_id||outstanding<=0)fail('Only outstanding dispatched stock can be returned to its source.');
  await client.query("update inventory_stock_tasks set transfer_state='returning',holder=$3 where company_id=$1 and id=$2",[loc.company_id,task.id,c.holder]);return;
 }
 if(c.action==='report_transfer_discrepancy'){
  if(loc.id!==task.destination_id||task.transfer_state==='returning')fail('Record the arrival discrepancy at the destination.');
  validateAmount(part,c.quantity);
  if(c.discrepancyType==='short'&&c.quantity>outstanding)fail('Missing quantity cannot exceed stock still in transit.');
  if(part.tracking_mode==='serialized'&&c.discrepancyType==='extra'&&(new Set(c.serialNumbers).size!==c.quantity||c.serialNumbers.length!==c.quantity))fail('Record each unexpected serial once.');
  if(part.tracking_mode!=='serialized'&&c.serialNumbers.length)fail('Aggregate stock does not accept serial identities.');
  if(c.discrepancyType==='short'&&c.serialNumbers.length)fail('Report missing quantity without guessing exact identities.');
  if(c.discrepancyType==='extra'&&c.serialNumbers.length){
   const known=await client.query('select 1 from inventory_serialized_units where company_id=$1 and serial_number=any($2::text[]) limit 1',[loc.company_id,c.serialNumbers]);
   if(known.rows.length)fail('A known serial must be reconciled against its current custody, not recorded as unknown extra stock.');
  }
  const open=await client.query("select 1 from inventory_transfer_discrepancies where company_id=$1 and task_id=$2 and kind=$3 and status='open'",[loc.company_id,task.id,c.discrepancyType]);
  if(open.rows.length)fail('Resolve the existing discrepancy before opening another of this type.');
  const hold=c.discrepancyType==='extra'?await requireTransferHold(client,loc.company_id,loc.id,c.targetPositionId):null;
  c.discrepancyId=(await client.query(`insert into inventory_transfer_discrepancies(company_id,task_id,kind,quantity,serial_numbers,hold_position_id,reason,holder,created_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,[loc.company_id,task.id,c.discrepancyType,c.quantity,JSON.stringify(c.serialNumbers),hold,c.reason,c.holder,input.actorId])).rows[0].id;return;
 }
 if(!input.isAdmin)fail('An administrator must reconcile transfer discrepancies.');
 const exception=(await client.query("select * from inventory_transfer_discrepancies where company_id=$1 and task_id=$2 and id=$3 and status='open' for update",[loc.company_id,task.id,c.discrepancyId])).rows[0];
 if(!exception)fail('This discrepancy has already changed.');
 const progress=exception.kind==='short'?await transferShortageProgress(client,task,exception):null;
 if(progress&&!progress.progress_verified)fail('The shortage report evidence is missing. Reconcile this record before classifying loss.');
 if(exception.kind==='short'&&c.resolutionType==='lost_in_transit'){
  validateAmount(part,c.quantity);
  if(!c.quantity||c.quantity>outstanding||c.quantity>progress.remaining_quantity)fail('Confirm only the remaining shortage quantity still in transit.');
  const units=(await client.query(`select u.* from inventory_stock_task_units t join inventory_serialized_units u on u.company_id=t.company_id and u.id=t.unit_id where t.company_id=$1 and t.task_id=$2 and t.received_at is null and u.serial_number=any($3::text[]) order by u.id for update of u`,[loc.company_id,task.id,c.serialNumbers])).rows;
  if(part.tracking_mode==='serialized'){
   if(c.serialNumbers.length!==c.quantity||new Set(c.serialNumbers).size!==c.quantity||units.length!==c.quantity||units.some(unit=>unit.status!=='removed'||unit.custody_holder_type!=='handoff'||unit.location_id!==task.location_id||unit.current_position_id||unit.custody_location_id))fail('Confirm each outstanding lost identity and its current transfer custody.');
   for(const unit of units){
    await client.query("update inventory_stock_task_units set received_at=now(),transfer_disposition='lost' where company_id=$1 and task_id=$2 and unit_id=$3",[loc.company_id,task.id,unit.id]);
    await client.query("update inventory_serialized_units set custody_holder_type='unknown',custody_external_reference=$3,custody_version=custody_version+1,updated_at=now() where company_id=$1 and id=$2",[loc.company_id,unit.id,c.resolutionReference]);
   }
  }else if(c.serialNumbers.length)fail('Aggregate stock does not accept serial identities.');
  await client.query(`update inventory_stock_tasks set lost_quantity=lost_quantity+$3,completed_quantity=completed_quantity+$3,
   status=case when completed_quantity+$3=quantity then 'cancelled' else status end,
   transfer_state=case when completed_quantity+$3=quantity then 'completed' else transfer_state end where company_id=$1 and id=$2`,[loc.company_id,task.id,c.quantity]);
  c.shortageProgress={...progress,resolved_lost_quantity:progress.resolved_lost_quantity+c.quantity,remaining_quantity:Math.round((progress.remaining_quantity-c.quantity)*1000)/1000};
  if(c.shortageProgress.remaining_quantity>0)return;
 }else if(exception.kind==='short'){
  if(c.resolutionType!=='received_or_returned'||progress.remaining_quantity>0)fail('Receive or physically return the missing stock before closing the shortage.');
  c.shortageProgress=progress;
 }else if(c.resolutionType!=='extra_returned')fail('Confirm physical return of unexpected goods.');
 if(exception.kind==='extra'&&loc.id!==task.destination_id)fail('Confirm return of unexpected goods at the destination.');
 await client.query("update inventory_transfer_discrepancies set status='resolved',resolution_reference=$4,resolved_by=$5,resolved_at=now(),resolution_type=$6 where company_id=$1 and task_id=$2 and id=$3",[loc.company_id,task.id,c.discrepancyId,c.resolutionReference,input.actorId,c.resolutionType]);
}

async function countUnits(client,task){
 return (await client.query(`select u.id,u.serial_number,u.custody_version from inventory_serialized_units u join inventory_receipt_lines l on l.company_id=u.company_id and l.id=u.receipt_line_id where u.company_id=$1 and u.location_id=$2 and l.catalog_part_id=$3 and u.status='in_stock' and u.custody_holder_type='inventory_location' and u.custody_location_id=$2 order by u.id for update of u`,[task.company_id,task.location_id,task.catalog_part_id])).rows;
}
async function observeExactCount(client,task,command,balance){
 const units=await countUnits(client,task);
 if(units.length!==Number(balance.quantity_on_hand))fail('Exact identities do not reconcile to the stock balance. Investigate the existing unit records first.');
 if(new Set(command.serialNumbers).size!==command.quantity||command.serialNumbers.length!==command.quantity)fail('Count each physically observed serial once.');
 if(command.serialNumbers.some(serial=>!units.some(u=>u.serial_number===serial)))fail('A scanned identity is not current usable stock at this shop. Investigate found or held units separately.');
 await client.query('update inventory_stock_tasks set identity_observation=$3 where company_id=$1 and id=$2',[task.company_id,task.id,JSON.stringify({baseline:units,observed:command.serialNumbers})]);
}
async function validateExactCount(client,task){
 if(!task.identity_observation)return false;
 const units=await countUnits(client,task);
 const baseline=task.identity_observation.baseline;
 return units.length===baseline.length&&units.every((u,i)=>u.id===baseline[i].id&&u.serial_number===baseline[i].serial_number&&u.custody_version===baseline[i].custody_version);
}
async function postExactCount(client,task){
 const observation=task.identity_observation;
 for(const unit of observation.baseline){
  if(observation.observed.includes(unit.serial_number))continue;
  await client.query(`insert into inventory_stock_task_units(company_id,task_id,unit_id) values($1,$2,$3) on conflict do nothing`,[task.company_id,task.id,unit.id]);
  await client.query(`update inventory_serialized_units set status='removed',condition_code='unknown',custody_holder_type='unknown',custody_location_id=null,custody_external_reference=$3,custody_legacy_available=false,custody_version=custody_version+1,updated_at=now() where company_id=$1 and id=$2`,[task.company_id,unit.id,`Missing during approved count ${task.id}`]);
 }
}

async function assertDispositionPolicy(client,input,task){
 const action=input.command.action,capability=action==='scrap'?'disposition':action;
 const grants=await client.query('select capability from inventory_reuse_capability_grants where company_id=$1 and location_id=$2 and user_id=$3 and capability=$4 for share',[task.company_id,task.location_id,input.actorId,capability]);
 if(!grants.rows.length)throw new InventoryError('An explicit shop capability is required. Configure your access in Tasks > Returns & repairs > Reuse settings.',{code:'INVENTORY_REUSE_FORBIDDEN',statusCode:403});
 const policy=(await client.query('select reuse_allowed,repair_allowed,scrap_allowed from inventory_reuse_catalog_policies where company_id=$1 and location_id=$2 and catalog_part_id=$3 for share',[task.company_id,task.location_id,task.catalog_part_id])).rows[0];
 const allowed=action==='release'?policy?.reuse_allowed:action==='repair'?policy?.repair_allowed:policy?.scrap_allowed;
 if(!allowed)fail('The part policy does not permit this action. Keep the goods held and review Reuse settings.');
}

async function resolveTaskCodes(client,companyId,codes){
 const resolved=[];
 for(const code of codes){
  const id=readInventoryQrToken(inventoryTokenFromCode(code));
  if(!id){if(code.length>100)fail('The scanned label is not a valid stock identity.');resolved.push(code);continue;}
  const unit=(await client.query('select serial_number from inventory_serialized_units where company_id=$1 and id=$2',[companyId,id])).rows[0];
  if(!unit)throw inventoryNotFound();resolved.push(unit.serial_number);
 }
 return resolved;
}
