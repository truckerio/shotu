import { createHash, randomUUID } from "node:crypto";
import { getPool } from "../pool.js";

const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const num = (value) => Number(value || 0);
const validPrecision=(value,scale)=>Number.isFinite(value)&&Number(value.toFixed(scale))===value;
const physicalPositionKinds = ["zone", "room", "area", "aisle", "rack", "shelf", "bin"];
const childPositionKinds = {
  warehouse: new Set(physicalPositionKinds),
  zone: new Set(physicalPositionKinds),
  room: new Set(physicalPositionKinds),
  area: new Set(physicalPositionKinds),
  aisle: new Set(["shelf", "rack"]),
  rack: new Set(["shelf", "bin"]),
  shelf: new Set(["bin"]),
  bin: new Set(),
};
const canNestPositionKind=(parentKind,childKind)=>Boolean(childPositionKinds[parentKind]?.has(childKind));

async function hasAggregatePositionReconciliationConflict(client,companyId,inventoryItemId){
  const result=await client.query(`select 1
    from inventory_items item
    where item.company_id=$1 and item.id=$2 and (
      exists(select 1 from inventory_position_reconciliation_exceptions exception
        where exception.company_id=item.company_id and exception.inventory_item_id=item.id and exception.status='open')
      or exists(select 1 from part_allocations allocation
        where allocation.inventory_item_id=item.id and allocation.status in ('reserved','issued'))
    ) limit 1`,[companyId,inventoryItemId]);
  return Boolean(result.rows[0]);
}

async function lockInventoryItemForPart(client,{companyId,locationId,catalogPartId,uomCode}){
  const result=await client.query(`select id from inventory_items where company_id=$1 and location_id=$2
    and catalog_part_id=$3 and uom_code=$4 and source_provider='local'
    order by updated_at desc,id limit 1 for update`,[companyId,locationId,catalogPartId,uomCode]);
  return result.rows[0]?.id||null;
}

async function lockInventoryItemById(client,{companyId,locationId,inventoryItemId}){
  const result=await client.query(`select id from inventory_items where company_id=$1 and location_id=$2 and id=$3 for update`,
    [companyId,locationId,inventoryItemId]);
  if(!result.rows[0])throw new Error("Inventory stock balance changed before physical stock could be written.");
}

async function lockInventoryPositionsForWrite(client,{companyId,locationId,positionIds}){
  const ids=[...new Set(positionIds.filter(Boolean))].sort();
  if(!ids.length)return [];
  const result=await client.query(`select id from inventory_positions where company_id=$1 and location_id=$2
    and id=any($3::uuid[]) order by id for update`,[companyId,locationId,ids]);
  if(result.rowCount!==ids.length)throw new Error("Inventory position changed before physical stock could be written.");
  return result.rows.map((row)=>row.id);
}

function positionRow(row) {
  return { id: row.id, parentId: row.parent_id, code: row.code, name: row.name, kind: row.kind,
    usage: row.usage, canStore: row.can_store, isPickable: row.is_pickable, isActive: row.is_active,
    systemKey: row.system_key, version: row.version, path: row.path, moveAllowed: Boolean(row.is_active && row.can_store && row.is_pickable) };
}
async function loadPositionWithPath(client,companyId,positionId){
  const result=await client.query(`with recursive ancestors as (
    select position.*,0 depth from inventory_positions position where position.company_id=$1 and position.id=$2
    union all select parent.*,ancestors.depth+1 from inventory_positions parent join ancestors on ancestors.parent_id=parent.id
      where parent.company_id=ancestors.company_id and parent.location_id=ancestors.location_id
  ) select leaf.*,(select string_agg(name,' / ' order by depth desc) from ancestors) path from ancestors leaf where leaf.id=$2`,[companyId,positionId]);
  return result.rows[0]||null;
}

export async function ensureSystemInventoryPosition(client, { companyId, locationId, systemKey = "unassigned" }) {
  const defaults = systemKey === "receiving"
    ? { code:"SYS-RECEIVING",name:"Receiving",usage:"receiving" }
    : { code:"SYS-UNASSIGNED",name:"Unassigned",usage:"unassigned" };
  await client.query(
    `insert into inventory_positions(company_id,location_id,code,name,kind,usage,can_store,is_pickable,system_key)
     values($1,$2,$3,$4,'area',$5,true,true,$5)
     on conflict(company_id,location_id,system_key) where system_key is not null do nothing`,
    [companyId,locationId,defaults.code,defaults.name,defaults.usage],
  );
  const selected = await client.query(
    `select id from inventory_positions where company_id=$1 and location_id=$2 and system_key=$3 limit 1`,
    [companyId, locationId, systemKey],
  );
  if (!selected.rows[0]) throw new Error(`System inventory position ${systemKey} is missing.`);
  return selected.rows[0].id;
}

async function resolveReceiptPosition(client, { companyId, locationId, targetPositionId = null, systemKey = "receiving" }) {
  if (!targetPositionId) return ensureSystemInventoryPosition(client, { companyId, locationId, systemKey });
  const target = await client.query(
    `select id from inventory_positions where company_id=$1 and location_id=$2 and id=$3
       and is_active and can_store and is_pickable and usage='storage' and system_key is null for update`,
    [companyId, locationId, targetPositionId],
  );
  if (!target.rows[0]) {
    const error = new Error("Receipt target position is not eligible.");
    error.code = "INVENTORY_RECEIPT_POSITION_INVALID";
    throw error;
  }
  return target.rows[0].id;
}

export async function placeAggregateInventoryReceipt(client, { companyId, locationId, inventoryItemId, catalogPartId,
  uomCode, quantity, actorId, idempotencyKey, requestHash = null, receiptId = null, systemKey = "receiving", targetPositionId = null, reason = "Inventory received" }) {
  const lockedItemId=await lockInventoryItemForPart(client,{companyId,locationId,catalogPartId,uomCode});
  if(lockedItemId!==inventoryItemId)throw new Error("Aggregate receipt stock balance changed before physical placement.");
  const positionId = await resolveReceiptPosition(client, { companyId, locationId, targetPositionId, systemKey });
  await lockInventoryPositionsForWrite(client,{companyId,locationId,positionIds:[positionId]});
  const operationId = randomUUID();
  await client.query(
    `insert into inventory_position_operations(id,company_id,location_id,actor_id,command_type,idempotency_key,request_hash,reason,receipt_id)
     values($1,$2,$3,$4,'receipt',$5,$6,$7,$8)`,
    [operationId,companyId,locationId,actorId,idempotencyKey,requestHash || digest({ inventoryItemId,quantity,receiptId }),reason,receiptId],
  );
  await client.query(
    `insert into inventory_position_balances(company_id,location_id,position_id,inventory_item_id,catalog_part_id,uom_code,quantity)
     values($1,$2,$3,$4,$5,$6,$7)
     on conflict(company_id,position_id,inventory_item_id) do update set quantity=inventory_position_balances.quantity+excluded.quantity,
       version=inventory_position_balances.version+1,updated_at=now()`,
    [companyId,locationId,positionId,inventoryItemId,catalogPartId,uomCode,quantity],
  );
  await client.query(
    `insert into inventory_position_movements(operation_id,company_id,location_id,catalog_part_id,uom_code,quantity,to_position_id)
     values($1,$2,$3,$4,$5,$6,$7)`,
    [operationId,companyId,locationId,catalogPartId,uomCode,quantity,positionId],
  );
  return positionId;
}

export async function placeSerializedInventoryReceipt(client, { companyId, locationId, catalogPartId, uomCode,
  unitIds, actorId, idempotencyKey, requestHash = null, receiptId = null, systemKey = "receiving", targetPositionId = null, reason = "Inventory received" }) {
  const lockedUnits=await client.query(`select id from inventory_serialized_units where company_id=$1 and location_id=$2
    and id=any($3::uuid[]) order by id for update`,[companyId,locationId,unitIds]);
  if(lockedUnits.rowCount!==unitIds.length)throw new Error("Serialized receipt placement did not match every exact unit.");
  if(!await lockInventoryItemForPart(client,{companyId,locationId,catalogPartId,uomCode}))throw new Error("Serialized receipt stock balance is missing.");
  const positionId = await resolveReceiptPosition(client, { companyId, locationId, targetPositionId, systemKey });
  await lockInventoryPositionsForWrite(client,{companyId,locationId,positionIds:[positionId]});
  const operationId = randomUUID();
  await client.query(
    `insert into inventory_position_operations(id,company_id,location_id,actor_id,command_type,idempotency_key,request_hash,reason,receipt_id)
     values($1,$2,$3,$4,'receipt',$5,$6,$7,$8)`,
    [operationId,companyId,locationId,actorId,idempotencyKey,requestHash || digest({ unitIds,receiptId }),reason,receiptId],
  );
  const updated = await client.query(
    `update inventory_serialized_units set current_position_id=$4,custody_bin_location='',custody_version=custody_version+1,updated_at=now()
     where company_id=$1 and location_id=$2 and id=any($3::uuid[]) and custody_holder_type='inventory_location' returning id`,
    [companyId,locationId,unitIds,positionId],
  );
  if (updated.rowCount !== unitIds.length) throw new Error("Serialized receipt placement did not match every exact unit.");
  await client.query(
    `insert into inventory_position_movements(operation_id,company_id,location_id,catalog_part_id,uom_code,quantity,unit_id,to_position_id)
     select $1,$2,$3,$4,$5,1,input.id,$6 from unnest($7::uuid[]) input(id)`,
    [operationId,companyId,locationId,catalogPartId,uomCode,positionId,unitIds],
  );
  return positionId;
}

export async function lockEligibleExactInventoryPosition(client,{companyId,locationId,unitId}){
  const unit=await client.query(`select current_position_id from inventory_serialized_units
    where company_id=$1 and location_id=$2 and id=$3 for update`,[companyId,locationId,unitId]);
  if(!unit.rows[0]?.current_position_id)return null;
  const position=await client.query(`select id from inventory_positions where company_id=$1 and location_id=$2 and id=$3
    and is_active and can_store and is_pickable`,[companyId,locationId,unit.rows[0].current_position_id]);
  return position.rows[0]?.id||null;
}

export async function pickExactInventoryUnitFromPosition(client,{companyId,locationId,catalogPartId,uomCode,unitId,actorId,idempotencyKey,workorderId,reason}){
  const positionId=await lockEligibleExactInventoryPosition(client,{companyId,locationId,unitId});
  if(!positionId)throw new Error("Exact inventory unit has no eligible physical position.");
  if(!await lockInventoryItemForPart(client,{companyId,locationId,catalogPartId,uomCode}))throw new Error("Exact inventory unit has no matching stock balance.");
  await lockInventoryPositionsForWrite(client,{companyId,locationId,positionIds:[positionId]});
  const operationId=randomUUID(),requestHash=digest({unitId,positionId,workorderId});
  await client.query(`insert into inventory_position_operations(id,company_id,location_id,actor_id,command_type,idempotency_key,request_hash,reason,workorder_id)
    values($1,$2,$3,$4,'workorder_pick',$5,$6,$7,$8)`,[operationId,companyId,locationId,actorId,idempotencyKey,requestHash,reason,workorderId]);
  const updated=await client.query(`update inventory_serialized_units set current_position_id=null,custody_bin_location='',custody_version=custody_version+1,updated_at=now()
    where company_id=$1 and id=$2 and current_position_id=$3 returning id`,[companyId,unitId,positionId]);
  if(!updated.rows[0])throw new Error("Exact inventory unit position changed before pick.");
  await client.query(`insert into inventory_position_movements(operation_id,company_id,location_id,catalog_part_id,uom_code,quantity,unit_id,from_position_id)
    values($1,$2,$3,$4,$5,1,$6,$7)`,[operationId,companyId,locationId,catalogPartId,uomCode,unitId,positionId]);
  return operationId;
}

