import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after,test } from 'node:test';
import { closePool,query } from '../../db/pool.js';
import { createOperationalWorkorder } from '../../db/repositories/operational-workorders.repo.js';
import { listWorkorderPartRequests } from '../../db/repositories/part-requests.repo.js';
import { getPurchasing,receivePurchaseOrder,savePurchase } from './inventory-purchasing.service.js';

const enabled=process.env.RUN_POSTGRES_INTEGRATION==='1';
after(async()=>{if(enabled)await closePool();});

test('Create Workorder demand becomes one canonical Needs ordering row and a linked PO suppresses duplicates',{skip:!enabled},async()=>{
  const suffix=randomUUID().replaceAll('-','');
  const companyId=randomUUID(),locationId=randomUUID(),actorId=randomUUID(),partId=randomUUID(),supplierId=randomUUID();
  const context={actor:{id:actorId,role:'office'},companyIds:new Set([companyId]),locationIds:new Set([locationId])};
  let workorderId;
  try {
    await query("insert into user_profiles(id,display_name) values($1,'Purchasing demand office')",[actorId]);
    await query("insert into companies(id,slug,name) values($1,$2,'Purchasing demand')",[companyId,`purchasing-demand-${suffix}`]);
    await query("insert into locations(id,company_id,name) values($1,$2,'Demand shop')",[locationId,companyId]);
    await query(`insert into parts_catalog(id,company_id,normalized_part_number,part_number,description,uom_code,tracking_mode)
      values($1,$2,$3,$4,'Demand filter','ea','quantity')`,[partId,companyId,`FILTER${suffix}`,`FILTER-${suffix}`]);
    await query("insert into inventory_suppliers(id,company_id,name) values($1,$2,'Demand supplier')",[supplierId,companyId]);
    const created=await createOperationalWorkorder({
      companyId,locationId,createdByUserId:actorId,createdByRole:'office',concern:'Replace missing filter',mechanicUserIds:[],
      formData:{parts:[{partNo:`FILTER-${suffix}`,qty:'3',uomCode:'ea',repairOrder:'Replace filter',purchaseRequested:true}]},
    });
    workorderId=created.id;
    const requests=await query('select * from workorder_part_requests where workorder_id=$1',[workorderId]);
    assert.equal(requests.rows.length,1);
    assert.equal(requests.rows[0].approval_status,'submitted');
    assert.equal(created.formData.parts.length,0);
    const requestId=requests.rows[0].id;
    await query(`update workorder_part_requests set catalog_part_id=$2,part_number=$3,normalized_part_number=$4,description='Demand filter',approval_status='approved',approved_by_user_id=$5,approved_at=now() where id=$1`,[requestId,partId,`FILTER-${suffix}`,`FILTER${suffix}`,actorId]);
    const item=(await query(`insert into inventory_items(company_id,location_id,catalog_part_id,normalized_part_number,part_number,description,quantity_on_hand,quantity_reserved,uom_code,source_provider,external_id)
      values($1,$2,$3,$4,$5,'Demand filter',1,1,'ea','local',$6) returning id`,[companyId,locationId,partId,`FILTER${suffix}`,`FILTER-${suffix}`,`demand:${suffix}`])).rows[0];
    await query(`insert into part_allocations(part_request_id,source_type,status,quantity,uom_code,location_id,inventory_item_id,created_by_user_id)
      values($1,'inventory','reserved',1,'ea',$2,$3,$4)`,[requestId,locationId,item.id,actorId]);
    const search=new URLSearchParams({locationId,page:'1',view:'purchases',status:'all',supplierId:'',query:''});
    const first=await getPurchasing(search,context);
    assert.equal(first.demand.length,1);
    assert.equal(first.demand[0].catalog_part_id,partId);
    assert.equal(Number(first.demand[0].workorder_quantity),2);
    assert.equal(Number(first.demand[0].buy_quantity),2);
    assert.deepEqual(first.demand[0].workorders.map(row=>row.requestId),[requestId]);
    const createdOrder=await savePurchase({action:'create',locationId,idempotencyKey:randomUUID(),supplierId,currency:'USD',notes:'',expectedDeliveryDate:null,placeOrder:false,
      lines:[{catalogPartId:partId,quantity:2,unitPrice:null,demandSources:[{sourceType:'workorder_request',sourceId:requestId,plannedQuantity:2}]}]},context);
    const refreshed=await getPurchasing(search,context);
    assert.equal(refreshed.demand.length,0);
    const links=await query(`select source_type,source_id,planned_quantity,received_quantity,cancelled_quantity
      from inventory_purchase_line_sources where company_id=$1`,[companyId]);
    assert.deepEqual(links.rows,[{source_type:'workorder_request',source_id:requestId,planned_quantity:'2.000',received_quantity:'0.000',cancelled_quantity:'0.000'}]);
    await query("update inventory_purchase_orders set status='ordered' where id=$1",[createdOrder.order.id]);
    const purchaseLine=createdOrder.order.lines[0];
    await receivePurchaseOrder(createdOrder.order.id,{locationId,expectedVersion:createdOrder.order.version,idempotencyKey:randomUUID(),reference:'Partial delivery',lines:[{
      purchaseLineId:purchaseLine.id,acceptedQuantity:1,heldQuantity:0,rejectedQuantity:0,notReceivedQuantity:1,
      outcome:'short',notes:'One unit remains with supplier',holdLocation:'',serialNumbers:[],
    }]},context);
    const afterReceipt=(await getPurchasing(new URLSearchParams({locationId,page:'1',view:'receiving',status:'all',supplierId:'',query:''}),context)).items[0];
    assert.equal(afterReceipt.status,'partially_received');
    assert.equal(Number(afterReceipt.lines[0].demand_sources[0].receivedQuantity),1);
    assert.equal(Number(afterReceipt.lines[0].demand_sources[0].plannedQuantity-afterReceipt.lines[0].demand_sources[0].receivedQuantity-afterReceipt.lines[0].demand_sources[0].cancelledQuantity),1);
    const workorderRequest=(await listWorkorderPartRequests(workorderId))[0];
    assert.equal(workorderRequest.purchaseSupply.readyAtShop,true);
    assert.equal(workorderRequest.purchaseSupply.incomingQuantity,1);
    const cancelled=await savePurchase({action:'cancel',locationId,idempotencyKey:randomUUID(),orderId:afterReceipt.id,expectedVersion:afterReceipt.version,reason:'Supplier cancelled remainder'},context);
    assert.equal(cancelled.order.status,'closed_with_discrepancy');
    const returned=await getPurchasing(search,context);
    assert.equal(Number(returned.demand[0].buy_quantity),1);
    assert.deepEqual(cancelled.order.lines[0].demand_sources.map(source=>({received:Number(source.receivedQuantity),cancelled:Number(source.cancelledQuantity)})),[{received:1,cancelled:1}]);
  } finally {
    await query('delete from inventory_workflow_commands where company_id=$1',[companyId]).catch(()=>{});
    await query('delete from inventory_purchase_events where company_id=$1',[companyId]).catch(()=>{});
    await query('delete from part_allocations where part_request_id in (select id from workorder_part_requests where workorder_id=$1)',[workorderId]).catch(()=>{});
    await query('delete from part_request_events where workorder_id=$1',[workorderId]).catch(()=>{});
    await query('delete from workorder_part_requests where workorder_id=$1',[workorderId]).catch(()=>{});
    await query('delete from workorder_status_events where workorder_id=$1',[workorderId]).catch(()=>{});
    await query('delete from operational_workorders where id=$1',[workorderId]).catch(()=>{});
    await query('delete from workorder_serial_counters where company_id=$1',[companyId]).catch(()=>{});
    for(const table of ['inventory_label_batch_items','inventory_label_batches','inventory_unit_events','inventory_position_movements','inventory_serialized_units','inventory_position_operations','inventory_position_balances','inventory_positions','inventory_purchase_delivery_lines','inventory_purchase_deliveries','inventory_stock_movements','inventory_purchase_receipt_allocations','inventory_purchase_line_sources','local_inventory_receipt_lines','inventory_receipt_lines','inventory_authority_cutovers','inventory_authority_exceptions','inventory_items','local_inventory_receipts','inventory_receipts','inventory_purchase_lines','inventory_purchase_orders','inventory_suppliers','parts_catalog','locations'])
      await query(`delete from ${table} where company_id=$1`,[companyId]).catch(()=>{});
    await query('delete from companies where id=$1',[companyId]).catch(()=>{});
    await query('delete from user_profiles where id=$1',[actorId]).catch(()=>{});
  }
});