export async function returnExactInventoryUnitToPosition(client,{companyId,locationId,catalogPartId,uomCode,unitId,actorId,idempotencyKey,workorderId=null,reason,systemKey="unassigned",targetPositionId=null,commandType="workorder_return"}){
  const unit=await client.query(`select id from inventory_serialized_units where company_id=$1 and location_id=$2 and id=$3 for update`,[companyId,locationId,unitId]);
  if(!unit.rows[0])throw new Error("Exact inventory unit is missing for physical return.");
  if(!await lockInventoryItemForPart(client,{companyId,locationId,catalogPartId,uomCode}))throw new Error("Exact inventory unit has no matching stock balance.");
  let positionId;
  if(targetPositionId){
    const target=await client.query(`select id from inventory_positions where company_id=$1 and location_id=$2 and id=$3
      and is_active and usage='storage' and can_store and is_pickable and system_key is null for update`,[companyId,locationId,targetPositionId]);
    if(!target.rows[0]){
      const error=new Error("Reuse release target position is not eligible.");
      error.code="INVENTORY_REUSE_POSITION_INVALID";
      throw error;
    }
    positionId=target.rows[0].id;
  }else positionId=await ensureSystemInventoryPosition(client,{companyId,locationId,systemKey});
  await lockInventoryPositionsForWrite(client,{companyId,locationId,positionIds:[positionId]});
  const operationId=randomUUID(),requestHash=digest({unitId,positionId,workorderId,commandType});
  await client.query(`insert into inventory_position_operations(id,company_id,location_id,actor_id,command_type,idempotency_key,request_hash,reason,workorder_id)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[operationId,companyId,locationId,actorId,commandType,idempotencyKey,requestHash,reason,workorderId]);
  await client.query(`update inventory_serialized_units set current_position_id=$3,custody_bin_location='',custody_version=custody_version+1,updated_at=now()
    where company_id=$1 and id=$2`,[companyId,unitId,positionId]);
  await client.query(`insert into inventory_position_movements(operation_id,company_id,location_id,catalog_part_id,uom_code,quantity,unit_id,to_position_id)
    values($1,$2,$3,$4,$5,1,$6,$7)`,[operationId,companyId,locationId,catalogPartId,uomCode,unitId,positionId]);
  return operationId;
}

export async function reserveAggregateInventoryPositions(client,{companyId,locationId,inventoryItemId,catalogPartId,uomCode,usageId,quantity,sourcePositionId=null}){
  await lockInventoryItemById(client,{companyId,locationId,inventoryItemId});
  if(await hasAggregatePositionReconciliationConflict(client,companyId,inventoryItemId))throw new Error("Aggregate inventory positions require reconciliation.");
  const positions=await client.query(`select position.id from inventory_positions position where position.company_id=$1 and position.location_id=$2
      and position.is_active and position.is_pickable and exists(select 1 from inventory_position_balances balance
        where balance.company_id=position.company_id and balance.position_id=position.id and balance.inventory_item_id=$3)
      and ($4::uuid is null or position.id=$4)
    order by case position.usage when 'storage' then 0 when 'receiving' then 1 else 2 end,position.code,position.id for update`,[companyId,locationId,inventoryItemId,sourcePositionId]);
  const positionIds=positions.rows.map((row)=>row.id);
  const balances=positionIds.length?await client.query(`select balance.*,position.usage,position.code from inventory_position_balances balance join inventory_positions position
    on position.company_id=balance.company_id and position.id=balance.position_id where balance.company_id=$1 and balance.location_id=$2
      and balance.inventory_item_id=$3 and balance.position_id=any($4::uuid[])
    order by case position.usage when 'storage' then 0 when 'receiving' then 1 else 2 end,position.code,position.id for update of balance`,[companyId,locationId,inventoryItemId,positionIds]):{rows:[]};
  let remaining=num(quantity);
  for(const row of balances.rows){const available=num(row.quantity)-num(row.quantity_reserved);if(available<=0)continue;const take=Math.min(available,remaining);
    await client.query(`update inventory_position_balances set quantity_reserved=quantity_reserved+$4,version=version+1,updated_at=now()
      where company_id=$1 and position_id=$2 and inventory_item_id=$3`,[companyId,row.position_id,inventoryItemId,take]);
    await client.query(`insert into inventory_aggregate_usage_position_allocations(company_id,usage_id,position_id,inventory_item_id,quantity)
      values($1,$2,$3,$4,$5)`,[companyId,usageId,row.position_id,inventoryItemId,take]);remaining-=take;if(remaining<=0)break;}
  if(remaining>0)throw new Error("Eligible physical position stock is lower than the accounted available balance.");
}

export async function pickAggregateInventoryPositions(client,{companyId,locationId,catalogPartId,uomCode,usageId,actorId,workorderId,reason}){
  const allocations=await client.query(`select allocation.* from inventory_aggregate_usage_position_allocations allocation
    where allocation.company_id=$1 and allocation.usage_id=$2 order by allocation.position_id for update`,[companyId,usageId]);
  if(!allocations.rows.length)throw new Error("Aggregate reservation has no physical position allocation.");
  if(allocations.rows.every((row)=>row.status==="picked"))return null;
  if(allocations.rows.some((row)=>row.status!=="reserved"))throw new Error("Aggregate physical allocation is not available to pick.");
  const itemIds=[...new Set(allocations.rows.map((row)=>row.inventory_item_id))].sort();
  const items=await client.query(`select id from inventory_items where company_id=$1 and id=any($2::uuid[]) order by id for update`,[companyId,itemIds]);
  if(items.rowCount!==itemIds.length)throw new Error("Aggregate reservation stock balance is missing.");
  await lockInventoryPositionsForWrite(client,{companyId,locationId,positionIds:allocations.rows.map((row)=>row.position_id)});
  const balances=await client.query(`select balance.position_id,balance.inventory_item_id from inventory_position_balances balance
    where balance.company_id=$1 and (balance.position_id,balance.inventory_item_id) in
      (select allocation.position_id,allocation.inventory_item_id from inventory_aggregate_usage_position_allocations allocation where allocation.company_id=$1 and allocation.usage_id=$2)
    order by balance.position_id,balance.inventory_item_id for update`,[companyId,usageId]);
  if(balances.rowCount!==allocations.rowCount)throw new Error("Aggregate reservation physical balance is missing.");
  const operationId=randomUUID();
  await client.query(`insert into inventory_position_operations(id,company_id,location_id,actor_id,command_type,idempotency_key,request_hash,reason,workorder_id)
    values($1,$2,$3,$4,'workorder_pick',$5,$6,$7,$8)`,[operationId,companyId,locationId,actorId,`position:aggregate-pick:${usageId}`,digest({usageId,workorderId}),reason,workorderId]);
  for(const allocation of allocations.rows){await client.query(`update inventory_position_balances set quantity=quantity-$4,quantity_reserved=quantity_reserved-$4,version=version+1,updated_at=now()
      where company_id=$1 and position_id=$2 and inventory_item_id=$3 and quantity>=$4 and quantity_reserved>=$4`,[companyId,allocation.position_id,allocation.inventory_item_id,allocation.quantity]);
    await client.query(`update inventory_aggregate_usage_position_allocations set status='picked',updated_at=now() where company_id=$1 and usage_id=$2 and position_id=$3`,[companyId,usageId,allocation.position_id]);
    await client.query(`insert into inventory_position_movements(operation_id,company_id,location_id,catalog_part_id,uom_code,quantity,from_position_id)
      values($1,$2,$3,$4,$5,$6,$7)`,[operationId,companyId,locationId,catalogPartId,uomCode,allocation.quantity,allocation.position_id]);}
}

export async function releaseAggregateInventoryPositions(client,{companyId,usageId,actorId=null,workorderId=null,reason="Aggregate reservation released"}){
  const allocations=await client.query(`select allocation.*,balance.location_id,balance.catalog_part_id,balance.uom_code from inventory_aggregate_usage_position_allocations allocation
    join inventory_position_balances balance on balance.company_id=allocation.company_id and balance.position_id=allocation.position_id
      and balance.inventory_item_id=allocation.inventory_item_id
    where allocation.company_id=$1 and allocation.usage_id=$2 order by allocation.position_id for update of allocation`,[companyId,usageId]);
  const itemIds=[...new Set(allocations.rows.map((row)=>row.inventory_item_id))].sort();
  const picked=allocations.rows.filter((row)=>row.status==="picked");
  if(picked.length&&!actorId)throw new Error("Picked inventory requires an actor for physical return.");
  const targetPositionId=picked.length?await ensureSystemInventoryPosition(client,{companyId,locationId:picked[0].location_id,systemKey:"unassigned"}):null;
  if(itemIds.length){
    const items=await client.query(`select id from inventory_items where company_id=$1 and id=any($2::uuid[]) order by id for update`,[companyId,itemIds]);
    if(items.rowCount!==itemIds.length)throw new Error("Aggregate release stock balance is missing.");
    await lockInventoryPositionsForWrite(client,{companyId,locationId:allocations.rows[0].location_id,positionIds:[...allocations.rows.map((row)=>row.position_id),targetPositionId]});
    const balances=await client.query(`select balance.position_id,balance.inventory_item_id from inventory_position_balances balance
      where balance.company_id=$1 and (balance.position_id,balance.inventory_item_id) in
        (select allocation.position_id,allocation.inventory_item_id from inventory_aggregate_usage_position_allocations allocation where allocation.company_id=$1 and allocation.usage_id=$2)
      order by balance.position_id,balance.inventory_item_id for update`,[companyId,usageId]);
    if(balances.rowCount!==allocations.rowCount)throw new Error("Aggregate release physical balance is missing.");
  }
  for(const allocation of allocations.rows.filter((row)=>row.status==="reserved")){await client.query(`update inventory_position_balances set quantity_reserved=quantity_reserved-$4,version=version+1,updated_at=now()
    where company_id=$1 and position_id=$2 and inventory_item_id=$3 and quantity_reserved>=$4`,[companyId,allocation.position_id,allocation.inventory_item_id,allocation.quantity]);
    await client.query(`update inventory_aggregate_usage_position_allocations set status='released',updated_at=now() where company_id=$1 and usage_id=$2 and position_id=$3`,[companyId,usageId,allocation.position_id]);}
  if(!picked.length)return;
  const {location_id:locationId,catalog_part_id:catalogPartId,uom_code:uomCode,inventory_item_id:inventoryItemId}=picked[0];
  if(picked.some((row)=>row.location_id!==locationId||row.inventory_item_id!==inventoryItemId))throw new Error("Aggregate physical allocations do not share one stock balance.");
  const operationId=randomUUID();
  await client.query(`insert into inventory_position_operations(id,company_id,location_id,actor_id,command_type,idempotency_key,request_hash,reason,workorder_id)
    values($1,$2,$3,$4,'workorder_return',$5,$6,$7,$8)`,[operationId,companyId,locationId,actorId,`position:aggregate-release:${usageId}`,digest({usageId,workorderId}),reason,workorderId]);
  for(const allocation of picked){
    await client.query(`insert into inventory_position_balances(company_id,location_id,position_id,inventory_item_id,catalog_part_id,uom_code,quantity)
      values($1,$2,$3,$4,$5,$6,$7) on conflict(company_id,position_id,inventory_item_id) do update set
      quantity=inventory_position_balances.quantity+excluded.quantity,version=inventory_position_balances.version+1,updated_at=now()`,
    [companyId,locationId,targetPositionId,inventoryItemId,catalogPartId,uomCode,allocation.quantity]);
    await client.query(`insert into inventory_position_movements(operation_id,company_id,location_id,catalog_part_id,uom_code,quantity,to_position_id)
      values($1,$2,$3,$4,$5,$6,$7)`,[operationId,companyId,locationId,catalogPartId,uomCode,allocation.quantity,targetPositionId]);
    await client.query(`update inventory_aggregate_usage_position_allocations set status='released',updated_at=now()
      where company_id=$1 and usage_id=$2 and position_id=$3 and status='picked'`,[companyId,usageId,allocation.position_id]);
  }
}

export async function consumeAggregateInventoryPositions(client,{companyId,usageId}){
  await client.query(`update inventory_aggregate_usage_position_allocations set status='consumed',updated_at=now()
    where company_id=$1 and usage_id=$2 and status='picked'`,[companyId,usageId]);
}

export async function adjustConsumedAggregateInventoryPositions(client,{companyId,locationId,inventoryItemId,catalogPartId,uomCode,usageId,actorId,workorderId,quantityDelta,reason,idempotencyKey}){
  if(quantityDelta===0)return;
  await lockInventoryItemById(client,{companyId,locationId,inventoryItemId});
  const operationId=randomUUID(),taking=quantityDelta>0;
  await client.query(`insert into inventory_position_operations(id,company_id,location_id,actor_id,command_type,idempotency_key,request_hash,reason,workorder_id)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[operationId,companyId,locationId,actorId,taking?"workorder_pick":"workorder_return",
    `position:aggregate-adjust:${digest(idempotencyKey)}`,digest({usageId,quantityDelta,idempotencyKey}),reason,workorderId]);
  if(taking){
    const positions=await client.query(`select position.id from inventory_positions position where position.company_id=$1 and position.location_id=$2
      and position.is_active and position.is_pickable and exists(select 1 from inventory_position_balances balance
        where balance.company_id=position.company_id and balance.position_id=position.id and balance.inventory_item_id=$3)
      order by position.code,position.id for update`,[companyId,locationId,inventoryItemId]);
    const positionIds=positions.rows.map((row)=>row.id);
    const balances=positionIds.length?await client.query(`select balance.* from inventory_position_balances balance join inventory_positions position
      on position.company_id=balance.company_id and position.id=balance.position_id where balance.company_id=$1 and balance.location_id=$2
      and balance.inventory_item_id=$3 and balance.position_id=any($4::uuid[]) order by position.code,position.id for update of balance`,[companyId,locationId,inventoryItemId,positionIds]):{rows:[]};
    let remaining=quantityDelta;
    for(const row of balances.rows){const available=num(row.quantity)-num(row.quantity_reserved);if(available<=0)continue;const take=Math.min(remaining,available);
      await client.query(`update inventory_position_balances set quantity=quantity-$4,version=version+1,updated_at=now()
        where company_id=$1 and position_id=$2 and inventory_item_id=$3`,[companyId,row.position_id,inventoryItemId,take]);
      await client.query(`insert into inventory_position_movements(operation_id,company_id,location_id,catalog_part_id,uom_code,quantity,from_position_id)
        values($1,$2,$3,$4,$5,$6,$7)`,[operationId,companyId,locationId,catalogPartId,uomCode,take,row.position_id]);remaining-=take;if(remaining<=0)break;}
    if(remaining>0)throw new Error("Physical position stock is insufficient for the usage adjustment.");
  }else{
    const positionId=await ensureSystemInventoryPosition(client,{companyId,locationId,systemKey:"unassigned"}),returned=Math.abs(quantityDelta);
    await lockInventoryPositionsForWrite(client,{companyId,locationId,positionIds:[positionId]});
    await client.query(`insert into inventory_position_balances(company_id,location_id,position_id,inventory_item_id,catalog_part_id,uom_code,quantity)
      values($1,$2,$3,$4,$5,$6,$7) on conflict(company_id,position_id,inventory_item_id) do update set
      quantity=inventory_position_balances.quantity+excluded.quantity,version=inventory_position_balances.version+1,updated_at=now()`,[companyId,locationId,positionId,inventoryItemId,catalogPartId,uomCode,returned]);
    await client.query(`insert into inventory_position_movements(operation_id,company_id,location_id,catalog_part_id,uom_code,quantity,to_position_id)
      values($1,$2,$3,$4,$5,$6,$7)`,[operationId,companyId,locationId,catalogPartId,uomCode,returned,positionId]);
  }
}

export async function listInventoryPositions({ companyIds, locationIds, isAdmin, locationId }) {
  const result = await getPool().query(
    `with recursive tree as (
       select p.*,p.name::text path from inventory_positions p
       where p.location_id=$1 and p.company_id=any($2::uuid[]) and ($4::boolean or p.location_id=any($3::uuid[])) and p.parent_id is null
       union all select child.*,(tree.path||' / '||child.name)::text from inventory_positions child join tree
         on child.company_id=tree.company_id and child.location_id=tree.location_id and child.parent_id=tree.id
     ) select * from tree order by path,id`, [locationId,companyIds,locationIds,isAdmin],
  );
  return result.rows.map(positionRow);
}

export async function insertInventoryPosition(input) {
  const client = await getPool().connect();
  const requestHash = digest({ locationId: input.locationId, parentId: input.parentId, code: input.code.toUpperCase(),
    name: input.name, kind: input.kind, usage: input.usage, canStore: input.canStore, isPickable: input.isPickable });
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [`inventory-position:${input.actorId}:${input.idempotencyKey}`]);
    const prior = await client.query(
      `select command.request_hash,position.* from inventory_position_admin_commands command
       join inventory_positions position on position.company_id=command.company_id and position.id=command.position_id
       where command.company_id=any($1::uuid[]) and command.actor_id=$2 and command.idempotency_key=$3`,
      [input.companyIds,input.actorId,input.idempotencyKey],
    );
    if (prior.rows[0]) { const replayed=await loadPositionWithPath(client,prior.rows[0].company_id,prior.rows[0].id);await client.query("commit"); return prior.rows[0].request_hash===requestHash
      ? { kind:"replay",position:positionRow(replayed) } : { kind:"idempotency_conflict" }; }
    const shop = await client.query(`select company_id from locations where id=$1 and company_id=any($2::uuid[])
      and ($4::boolean or id=any($3::uuid[])) for share`, [input.locationId,input.companyIds,input.locationIds,input.isAdmin]);
    if (!shop.rows[0]) { await client.query("rollback"); return { kind:"not_found" }; }
    if (input.parentId) {
      const parent = await client.query(`select id,kind from inventory_positions where company_id=$1 and location_id=$2 and id=$3 and is_active for share`,
        [shop.rows[0].company_id,input.locationId,input.parentId]);
      if (!parent.rows[0]) { await client.query("rollback"); return { kind:"parent_not_found" }; }
      if (!canNestPositionKind(parent.rows[0].kind,input.kind)) { await client.query("rollback"); return { kind:"invalid_parent_kind" }; }
    }
    const id = randomUUID();
    const created = await client.query(
      `insert into inventory_positions(id,company_id,location_id,parent_id,code,name,kind,usage,can_store,is_pickable,created_by)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *,name path`,
      [id,shop.rows[0].company_id,input.locationId,input.parentId,input.code,input.name,input.kind,input.usage,input.canStore,input.isPickable,input.actorId],
    );
    await client.query(`insert into inventory_position_admin_commands(company_id,actor_id,action,idempotency_key,request_hash,position_id)
      values($1,$2,'create',$3,$4,$5)`, [shop.rows[0].company_id,input.actorId,input.idempotencyKey,requestHash,id]);
    const value=await loadPositionWithPath(client,shop.rows[0].company_id,id);await client.query("commit");
    return { kind:"created",position:positionRow(value) };
  } catch (error) { await client.query("rollback").catch(()=>{}); if (error.code==="23505") return { kind:"conflict" }; throw error; }
  finally { client.release(); }
}

export async function patchInventoryPosition(input) {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const selected = await client.query(`select * from inventory_positions where id=$1 and company_id=any($2::uuid[])
      and ($4::boolean or location_id=any($3::uuid[])) for update`, [input.positionId,input.companyIds,input.locationIds,input.isAdmin]);
    const current=selected.rows[0]; if(!current){await client.query("rollback");return {kind:"not_found"};}
    if(current.version!==input.expectedVersion){await client.query("rollback");return {kind:"stale"};}
    const updated=await client.query(`update inventory_positions set name=coalesce($3,name),is_active=coalesce($4,is_active),version=version+1,updated_at=now()
      where company_id=$1 and id=$2 returning *,name path`,[current.company_id,current.id,input.name??null,input.isActive??null]);
    const value=await loadPositionWithPath(client,current.company_id,current.id);await client.query("commit");return {kind:"updated",position:positionRow(value)};
  } catch(error){await client.query("rollback").catch(()=>{});if(error.code==="P0001")return{kind:"archive_blocked"};throw error;}
  finally{client.release();}
}

export async function listPositionStock(input) {
  const pool=getPool();
  const params=[input.positionId,input.locationId,input.companyIds,input.locationIds,input.isAdmin,input.scope];
  const result=await pool.query(`with recursive selected as (
      select position.id,0 depth from inventory_positions position
      where position.id=$1 and position.location_id=$2 and position.company_id=any($3::uuid[])
        and ($5::boolean or position.location_id=any($4::uuid[]))
    ), tree as (
      select * from selected
      union all select child.id,tree.depth+1 from inventory_positions child join tree on child.parent_id=tree.id
        where $6::text='subtree' and child.location_id=$2 and child.company_id=any($3::uuid[])
    ), aggregate_stock as (
      select balance.catalog_part_id,
        sum(case when tree.depth=0 then balance.quantity else 0 end) direct_quantity,
        sum(case when tree.depth>0 then balance.quantity else 0 end) descendant_quantity,
        sum(case when tree.depth=0 then balance.quantity_reserved else 0 end) direct_reserved,
        sum(case when tree.depth>0 then balance.quantity_reserved else 0 end) descendant_reserved
      from tree join inventory_position_balances balance on balance.position_id=tree.id and balance.company_id=any($3::uuid[])
        join inventory_items item on item.id=balance.inventory_item_id and item.company_id=balance.company_id and item.location_id=$2
        join parts_catalog part on part.id=balance.catalog_part_id and part.company_id=balance.company_id
      where coalesce(part.tracking_mode,'quantity')<>'serialized' and item.source_provider='local'
      group by balance.catalog_part_id
    ), serialized_stock as (
      select line.catalog_part_id,
        count(*) filter(where tree.depth=0)::numeric direct_quantity,
        count(*) filter(where tree.depth>0)::numeric descendant_quantity,
        count(*) filter(where tree.depth=0 and unit.status='reserved')::numeric direct_reserved,
        count(*) filter(where tree.depth>0 and unit.status='reserved')::numeric descendant_reserved
      from tree join inventory_serialized_units unit on unit.current_position_id=tree.id and unit.company_id=any($3::uuid[]) and unit.location_id=$2
        join inventory_receipt_lines line on line.id=unit.receipt_line_id and line.company_id=unit.company_id
      where unit.status in ('in_stock','reserved')
      group by line.catalog_part_id
    ), stock as (
      select * from aggregate_stock union all select * from serialized_stock
    ) select part.id,part.part_number,part.description,part.uom_code,part.tracking_mode,
        stock.direct_quantity,stock.descendant_quantity,stock.direct_reserved,stock.descendant_reserved
      from stock join parts_catalog part on part.id=stock.catalog_part_id and part.company_id=any($3::uuid[])
      where $6::text='subtree' or stock.direct_quantity<>0 or stock.direct_reserved<>0
      order by part.part_number,part.id`,params);
  if(!result.rows.length){
    const position=await pool.query(`select 1 from inventory_positions where id=$1 and location_id=$2 and company_id=any($3::uuid[])
      and ($5::boolean or location_id=any($4::uuid[]))`,[input.positionId,input.locationId,input.companyIds,input.locationIds,input.isAdmin]);
    if(!position.rows[0])return null;
  }
  const placements=result.rows.length?await pool.query(`with recursive selected as (
      select position.id,0 depth,array[position.code::text] path_codes,array[position.name::text] path_names,array[position.kind::text] path_kinds
      from inventory_positions position
      where position.id=$1 and position.location_id=$2 and position.company_id=any($3::uuid[])
        and ($5::boolean or position.location_id=any($4::uuid[]))
    ), tree as (
      select * from selected
      union all select child.id,tree.depth+1,tree.path_codes||child.code::text,tree.path_names||child.name::text,tree.path_kinds||child.kind::text
        from inventory_positions child join tree on child.parent_id=tree.id
        where $6::text='subtree' and child.location_id=$2 and child.company_id=any($3::uuid[])
    ), placed as (
      select balance.catalog_part_id,tree.id position_id,tree.depth,tree.path_codes,tree.path_names,tree.path_kinds,
        sum(balance.quantity)::numeric quantity,sum(balance.quantity_reserved)::numeric reserved
      from tree join inventory_position_balances balance on balance.position_id=tree.id and balance.company_id=any($3::uuid[])
        join inventory_items item on item.id=balance.inventory_item_id and item.company_id=balance.company_id and item.location_id=$2
        join parts_catalog part on part.id=balance.catalog_part_id and part.company_id=balance.company_id
      where coalesce(part.tracking_mode,'quantity')<>'serialized' and item.source_provider='local'
      group by balance.catalog_part_id,tree.id,tree.depth,tree.path_codes,tree.path_names,tree.path_kinds
      union all
      select line.catalog_part_id,tree.id position_id,tree.depth,tree.path_codes,tree.path_names,tree.path_kinds,
        count(*)::numeric quantity,count(*) filter(where unit.status='reserved')::numeric reserved
      from tree join inventory_serialized_units unit on unit.current_position_id=tree.id and unit.company_id=any($3::uuid[]) and unit.location_id=$2
        join inventory_receipt_lines line on line.id=unit.receipt_line_id and line.company_id=unit.company_id
      where unit.status in ('in_stock','reserved')
      group by line.catalog_part_id,tree.id,tree.depth,tree.path_codes,tree.path_names,tree.path_kinds
    ) select placed.*,position.code,position.name,position.kind
      from placed join inventory_positions position on position.id=placed.position_id
      where placed.quantity<>0 or placed.reserved<>0
      order by placed.catalog_part_id,placed.path_codes`,params):{rows:[]};
  const placementsByPart=new Map();
  for(const row of placements.rows){
    const placement={positionId:row.position_id,code:row.code,name:row.name,kind:row.kind,depth:Number(row.depth),pathCodes:row.path_codes||[],pathNames:row.path_names||[],pathKinds:row.path_kinds||[],quantity:num(row.quantity),reserved:num(row.reserved)};
    const current=placementsByPart.get(row.catalog_part_id)||[];current.push(placement);placementsByPart.set(row.catalog_part_id,current);
  }
  return {scope:input.scope,parts:result.rows.map((row)=>{const directQuantity=num(row.direct_quantity);const descendantQuantity=num(row.descendant_quantity);const directReserved=num(row.direct_reserved);const descendantReserved=num(row.descendant_reserved);return {
    id:row.id,partNumber:row.part_number,description:row.description,uomCode:row.uom_code,trackingMode:row.tracking_mode,
    directQuantity,descendantQuantity,subtreeQuantity:directQuantity+descendantQuantity,
    directReserved,descendantReserved,subtreeReserved:directReserved+descendantReserved,placements:placementsByPart.get(row.id)||[],
  };})};
}

export async function getPartPositions(input) {
  const pool=getPool();
  const part=await pool.query(`select part.company_id,part.id,part.tracking_mode,part.uom_code from parts_catalog part join locations location
    on location.company_id=part.company_id and location.id=$2 where part.id=$1 and part.company_id=any($3::uuid[])
    and ($5::boolean or location.id=any($4::uuid[])) limit 1`,[input.partId,input.locationId,input.companyIds,input.locationIds,input.isAdmin]);
  if(!part.rows[0])return null;
  const item=await pool.query(`select id from inventory_items where company_id=$1 and location_id=$2 and catalog_part_id=$3 and uom_code=$4 and source_provider='local'
    order by updated_at desc,id limit 1`,[part.rows[0].company_id,input.locationId,input.partId,part.rows[0].uom_code]);
  const [positions,balances,units,exceptions]=await Promise.all([
    listInventoryPositions(input),
    item.rows[0]?pool.query(`select balance.*,position.system_key from inventory_position_balances balance join inventory_positions position
      on position.company_id=balance.company_id and position.id=balance.position_id where balance.company_id=$1 and balance.inventory_item_id=$2`,[part.rows[0].company_id,item.rows[0].id]):{rows:[]},
    pool.query(`select unit.id,unit.serial_number,unit.current_position_id,unit.status,unit.condition_code,unit.custody_legacy_available,unit.custody_version
      from inventory_serialized_units unit join inventory_receipt_lines line on line.company_id=unit.company_id and line.id=unit.receipt_line_id
      where unit.company_id=$1 and unit.location_id=$2 and line.catalog_part_id=$3 order by unit.serial_number,unit.id`,[part.rows[0].company_id,input.locationId,input.partId]),
    item.rows[0]?pool.query(`select exception_code from inventory_position_reconciliation_exceptions where company_id=$1 and inventory_item_id=$2 and status='open'
      union select 'active_legacy_allocation' where exists(select 1 from part_allocations where inventory_item_id=$2 and status in ('reserved','issued'))
      order by exception_code`,[part.rows[0].company_id,item.rows[0].id]):{rows:[]},
  ]);
  const byId=new Map(balances.rows.map((row)=>[row.position_id,row]));
  const serialByPosition=new Map();
  for(const unit of units.rows){
    if(!unit.current_position_id||!["in_stock","reserved"].includes(unit.status))continue;
    const value=serialByPosition.get(unit.current_position_id)||{quantity:0,reserved:0};
    value.quantity+=1;if(unit.status==="reserved")value.reserved+=1;serialByPosition.set(unit.current_position_id,value);
  }
  const reconciliationRequired=exceptions.rows.length>0;
  return { trackingMode:part.rows[0].tracking_mode,uomCode:part.rows[0].uom_code,
    positions:positions.map((position)=>{const balance=byId.get(position.id);const serial=serialByPosition.get(position.id);const quantity=part.rows[0].tracking_mode==="serialized"?num(serial?.quantity):num(balance?.quantity);const reserved=part.rows[0].tracking_mode==="serialized"?num(serial?.reserved):num(balance?.quantity_reserved);return {...position,quantity,reserved,available:reconciliationRequired?0:quantity-reserved,version:part.rows[0].tracking_mode==="serialized"?null:(balance?.version??null)};}),
    units:units.rows.map((row)=>({id:row.id,serialNumber:row.serial_number,positionId:row.current_position_id,status:row.status,conditionCode:row.condition_code,custodyLegacyAvailable:row.custody_legacy_available,custodyVersion:row.custody_version})),
    unassignedQuantity:part.rows[0].tracking_mode==="serialized"
      ? num(serialByPosition.get(positions.find((position)=>position.usage==="unassigned")?.id)?.quantity)
      : num(balances.rows.find((row)=>row.system_key==="unassigned")?.quantity),
    reconciliationRequired,reconciliationReasons:exceptions.rows.map((row)=>row.exception_code) };
}

export async function moveInventoryStock(input,dependencies={}) {
  const client=await getPool().connect(); const requestHash=digest({partId:input.partId,locationId:input.locationId,...input.move});
  try{
    await client.query("begin");await client.query("select pg_advisory_xact_lock(hashtext($1))",[`inventory-move:${input.actorId}:${input.move.idempotencyKey}`]);
    const part=await client.query(`select part.company_id,part.tracking_mode,part.uom_code,uom.decimal_scale from parts_catalog part join locations location
      on location.company_id=part.company_id and location.id=$2 join units_of_measure uom on uom.code=part.uom_code
      where part.id=$1 and part.company_id=any($3::uuid[]) and ($5::boolean or location.id=any($4::uuid[])) limit 1`,[input.partId,input.locationId,input.companyIds,input.locationIds,input.isAdmin]);
    const stock=part.rows[0];if(!stock){await client.query("rollback");return{kind:"not_found"};}
    if("quantity" in input.move&&((stock.tracking_mode==="quantity"&&!Number.isInteger(input.move.quantity))
      ||(stock.tracking_mode==="measured_bulk"&&!validPrecision(input.move.quantity,Number(stock.decimal_scale))))){await client.query("rollback");return{kind:"unsupported_uom"};}
    const replay=await client.query(`select id,request_hash from inventory_position_operations where company_id=$1 and location_id=$2 and actor_id=$3 and idempotency_key=$4`,[stock.company_id,input.locationId,input.actorId,input.move.idempotencyKey]);
    if(replay.rows[0]){await client.query("commit");return replay.rows[0].request_hash===requestHash?{kind:"replay",operation:{id:replay.rows[0].id,type:"move"}}:{kind:"idempotency_conflict"};}
    stock.inventory_item_id=null;
    let lockedUnits=null,positions;
    if("unitIds" in input.move){
      lockedUnits=await client.query(`select unit.id,unit.custody_version from inventory_serialized_units unit join inventory_receipt_lines line on line.company_id=unit.company_id and line.id=unit.receipt_line_id
        where unit.company_id=$1 and unit.location_id=$2 and unit.id=any($3::uuid[]) and unit.current_position_id=$4 and line.catalog_part_id=$5
          and unit.status in ('in_stock','reserved') and unit.custody_holder_type='inventory_location'
          and (unit.condition_code in ('new','serviceable_used','refurbished') or (unit.condition_code='unknown' and unit.custody_legacy_available))
        order by unit.id for update of unit`,[stock.company_id,input.locationId,input.move.unitIds,input.move.fromPositionId,input.partId]);
      if(lockedUnits.rowCount!==input.move.unitIds.length){await client.query("rollback");return{kind:"unit_conflict"};}
      if(lockedUnits.rows.some((unit)=>input.move.unitVersions[unit.id]!==undefined&&input.move.unitVersions[unit.id]!==unit.custody_version)){
        await client.query("rollback");return{kind:"unit_conflict"};
      }
      const item=await client.query(`select id from inventory_items where company_id=$1 and location_id=$2 and catalog_part_id=$3 and uom_code=$4 and source_provider='local'
        order by updated_at desc,id limit 1 for update`,[stock.company_id,input.locationId,input.partId,stock.uom_code]);
      stock.inventory_item_id=item.rows[0]?.id||null;
      await dependencies.afterItemLock?.({trackingMode:stock.tracking_mode,inventoryItemId:stock.inventory_item_id});
      positions=await client.query(`select * from inventory_positions where company_id=$1 and location_id=$2 and id=any($3::uuid[]) order by id for update`,[stock.company_id,input.locationId,[input.move.fromPositionId,input.move.toPositionId]]);
    }else{
      const item=await client.query(`select id from inventory_items where company_id=$1 and location_id=$2 and catalog_part_id=$3 and uom_code=$4 and source_provider='local'
        order by updated_at desc,id limit 1 for update`,[stock.company_id,input.locationId,input.partId,stock.uom_code]);
      stock.inventory_item_id=item.rows[0]?.id||null;
      positions=await client.query(`select * from inventory_positions where company_id=$1 and location_id=$2 and id=any($3::uuid[]) order by id for update`,[stock.company_id,input.locationId,[input.move.fromPositionId,input.move.toPositionId]]);
    }
    if(positions.rowCount!==2){await client.query("rollback");return{kind:"position_not_found"};}
    if(positions.rows.some((p)=>!p.is_active||!p.can_store||!p.is_pickable)){await client.query("rollback");return{kind:"destination_not_eligible"};}
    if(stock.inventory_item_id&&await hasAggregatePositionReconciliationConflict(client,stock.company_id,stock.inventory_item_id)){await client.query("rollback");return{kind:"reconciliation_required"};}
    const operationId=randomUUID();
    await client.query(`insert into inventory_position_operations(id,company_id,location_id,actor_id,command_type,idempotency_key,request_hash,reason)
      values($1,$2,$3,$4,'move',$5,$6,$7)`,[operationId,stock.company_id,input.locationId,input.actorId,input.move.idempotencyKey,requestHash,input.move.reason]);
    let movementCount=0;
    if("unitIds" in input.move){
      if(stock.tracking_mode!=="serialized"){await client.query("rollback");return{kind:"tracking_mismatch"};}
      await client.query(`update inventory_serialized_units set current_position_id=$4,custody_bin_location='',custody_version=custody_version+1,updated_at=now()
        where company_id=$1 and location_id=$2 and id=any($3::uuid[])`,[stock.company_id,input.locationId,input.move.unitIds,input.move.toPositionId]);
      await client.query(`insert into inventory_position_movements(operation_id,company_id,location_id,catalog_part_id,uom_code,quantity,unit_id,from_position_id,to_position_id)
        select $1,$2,$3,$4,$5,1,input.id,$6,$7 from unnest($8::uuid[]) input(id)`,[operationId,stock.company_id,input.locationId,input.partId,stock.uom_code,input.move.fromPositionId,input.move.toPositionId,input.move.unitIds]);
      movementCount=input.move.unitIds.length;
    }else{
      if(stock.tracking_mode==="serialized"||!stock.inventory_item_id){await client.query("rollback");return{kind:"tracking_mismatch"};}
      const source=await client.query(`select * from inventory_position_balances where company_id=$1 and position_id=$2 and inventory_item_id=$3 for update`,[stock.company_id,input.move.fromPositionId,stock.inventory_item_id]);
      if(!source.rows[0]||source.rows[0].version!==input.move.expectedSourceVersion){await client.query("rollback");return{kind:"stale"};}
      if(num(source.rows[0].quantity)-num(source.rows[0].quantity_reserved)<input.move.quantity){await client.query("rollback");return{kind:"insufficient_available"};}
      const destination=await client.query(`select * from inventory_position_balances where company_id=$1 and position_id=$2 and inventory_item_id=$3 for update`,[stock.company_id,input.move.toPositionId,stock.inventory_item_id]);
      if(input.move.expectedDestinationVersion!==null&&(destination.rows[0]?.version??null)!==input.move.expectedDestinationVersion){await client.query("rollback");return{kind:"stale"};}
      await client.query(`update inventory_position_balances set quantity=quantity-$4,version=version+1,updated_at=now() where company_id=$1 and position_id=$2 and inventory_item_id=$3`,[stock.company_id,input.move.fromPositionId,stock.inventory_item_id,input.move.quantity]);
      await client.query(`insert into inventory_position_balances(company_id,location_id,position_id,inventory_item_id,catalog_part_id,uom_code,quantity)
        values($1,$2,$3,$4,$5,$6,$7) on conflict(company_id,position_id,inventory_item_id) do update set quantity=inventory_position_balances.quantity+excluded.quantity,version=inventory_position_balances.version+1,updated_at=now()`,
      [stock.company_id,input.locationId,input.move.toPositionId,stock.inventory_item_id,input.partId,stock.uom_code,input.move.quantity]);
      await client.query(`insert into inventory_position_movements(operation_id,company_id,location_id,catalog_part_id,uom_code,quantity,from_position_id,to_position_id)
        values($1,$2,$3,$4,$5,$6,$7,$8)`,[operationId,stock.company_id,input.locationId,input.partId,stock.uom_code,input.move.quantity,input.move.fromPositionId,input.move.toPositionId]);movementCount=1;
    }
    await client.query("commit");return{kind:"moved",operation:{id:operationId,type:"move",movementCount}};
  }catch(error){await client.query("rollback").catch(()=>{});throw error;}finally{client.release();}
}

async function loadCount(client,input){
  const session=await client.query(`select session.*,position.name position_name,creator.display_name created_by_name,submitter.display_name submitted_by_name,applier.display_name applied_by_name from inventory_position_count_sessions session join inventory_positions position
    on position.company_id=session.company_id and position.id=session.position_id
    left join user_profiles creator on creator.id=session.created_by left join user_profiles submitter on submitter.id=session.submitted_by left join user_profiles applier on applier.id=session.applied_by
    where session.id=$1 and session.company_id=any($2::uuid[]) and ($4::boolean or session.location_id=any($3::uuid[]))`,[input.countId,input.companyIds,input.locationIds,input.isAdmin]);
  if(!session.rows[0])return null;const lines=await client.query(`select line.*,part.part_number,part.description,part.tracking_mode,uom.decimal_scale,observer.display_name observed_by_name from inventory_position_count_lines line
    join parts_catalog part on part.company_id=line.company_id and part.id=line.catalog_part_id
    join units_of_measure uom on uom.code=line.uom_code left join user_profiles observer on observer.id=line.observed_by
    where line.company_id=$1 and line.session_id=$2 order by part.part_number,line.id`,[session.rows[0].company_id,input.countId]);
  const serials=await client.query(`select snapshot.*,part.part_number,part.description,observer.display_name observed_by_name
    from inventory_position_count_unit_snapshots snapshot join parts_catalog part on part.company_id=snapshot.company_id and part.id=snapshot.catalog_part_id
    left join user_profiles observer on observer.id=snapshot.observed_by
    where snapshot.company_id=$1 and snapshot.session_id=$2 order by part.part_number,snapshot.serial_number_snapshot,snapshot.unit_id`,[session.rows[0].company_id,input.countId]);
  const groups=new Map();for(const unit of serials.rows){let group=groups.get(unit.catalog_part_id);if(!group){group={partId:unit.catalog_part_id,partNumber:unit.part_number,description:unit.description,uomCode:unit.uom_code,expectedCount:0,observedCount:0,difference:0,status:"open",units:[]};groups.set(unit.catalog_part_id,group);}group.expectedCount+=1;if(unit.observed_at)group.observedCount+=1;group.units.push({unitId:unit.unit_id,serialNumber:unit.serial_number_snapshot,observed:Boolean(unit.observed_at),observedBy:unit.observed_by?{id:unit.observed_by,name:unit.observed_by_name||""}:null,observedAt:unit.observed_at,inputMode:unit.input_mode});}
  for(const group of groups.values()){group.difference=group.observedCount-group.expectedCount;group.status=group.observedCount===group.expectedCount?"observed":"open";}
  const row=session.rows[0];
  return {id:session.rows[0].id,locationId:session.rows[0].location_id,positionId:session.rows[0].position_id,positionName:session.rows[0].position_name,
    status:session.rows[0].status,version:session.rows[0].version,startWatermark:Number(session.rows[0].start_watermark),
    createdBy:{id:row.created_by,name:row.created_by_name||""},createdAt:row.created_at,updatedAt:row.updated_at,
    submittedBy:row.submitted_by?{id:row.submitted_by,name:row.submitted_by_name||""}:null,submittedAt:row.submitted_at,
    appliedBy:row.applied_by?{id:row.applied_by,name:row.applied_by_name||""}:null,appliedAt:row.applied_at,applyReason:row.apply_reason,
    warnings:[],serialGroups:[...groups.values()],
    lines:lines.rows.map((line)=>({id:line.id,partId:line.catalog_part_id,partNumber:line.part_number,description:line.description,uomCode:line.uom_code,trackingMode:line.tracking_mode,decimalScale:Number(line.decimal_scale),lineSource:line.line_source||"snapshot",expectedQuantity:num(line.expected_quantity),observedQuantity:line.observed_quantity===null?null:num(line.observed_quantity),difference:line.observed_quantity===null?null:num(line.observed_quantity)-num(line.expected_quantity),status:line.status,version:line.version,observedBy:line.observed_by?{id:line.observed_by,name:line.observed_by_name||""}:null,observedAt:line.observed_at}))};
}
export async function getPositionCount(input){const client=await getPool().connect();try{return await loadCount(client,input);}finally{client.release();}}

export async function createPositionCount(input){const client=await getPool().connect();const requestHash=digest({locationId:input.locationId,positionId:input.positionId});try{
  await client.query("begin");await client.query("select pg_advisory_xact_lock(hashtext($1))",[`position-count:${input.actorId}:${input.idempotencyKey}`]);
  const prior=await client.query(`select id,request_hash from inventory_position_count_sessions where company_id=any($1::uuid[]) and created_by=$2 and idempotency_key=$3`,[input.companyIds,input.actorId,input.idempotencyKey]);
  if(prior.rows[0]){const value=await loadCount(client,{...input,countId:prior.rows[0].id});await client.query("commit");return prior.rows[0].request_hash===requestHash?{kind:"replay",count:value}:{kind:"idempotency_conflict"};}
  const position=await client.query(`select * from inventory_positions where id=$1 and location_id=$2 and company_id=any($3::uuid[]) and ($5::boolean or location_id=any($4::uuid[])) and is_active and can_store for share`,[input.positionId,input.locationId,input.companyIds,input.locationIds,input.isAdmin]);
  if(!position.rows[0]){await client.query("rollback");return{kind:"not_found"};}
  await client.query("select pg_advisory_xact_lock(hashtext($1))",[`position-count-position:${input.positionId}`]);
  const active=await client.query(`select id from inventory_position_count_sessions where company_id=$1 and position_id=$2 and status in ('open','ready') order by created_at desc,id desc limit 1 for update`,[position.rows[0].company_id,input.positionId]);
  if(active.rows[0]){const value=await loadCount(client,{...input,countId:active.rows[0].id});await client.query("commit");return{kind:"existing",count:value};}
  const blocked=await client.query(`select 1 from inventory_position_balances balance where balance.company_id=$1 and balance.position_id=$2 and (
      exists(select 1 from inventory_position_reconciliation_exceptions exception where exception.company_id=balance.company_id and exception.inventory_item_id=balance.inventory_item_id and exception.status='open')
      or exists(select 1 from part_allocations allocation where allocation.inventory_item_id=balance.inventory_item_id and allocation.status in ('reserved','issued'))
    ) limit 1`,[position.rows[0].company_id,input.positionId]);
  if(blocked.rows[0]){await client.query("rollback");return{kind:"reconciliation_required"};}
  const stale=await client.query(`select id from inventory_position_count_sessions where company_id=$1 and position_id=$2 and status='needs_recount' order by created_at,id for update`,[position.rows[0].company_id,input.positionId]);
  const watermark=await client.query(`select coalesce(max(event_ordinal),0) value from inventory_position_movements where company_id=$1 and location_id=$2`,[position.rows[0].company_id,input.locationId]);const countId=randomUUID();
  await client.query(`insert into inventory_position_count_sessions(id,company_id,location_id,position_id,start_watermark,created_by,idempotency_key,request_hash)
    values($1,$2,$3,$4,$5,$6,$7,$8)`,[countId,position.rows[0].company_id,input.locationId,input.positionId,watermark.rows[0].value,input.actorId,input.idempotencyKey,requestHash]);
  await client.query(`insert into inventory_position_count_lines(company_id,session_id,inventory_item_id,catalog_part_id,uom_code,expected_quantity,balance_version)
    select balance.company_id,$1,balance.inventory_item_id,balance.catalog_part_id,balance.uom_code,balance.quantity,balance.version
    from inventory_position_balances balance join parts_catalog part on part.company_id=balance.company_id and part.id=balance.catalog_part_id
    where balance.company_id=$2 and balance.position_id=$3 and part.tracking_mode<>'serialized'`,[countId,position.rows[0].company_id,input.positionId]);
  await client.query(`insert into inventory_position_count_unit_snapshots(company_id,session_id,unit_id,catalog_part_id,uom_code,serial_number_snapshot,status_snapshot,custody_version_snapshot,unit_updated_at_snapshot)
    select unit.company_id,$1,unit.id,line.catalog_part_id,line.uom_code,unit.serial_number,unit.status,unit.custody_version,unit.updated_at
    from inventory_serialized_units unit join inventory_receipt_lines line on line.company_id=unit.company_id and line.id=unit.receipt_line_id
    where unit.company_id=$2 and unit.location_id=$3 and unit.current_position_id=$4 and unit.custody_holder_type='inventory_location'`,[countId,position.rows[0].company_id,input.locationId,input.positionId]);
  if(stale.rows.length)await client.query(`update inventory_position_count_sessions set status='superseded',superseded_by_session_id=$3,version=version+1,updated_at=now()
    where company_id=$1 and id=any($2::uuid[])`,[position.rows[0].company_id,stale.rows.map((row)=>row.id),countId]);
  const value=await loadCount(client,{...input,countId});await client.query("commit");return{kind:"created",count:value};
}catch(error){await client.query("rollback").catch(()=>{});throw error;}finally{client.release();}}

export async function savePositionCountObservation(input){const client=await getPool().connect();const requestHash=digest({countId:input.countId,lineId:input.lineId,observedQuantity:input.observedQuantity});try{
  await client.query("begin");const prior=await client.query(`select request_hash from inventory_position_count_commands where company_id=any($1::uuid[]) and actor_id=$2 and idempotency_key=$3`,[input.companyIds,input.actorId,input.idempotencyKey]);
  if(prior.rows[0]){await client.query("commit");return prior.rows[0].request_hash===requestHash?{kind:"replay"}:{kind:"idempotency_conflict"};}
  const policy=await client.query(`select part.tracking_mode,uom.decimal_scale from inventory_position_count_lines line
    join inventory_position_count_sessions session on session.company_id=line.company_id and session.id=line.session_id
    join parts_catalog part on part.company_id=line.company_id and part.id=line.catalog_part_id join units_of_measure uom on uom.code=line.uom_code
    where line.id=$1 and session.id=$2 and session.company_id=any($3::uuid[]) and ($5::boolean or session.location_id=any($4::uuid[])) for update of line,session`,
  [input.lineId,input.countId,input.companyIds,input.locationIds,input.isAdmin]);
  if(!policy.rows[0]){await client.query("rollback");return{kind:"not_found"};}
  if(policy.rows[0].tracking_mode==="serialized"){await client.query("rollback");return{kind:"serialized_review_required"};}
  if((policy.rows[0].tracking_mode==="quantity"&&!Number.isInteger(input.observedQuantity))
    ||!validPrecision(input.observedQuantity,Number(policy.rows[0].decimal_scale))){await client.query("rollback");return{kind:"unsupported_uom"};}
  const updated=await client.query(`update inventory_position_count_lines line set observed_quantity=$5,status='observed',observed_at=now(),observed_by=$8,
      observation_watermark=(select coalesce(max(event_ordinal),0) from inventory_position_movements movement where movement.company_id=line.company_id and movement.location_id=session.location_id),
      version=line.version+1,updated_at=now()
    from inventory_position_count_sessions session,inventory_position_balances balance where line.company_id=session.company_id and line.session_id=session.id and line.id=$1 and session.id=$2
      and balance.company_id=line.company_id and balance.position_id=session.position_id and balance.inventory_item_id=line.inventory_item_id
      and session.company_id=any($3::uuid[]) and ($7::boolean or session.location_id=any($6::uuid[])) and session.status='open' and line.version=$4 returning line.company_id`,
    [input.lineId,input.countId,input.companyIds,input.expectedVersion,input.observedQuantity,input.locationIds,input.isAdmin,input.actorId]);
  if(!updated.rows[0]){await client.query("rollback");return{kind:"stale"};}
  await client.query(`insert into inventory_position_count_commands(company_id,actor_id,session_id,line_id,action,idempotency_key,request_hash) values($1,$2,$3,$4,'observe',$5,$6)`,[updated.rows[0].company_id,input.actorId,input.countId,input.lineId,input.idempotencyKey,requestHash]);
  await client.query("commit");return{kind:"observed"};
}catch(error){await client.query("rollback").catch(()=>{});throw error;}finally{client.release();}}

export async function addPositionCountFoundPart(input){const client=await getPool().connect();const requestHash=digest({countId:input.countId,catalogPartId:input.catalogPartId,expectedPartVersion:input.expectedPartVersion,observedQuantity:input.observedQuantity});try{
  await client.query("begin");await client.query("select pg_advisory_xact_lock(hashtext($1))",[`position-count-found:${input.actorId}:${input.idempotencyKey}`]);
  const prior=await client.query(`select request_hash from inventory_position_count_commands where company_id=any($1::uuid[]) and actor_id=$2 and idempotency_key=$3`,[input.companyIds,input.actorId,input.idempotencyKey]);
  if(prior.rows[0]){await client.query("commit");return prior.rows[0].request_hash===requestHash?{kind:"replay"}:{kind:"idempotency_conflict"};}
  const selected=await client.query(`select session.*,position.code position_code,position.name position_name from inventory_position_count_sessions session join inventory_positions position on position.company_id=session.company_id and position.id=session.position_id where session.id=$1 and session.company_id=any($2::uuid[]) and ($4::boolean or session.location_id=any($3::uuid[])) for update of session`,[input.countId,input.companyIds,input.locationIds,input.isAdmin]);
  const session=selected.rows[0];if(!session){await client.query("rollback");return{kind:"not_found"};}if(session.status!=="open"||session.version!==input.expectedVersion){await client.query("rollback");return{kind:"stale"};}
  const partResult=await client.query(`select part.*,uom.decimal_scale from parts_catalog part join units_of_measure uom on uom.code=part.uom_code where part.company_id=$1 and part.id=$2 for share of part,uom`,[session.company_id,input.catalogPartId]);
  const part=partResult.rows[0];if(!part||Number(part.version)!==input.expectedPartVersion){await client.query("rollback");return{kind:"catalog_changed"};}
  if(part.tracking_mode==="serialized"){await client.query("rollback");return{kind:"serialized_review_required"};}
  if((part.tracking_mode==="quantity"&&!Number.isInteger(input.observedQuantity))||!validPrecision(input.observedQuantity,Number(part.decimal_scale))){await client.query("rollback");return{kind:"unsupported_uom"};}
  const existingLine=await client.query(`select id from inventory_position_count_lines where company_id=$1 and session_id=$2 and catalog_part_id=$3 limit 1`,[session.company_id,session.id,part.id]);
  if(existingLine.rows[0]){await client.query("rollback");return{kind:"found_part_exists"};}
  const changed=await client.query(`select 1 from inventory_position_movements where company_id=$1 and location_id=$2 and catalog_part_id=$3 and event_ordinal>$4 and (from_position_id=$5 or to_position_id=$5) limit 1`,[session.company_id,session.location_id,part.id,session.start_watermark,session.position_id]);
  if(changed.rows[0]){await client.query("rollback");return{kind:"stale"};}
  let item=(await client.query(`select * from inventory_items where company_id=$1 and location_id=$2 and catalog_part_id=$3 and uom_code=$4 order by (source_provider='local') desc,updated_at desc,id limit 1 for update`,[session.company_id,session.location_id,part.id,part.uom_code])).rows[0];
  if(!item){
    item=(await client.query(`insert into inventory_items(company_id,location_id,catalog_part_id,normalized_part_number,part_number,description,quantity_on_hand,quantity_reserved,uom_code,source_provider,external_id,last_seen_at,updated_at)
      values($1,$2,$3,$4,$5,$6,0,0,$7,'local',$8,now(),now()) on conflict do nothing returning *`,[session.company_id,session.location_id,part.id,part.normalized_part_number,part.part_number,part.description,part.uom_code,`position-count:${session.id}:${part.id}`])).rows[0];
    if(!item)item=(await client.query(`select * from inventory_items where company_id=$1 and location_id=$2 and catalog_part_id=$3 and uom_code=$4 order by updated_at desc,id limit 1 for update`,[session.company_id,session.location_id,part.id,part.uom_code])).rows[0];
  }
  if(!item){await client.query("rollback");return{kind:"reconciliation_required"};}
  const balance=(await client.query(`select * from inventory_position_balances where company_id=$1 and position_id=$2 and inventory_item_id=$3 for update`,[session.company_id,session.position_id,item.id])).rows[0];
  if(balance&&num(balance.quantity)!==0){await client.query("rollback");return{kind:"stale"};}
  const watermark=(await client.query(`select coalesce(max(event_ordinal),0) value from inventory_position_movements where company_id=$1 and location_id=$2`,[session.company_id,session.location_id])).rows[0].value;
  const lineId=randomUUID();await client.query(`insert into inventory_position_count_lines(id,company_id,session_id,inventory_item_id,catalog_part_id,uom_code,expected_quantity,observed_quantity,balance_version,observation_watermark,status,observed_at,observed_by,line_source)
    values($1,$2,$3,$4,$5,$6,0,$7,$8,$9,'observed',now(),$10,'found')`,[lineId,session.company_id,session.id,item.id,part.id,part.uom_code,input.observedQuantity,balance?.version||0,watermark,input.actorId]);
  await client.query(`update inventory_position_count_sessions set version=version+1,updated_at=now() where company_id=$1 and id=$2`,[session.company_id,session.id]);
  await client.query(`insert into inventory_position_count_commands(company_id,actor_id,session_id,line_id,action,idempotency_key,request_hash) values($1,$2,$3,$4,'add_found',$5,$6)`,[session.company_id,input.actorId,session.id,lineId,input.idempotencyKey,requestHash]);
  await client.query("commit");return{kind:"observed"};
}catch(error){await client.query("rollback").catch(()=>{});throw error;}finally{client.release();}}

export async function savePositionCountIdentity(input){const client=await getPool().connect();const normalized=String(input.serialNumber).trim();const requestHash=digest({countId:input.countId,serialNumber:normalized,inputMode:input.inputMode});try{
  await client.query("begin");await client.query("select pg_advisory_xact_lock(hashtext($1))",[`position-count-identity:${input.actorId}:${input.idempotencyKey}`]);
  const prior=await client.query(`select request_hash from inventory_position_count_commands where company_id=any($1::uuid[]) and actor_id=$2 and idempotency_key=$3`,[input.companyIds,input.actorId,input.idempotencyKey]);
  if(prior.rows[0]){await client.query("commit");return prior.rows[0].request_hash===requestHash?{kind:"replay",alreadyObserved:true}:{kind:"idempotency_conflict"};}
  const selected=await client.query(`select * from inventory_position_count_sessions where id=$1 and company_id=any($2::uuid[]) and ($4::boolean or location_id=any($3::uuid[])) for update`,[input.countId,input.companyIds,input.locationIds,input.isAdmin]);
  const session=selected.rows[0];if(!session){await client.query("rollback");return{kind:"not_found"};}if(session.status!=="open"||session.version!==input.expectedVersion){await client.query("rollback");return{kind:"stale"};}
  const identity=await client.query(`select unit.id,unit.company_id,unit.location_id,unit.current_position_id from inventory_serialized_units unit where unit.company_id=$1 and btrim(unit.serial_number)=$2 limit 1 for share`,[session.company_id,normalized]);
  if(!identity.rows[0]){await client.query("rollback");return{kind:"serial_not_found"};}
  if(identity.rows[0].location_id!==session.location_id||identity.rows[0].current_position_id!==session.position_id){await client.query("rollback");return{kind:"serial_wrong_position"};}
  const snapshot=await client.query(`select * from inventory_position_count_unit_snapshots where company_id=$1 and session_id=$2 and unit_id=$3 for update`,[session.company_id,session.id,identity.rows[0].id]);
  if(!snapshot.rows[0]){
    await client.query(`update inventory_position_count_lines set status='needs_recount',version=version+1,updated_at=now()
      where company_id=$1 and session_id=$2`,[session.company_id,session.id]);
    await client.query(`update inventory_position_count_sessions set status='needs_recount',version=version+1,applied_at=null,updated_at=now()
      where company_id=$1 and id=$2`,[session.company_id,session.id]);
    await client.query(`insert into inventory_position_count_commands(company_id,actor_id,session_id,action,idempotency_key,request_hash) values($1,$2,$3,'observe_identity',$4,$5)`,[session.company_id,input.actorId,session.id,input.idempotencyKey,requestHash]);
    await client.query("commit");return{kind:"needs_recount"};
  }
  const alreadyObserved=Boolean(snapshot.rows[0].observed_at);
  if(!alreadyObserved)await client.query(`update inventory_position_count_unit_snapshots set observed_by=$4,observed_at=now(),input_mode=$5,updated_at=now() where company_id=$1 and session_id=$2 and unit_id=$3`,[session.company_id,session.id,identity.rows[0].id,input.actorId,input.inputMode]);
  await client.query(`update inventory_position_count_sessions set version=version+1,updated_at=now() where company_id=$1 and id=$2`,[session.company_id,session.id]);
  await client.query(`insert into inventory_position_count_commands(company_id,actor_id,session_id,action,idempotency_key,request_hash) values($1,$2,$3,'observe_identity',$4,$5)`,[session.company_id,input.actorId,session.id,input.idempotencyKey,requestHash]);
  await client.query("commit");return{kind:"observed",alreadyObserved};
}catch(error){await client.query("rollback").catch(()=>{});throw error;}finally{client.release();}}

export async function submitPositionCountObservations(input){const client=await getPool().connect();const requestHash=digest({countId:input.countId});try{
  await client.query("begin");await client.query("select pg_advisory_xact_lock(hashtext($1))",[`position-count-submit:${input.actorId}:${input.idempotencyKey}`]);
  const prior=await client.query(`select request_hash from inventory_position_count_commands where company_id=any($1::uuid[]) and actor_id=$2 and idempotency_key=$3`,[input.companyIds,input.actorId,input.idempotencyKey]);
  if(prior.rows[0]){await client.query("commit");return prior.rows[0].request_hash===requestHash?{kind:"replay"}:{kind:"idempotency_conflict"};}
  const selected=await client.query(`select session.*,position.code position_code,position.name position_name from inventory_position_count_sessions session join inventory_positions position on position.company_id=session.company_id and position.id=session.position_id where session.id=$1 and session.company_id=any($2::uuid[]) and ($4::boolean or session.location_id=any($3::uuid[])) for update of session`,[input.countId,input.companyIds,input.locationIds,input.isAdmin]);
  const session=selected.rows[0];if(!session){await client.query("rollback");return{kind:"not_found"};}if(session.version!==input.expectedVersion||session.status!=="open"){await client.query("rollback");return{kind:"stale"};}
  const lineResult=await client.query(`select * from inventory_position_count_lines where company_id=$1 and session_id=$2 and observed_quantity is not null order by inventory_item_id,id for update`,[session.company_id,session.id]);
  const lines=lineResult.rows;
  const itemIds=lines.map((line)=>line.inventory_item_id);
  const balances=itemIds.length?await client.query(`select * from inventory_position_balances where company_id=$1 and position_id=$2 and inventory_item_id=any($3::uuid[]) order by inventory_item_id for update`,[session.company_id,session.position_id,itemIds]):{rows:[]};
  const balanceByItem=new Map(balances.rows.map((row)=>[row.inventory_item_id,row]));
  let needsRecount=lines.some((line)=>{const balance=balanceByItem.get(line.inventory_item_id);return line.line_source==="found"&&Number(line.balance_version)===0&&!balance?false:!balance||balance.version!==line.balance_version;});
  for(const line of lines){
    const changed=await client.query(`select 1 from inventory_position_movements where company_id=$1 and location_id=$2 and catalog_part_id=$3 and event_ordinal>$4 and (from_position_id=$5 or to_position_id=$5) limit 1`,[session.company_id,session.location_id,line.catalog_part_id,line.observation_watermark??session.start_watermark,session.position_id]);
    if(changed.rows[0]){needsRecount=true;break;}
  }
  const allSerials=await client.query(`select snapshot.*,unit.current_position_id,unit.location_id unit_location_id,unit.status unit_status,unit.custody_version current_custody_version,unit.updated_at unit_updated_at from inventory_position_count_unit_snapshots snapshot join inventory_serialized_units unit on unit.company_id=snapshot.company_id and unit.id=snapshot.unit_id where snapshot.company_id=$1 and snapshot.session_id=$2 order by snapshot.unit_id for update of snapshot,unit`,[session.company_id,session.id]);
  const selectedSerialPartIds=[...new Set(allSerials.rows.filter((unit)=>unit.observed_at).map((unit)=>unit.catalog_part_id))];
  const serials=allSerials.rows.filter((unit)=>selectedSerialPartIds.includes(unit.catalog_part_id));
  if(!lines.length&&!selectedSerialPartIds.length){await client.query("rollback");return{kind:"incomplete"};}
  if(serials.some((unit)=>!unit.observed_at)){await client.query("rollback");return{kind:"incomplete"};}
  if(selectedSerialPartIds.length){
    const currentSerialCount=await client.query(`select count(*)::int count from inventory_serialized_units unit join inventory_receipt_lines line on line.company_id=unit.company_id and line.id=unit.receipt_line_id where unit.company_id=$1 and unit.location_id=$2 and unit.current_position_id=$3 and unit.custody_holder_type='inventory_location' and line.catalog_part_id=any($4::uuid[])`,[session.company_id,session.location_id,session.position_id,selectedSerialPartIds]);
    if(currentSerialCount.rows[0].count!==serials.length||serials.some((unit)=>unit.current_position_id!==session.position_id||unit.unit_location_id!==session.location_id||unit.current_custody_version!==unit.custody_version_snapshot||unit.unit_status!==unit.status_snapshot||new Date(unit.unit_updated_at).getTime()!==new Date(unit.unit_updated_at_snapshot).getTime()))needsRecount=true;
  }
  const hasDifference=lines.some((line)=>num(line.observed_quantity)!==num(line.expected_quantity));
  if(needsRecount){await client.query(`update inventory_position_count_lines set status='needs_recount',version=version+1,updated_at=now() where company_id=$1 and session_id=$2 and observed_quantity is not null`,[session.company_id,session.id]);await client.query(`update inventory_position_count_sessions set status='needs_recount',version=version+1,updated_at=now() where company_id=$1 and id=$2`,[session.company_id,session.id]);}
  else if(hasDifference)await client.query(`update inventory_position_count_sessions set status='ready',submitted_by=$3,submitted_at=now(),version=version+1,updated_at=now() where company_id=$1 and id=$2`,[session.company_id,session.id,input.actorId]);
  else {const reason=`Physical count verified · ${session.position_code||session.position_name||"storage location"} · ${String(session.id).slice(0,8)}`;await client.query(`update inventory_position_count_lines set status='applied',version=version+1,updated_at=now() where company_id=$1 and session_id=$2 and observed_quantity is not null`,[session.company_id,session.id]);await client.query(`update inventory_position_count_sessions set status='applied',submitted_by=$3,submitted_at=now(),applied_by=$3,applied_at=now(),apply_reason=$4,version=version+1,updated_at=now() where company_id=$1 and id=$2`,[session.company_id,session.id,input.actorId,reason]);}
  await client.query(`insert into inventory_position_count_commands(company_id,actor_id,session_id,action,idempotency_key,request_hash) values($1,$2,$3,'submit',$4,$5)`,[session.company_id,input.actorId,session.id,input.idempotencyKey,requestHash]);
  await client.query("commit");return{kind:needsRecount?"needs_recount":hasDifference?"ready":"verified"};
}catch(error){await client.query("rollback").catch(()=>{});throw error;}finally{client.release();}}

export async function applyPositionCountCorrection(input,dependencies={}){const client=await getPool().connect();const requestHash=digest({countId:input.countId});try{
  await client.query("begin");await client.query("select pg_advisory_xact_lock(hashtext($1))",[`position-count-apply:${input.actorId}:${input.idempotencyKey}`]);
  const prior=await client.query(`select request_hash from inventory_position_count_commands where company_id=any($1::uuid[]) and actor_id=$2 and idempotency_key=$3`,[input.companyIds,input.actorId,input.idempotencyKey]);
  if(prior.rows[0]){await client.query("commit");return prior.rows[0].request_hash===requestHash?{kind:"replay"}:{kind:"idempotency_conflict"};}
  const selected=await client.query(`select session.*,position.code position_code,position.name position_name from inventory_position_count_sessions session join inventory_positions position on position.company_id=session.company_id and position.id=session.position_id where session.id=$1 and session.company_id=any($2::uuid[]) and ($4::boolean or session.location_id=any($3::uuid[])) for update of session nowait`,[input.countId,input.companyIds,input.locationIds,input.isAdmin]);
  const session=selected.rows[0];if(!session){await client.query("rollback");return{kind:"not_found"};}if(session.version!==input.expectedVersion||session.status!=="ready"){await client.query("rollback");return{kind:"stale"};}const reason=`Physical count correction · ${session.position_code||session.position_name||"storage location"} · ${String(session.id).slice(0,8)}`;
  const lineResult=await client.query(`select line.* from inventory_position_count_lines line
    where line.company_id=$1 and line.session_id=$2 and line.observed_quantity is not null order by line.inventory_item_id,line.id for update of line nowait`,[session.company_id,session.id]);
  const lines=lineResult.rows;
  const serialSnapshot=await client.query(`select snapshot.*,unit.current_position_id,unit.location_id unit_location_id,unit.status unit_status,
      unit.custody_version current_custody_version,unit.updated_at unit_updated_at
    from inventory_position_count_unit_snapshots snapshot join inventory_serialized_units unit on unit.company_id=snapshot.company_id and unit.id=snapshot.unit_id
    where snapshot.company_id=$1 and snapshot.session_id=$2 order by snapshot.unit_id for update of snapshot,unit nowait`,[session.company_id,session.id]);
  const selectedSerialPartIds=[...new Set(serialSnapshot.rows.filter((unit)=>unit.observed_at).map((unit)=>unit.catalog_part_id))];
  const selectedSerials=serialSnapshot.rows.filter((unit)=>selectedSerialPartIds.includes(unit.catalog_part_id));
  const serialIncomplete=selectedSerials.some((unit)=>!unit.observed_at);
  let serialNeedsRecount=false;
  if(selectedSerialPartIds.length){const currentSerialCount=await client.query(`select count(*)::int count from inventory_serialized_units unit join inventory_receipt_lines line on line.company_id=unit.company_id and line.id=unit.receipt_line_id where unit.company_id=$1 and unit.location_id=$2 and unit.current_position_id=$3 and unit.custody_holder_type='inventory_location' and line.catalog_part_id=any($4::uuid[])`,[session.company_id,session.location_id,session.position_id,selectedSerialPartIds]);serialNeedsRecount=currentSerialCount.rows[0].count!==selectedSerials.length||selectedSerials.some((unit)=>unit.current_position_id!==session.position_id||unit.unit_location_id!==session.location_id||unit.current_custody_version!==unit.custody_version_snapshot||unit.unit_status!==unit.status_snapshot||new Date(unit.unit_updated_at).getTime()!==new Date(unit.unit_updated_at_snapshot).getTime());}
  const itemIds=lines.map((line)=>line.inventory_item_id);
  // Multi-line receipt transactions can already hold a different item/position.
  // Acquire the complete count lock set without waiting; rollback releases any
  // partial locks so receiving can finish and this unchanged command can retry.
  if(itemIds.length)await client.query(`select id from inventory_items where company_id=$1 and id=any($2::uuid[]) order by id for update nowait`,[session.company_id,itemIds]);
  await dependencies.afterItemLocks?.({countId:session.id,positionId:session.position_id});
  const position=await client.query(`select is_active from inventory_positions where company_id=$1 and id=$2 for share nowait`,[session.company_id,session.position_id]);
  if(!position.rows[0]?.is_active){await client.query("rollback");return{kind:"stale"};}
  const balances=await client.query(`select * from inventory_position_balances where company_id=$1 and position_id=$2
    and inventory_item_id=any($3::uuid[]) order by inventory_item_id for update`,[session.company_id,session.position_id,itemIds]);
  const balanceByItem=new Map(balances.rows.map((row)=>[row.inventory_item_id,row]));
  let needsRecount=serialNeedsRecount;
  for(const line of lines){
    const balance=balanceByItem.get(line.inventory_item_id);
    const missingFoundBalance=!balance&&line.line_source==="found"&&num(line.expected_quantity)===0&&Number(line.balance_version)===0;
    if((!balance&&!missingFoundBalance)||(balance&&balance.version!==line.balance_version)){needsRecount=true;break;}
    const changed=await client.query(`select 1 from inventory_position_movements where company_id=$1 and location_id=$2 and catalog_part_id=$3
      and event_ordinal>$4 and (from_position_id=$5 or to_position_id=$5) limit 1`,[session.company_id,session.location_id,line.catalog_part_id,line.observed_quantity===null?session.start_watermark:line.observation_watermark,session.position_id]);
    if(changed.rows[0]){needsRecount=true;break;}
  }
  if(needsRecount){
    await client.query(`update inventory_position_count_lines set status='needs_recount',version=version+1,updated_at=now()
      where company_id=$1 and session_id=$2`,[session.company_id,session.id]);
    await client.query(`update inventory_position_count_sessions set status='needs_recount',version=version+1,applied_at=null,updated_at=now()
      where company_id=$1 and id=$2`,[session.company_id,session.id]);
    await client.query(`insert into inventory_position_count_commands(company_id,actor_id,session_id,action,idempotency_key,request_hash) values($1,$2,$3,'apply',$4,$5)`,[session.company_id,input.actorId,session.id,input.idempotencyKey,requestHash]);
    await client.query("commit");return{kind:"needs_recount"};
  }
  if(serialIncomplete){await client.query("rollback");return{kind:"serialized_review_required"};}
  const blocked=itemIds.length?await client.query(`select 1 from inventory_items item where item.company_id=$1 and item.id=any($2::uuid[]) and (
      exists(select 1 from inventory_position_reconciliation_exceptions exception where exception.company_id=item.company_id and exception.inventory_item_id=item.id and exception.status='open')
      or exists(select 1 from part_allocations allocation where allocation.inventory_item_id=item.id and allocation.status in ('reserved','issued'))
    ) limit 1`,[session.company_id,itemIds]):{rows:[]};
  if(blocked.rows[0]){await client.query("rollback");return{kind:"reconciliation_required"};}
  await dependencies.afterPreflight?.({countId:session.id,positionId:session.position_id});
  const operationId=randomUUID();
  await client.query(`insert into inventory_position_operations(id,company_id,location_id,actor_id,command_type,idempotency_key,request_hash,reason,count_session_id)
    values($1,$2,$3,$4,'count_adjustment',$5,$6,$7,$8)`,[operationId,session.company_id,session.location_id,input.actorId,input.idempotencyKey,requestHash,reason,session.id]);
  for(const line of lines){const balance=balanceByItem.get(line.inventory_item_id);
    const observed=num(line.observed_quantity),reserved=num(balance?.quantity_reserved),expected=num(line.expected_quantity),delta=observed-expected;
    if(observed<reserved){await client.query("rollback");return{kind:"reserved_conflict"};}
    if(balance)await client.query(`update inventory_position_balances set quantity=$4,version=version+1,updated_at=now() where company_id=$1 and position_id=$2 and inventory_item_id=$3`,[session.company_id,session.position_id,line.inventory_item_id,observed]);
    else await client.query(`insert into inventory_position_balances(company_id,location_id,position_id,inventory_item_id,catalog_part_id,uom_code,quantity,quantity_reserved) values($1,$2,$3,$4,$5,$6,$7,0)`,[session.company_id,session.location_id,session.position_id,line.inventory_item_id,line.catalog_part_id,line.uom_code,observed]);
    if(delta!==0){const item=await client.query(`update inventory_items set quantity_on_hand=quantity_on_hand+$3,updated_at=now() where company_id=$1 and id=$2 and quantity_on_hand+$3>=0 returning id`,[session.company_id,line.inventory_item_id,delta]);if(!item.rows[0]){await client.query("rollback");return{kind:"stock_conflict"};}
      await client.query(`insert into inventory_stock_movements(company_id,location_id,catalog_part_id,movement_type,quantity_delta,uom_code,actor_id,reason,idempotency_key)
        values($1,$2,$3,'adjustment',$4,$5,$6,$7,$8)`,[session.company_id,session.location_id,line.catalog_part_id,delta,line.uom_code,input.actorId,reason,`position-count:${session.id}:line:${line.id}`]);
      await client.query(`insert into inventory_position_movements(operation_id,company_id,location_id,catalog_part_id,uom_code,quantity,from_position_id,to_position_id)
        values($1,$2,$3,$4,$5,$6,$7,$8)`,[operationId,session.company_id,session.location_id,line.catalog_part_id,line.uom_code,Math.abs(delta),delta<0?session.position_id:null,delta>0?session.position_id:null]);}
    await client.query(`update inventory_position_count_lines set status='applied',version=version+1,updated_at=now() where id=$1`,[line.id]);}
  await client.query(`update inventory_position_count_sessions set status='applied',version=version+1,applied_by=$3,apply_reason=$4,applied_at=now(),updated_at=now() where company_id=$1 and id=$2`,[session.company_id,session.id,input.actorId,reason]);
  await client.query(`insert into inventory_position_count_commands(company_id,actor_id,session_id,action,idempotency_key,request_hash) values($1,$2,$3,'apply',$4,$5)`,[session.company_id,input.actorId,session.id,input.idempotencyKey,requestHash]);
  await client.query("commit");return{kind:"applied"};
}catch(error){await client.query("rollback").catch(()=>{});if(error.code==="55P03")return{kind:"stock_busy"};throw error;}finally{client.release();}}

export const inventoryPositionInternals={digest,positionRow};
