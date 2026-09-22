import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { closePool, getPool, query } from '../../db/pool.js';
import { listInventoryTaskQueue, mutateInventoryTaskAssignment, readInventoryTask } from '../../db/repositories/inventory-task-queue.repo.js';
import { configureInventoryReuse, mutateInventoryReuse } from '../../db/repositories/inventory-reuse.repo.js';
import { getInventoryTaskQueue, postInventoryTaskAssignment } from './inventory-task-queue.service.js';
import { createInventoryReuseFixture, reuseDigest } from './inventory-reuse.fixture.js';

const enabled=process.env.RUN_POSTGRES_INTEGRATION==='1';
const hash=(value)=>createHash('sha256').update(value).digest('hex');
const waitForBlockedCaseLocks=async(count,timeoutMs=3000)=>{
 const deadline=Date.now()+timeoutMs;
 while(Date.now()<deadline){
  const row=(await query(`select count(*)::int count from pg_stat_activity activity
    where activity.wait_event_type='Lock' and activity.state='active'
      and activity.query ilike '%inventory_reuse_cases%'`)).rows[0];
  if(row.count>=count)return;
  await new Promise((resolve)=>setTimeout(resolve,10));
 }
 throw new Error(`Timed out waiting for ${count} blocked custody source lock(s).`);
};
after(async()=>{if(enabled)await closePool();});

test('unified task queue derives every source without stock mutation and assignment is safe', {skip:!enabled}, async()=>{
 const suffix=randomUUID().replaceAll('-','');
 const ids=Object.fromEntries(['company','location','origin','otherCompany','otherLocation','actor','actor2','namedApprover','roleApprover','adminNoShop','officeNoShop','inactive','part','otherPart','damage','transfer','delivery','invoiceDelivery','invoiceDecision','receipt','approval','position','count','unit','otherUnit','reuse','otherReuse'].map((key)=>[key,randomUUID()]));
 const custodyStates=['awaiting_handoff','received_pending_review','hold','repair','repair_complete_pending_review','core_pending_return','scrap_pending_approval','quarantine'];
 const custodyCases=Object.fromEntries(custodyStates.map((status)=>[status,status==='awaiting_handoff'?ids.reuse:randomUUID()]));
 const custodyUnits=Object.fromEntries(custodyStates.map((status)=>[status,status==='awaiting_handoff'?ids.unit:randomUUID()]));
 const custodyActors=Object.fromEntries(['route','release','repair','disposition','quarantine'].map((capability)=>[capability,randomUUID()]));
 const client=await getPool().connect();
 try{
  await client.query('begin');await client.query("set local session_replication_role='replica'");
  await client.query("insert into companies(id,slug,name) values($1,$2,'Task QA'),($3,$4,'Other Task QA')",[ids.company,`task-${suffix}`,ids.otherCompany,`other-task-${suffix}`]);
  await client.query("insert into locations(id,company_id,name) values($1,$2,'Task Shop'),($3,$2,'Origin Shop'),($4,$5,'Other Shop')",[ids.location,ids.company,ids.origin,ids.otherLocation,ids.otherCompany]);
  await client.query("insert into user_profiles(id,display_name,active) values($1,'Task Actor',true),($2,'Second Actor',true),($3,'Named Approver',true),($4,'Role Approver',true),($5,'Admin without shop',true),($6,'Office without shop',true),($7,'Inactive Actor',false)",[ids.actor,ids.actor2,ids.namedApprover,ids.roleApprover,ids.adminNoShop,ids.officeNoShop,ids.inactive]);
  for(const [capability,userId] of Object.entries(custodyActors))await client.query('insert into user_profiles(id,display_name,active) values($1,$2,true)',[userId,`${capability} custody actor`]);
  for(const userId of [ids.actor,ids.actor2,ids.namedApprover,ids.roleApprover,ids.inactive]){
   await client.query("insert into user_company_memberships(user_id,company_id,role,active) values($1,$2,'office',true)",[userId,ids.company]);
   await client.query("insert into user_location_memberships(user_id,company_id,location_id,active) values($1,$2,$3,true)",[userId,ids.company,ids.location]);
  }
  await client.query("update user_company_memberships set role='admin' where company_id=$1 and user_id in($2,$3)",[ids.company,ids.actor,ids.roleApprover]);
  await client.query("insert into user_company_memberships(user_id,company_id,role,active) values($1,$3,'admin',true),($2,$3,'office',true)",[ids.adminNoShop,ids.officeNoShop,ids.company]);
  for(const userId of Object.values(custodyActors)){
   await client.query("insert into user_company_memberships(user_id,company_id,role,active) values($1,$2,'office',true)",[userId,ids.company]);
   await client.query('insert into user_location_memberships(user_id,company_id,location_id,active) values($1,$2,$3,true)',[userId,ids.company,ids.location]);
  }
  await client.query("insert into user_company_memberships(user_id,company_id,role,active) values($1,$2,'office',true)",[ids.actor,ids.otherCompany]);
  await client.query("insert into user_location_memberships(user_id,company_id,location_id,active) values($1,$2,$3,true)",[ids.actor,ids.otherCompany,ids.otherLocation]);
  await client.query("insert into parts_catalog(id,company_id,normalized_part_number,part_number,description,uom_code,tracking_mode) values($1,$2,$3,$4,'Task part','ea','serialized')",[ids.part,ids.company,`TASK${suffix}`,`TASK-${suffix}`]);
  await client.query("insert into parts_catalog(id,company_id,normalized_part_number,part_number,description,uom_code,tracking_mode) values($1,$2,$3,$4,'Other task part','ea','serialized')",[ids.otherPart,ids.otherCompany,`OTHER${suffix}`,`OTHER-${suffix}`]);
  await client.query("insert into inventory_purchase_approval_settings(company_id,approval_limit,currency,approver_user_ids,approver_roles,updated_by) values($1,0,'USD',$2,array['admin']::text[],$3)",[ids.company,[ids.namedApprover,ids.officeNoShop],ids.actor]);
  await client.query("insert into inventory_stock_tasks(id,company_id,location_id,catalog_part_id,kind,status,quantity,uom_code,reason,created_by) values($1,$2,$3,$4,'damage','inspection',1,'ea','Damaged',$5)",[ids.damage,ids.company,ids.location,ids.part,ids.actor]);
  await client.query("insert into inventory_stock_tasks(id,company_id,location_id,destination_id,catalog_part_id,kind,status,quantity,uom_code,reason,created_by) values($1,$2,$3,$4,$5,'transfer','in_transit',1,'ea','Transfer',$6)",[ids.transfer,ids.company,ids.origin,ids.location,ids.part,ids.actor]);
  const draft=JSON.stringify({invoiceNumber:{value:`INV-${suffix}`},vendorName:{value:'Task Vendor'},purchaseOrderNumber:{value:''}});
  await client.query(`insert into invoice_extraction_runs(id,company_id,location_id,created_by,reviewed_by,document_hash,file_name,mime_type,byte_size,idempotency_key,status,provider,model,prompt_version,reviewed_draft,reviewed_at)
   values($1,$2,$3,$4,$4,$5,'delivery.pdf','application/pdf',1,$6,'reviewed','test','test','test',$7::jsonb,now()),
   ($8,$2,$3,$4,$4,$9,'decision.pdf','application/pdf',1,$10,'reviewed','test','test','test',$11::jsonb,now())`,[ids.invoiceDelivery,ids.company,ids.location,ids.actor,hash(`d-${suffix}`),`delivery-${suffix}`,draft,ids.invoiceDecision,hash(`i-${suffix}`),`decision-${suffix}`,draft]);
  await client.query("insert into inventory_purchase_deliveries(id,company_id,invoice_run_id,location_id,received_by,idempotency_key,request_hash,status) values($1,$2,$3,$4,$5,$6,$7,'posted')",[ids.delivery,ids.company,ids.invoiceDelivery,ids.location,ids.actor,`delivery-${suffix}`,hash(`delivery-${suffix}`)]);
  await client.query("insert into inventory_purchase_delivery_lines(company_id,delivery_id,purchase_line_id,outcome,expected_quantity,actual_quantity,usable_quantity,held_quantity,rejected_quantity,uom_code) values($1,$2,$3,'shortage',1,0,0,0,0,'ea')",[ids.company,ids.delivery,randomUUID()]);
  await client.query("insert into inventory_receipts(id,company_id,location_id,created_by,idempotency_key,provider,provider_marker,status,confirmed_at) values($1,$2,$3,$4,$5,'local_direct',$6,'confirmed',now())",[ids.receipt,ids.company,ids.location,ids.actor,`receipt-${suffix}`,`DIRECT-${suffix}`]);
  await client.query(`insert into local_inventory_receipts(id,company_id,location_id,created_by,idempotency_key,request_hash,status,line_count,total_quantity,physical_confirmation,confirmation_hash,source_type,posting_route,no_purchase_order_reason)
   values($1,$2,$3,$4,$5,$6,'posted',0,0,'physically_received',$7,'direct','no_purchase_order','Direct arrival')`,[ids.receipt,ids.company,ids.location,ids.actor,`receipt-${suffix}`,hash(`receipt-${suffix}`),hash(`confirm-${suffix}`)]);
  await client.query(`insert into inventory_direct_receipt_approval_requests(id,company_id,location_id,catalog_part_id,submitted_by,idempotency_key,request_hash,original_command,receiver_evidence)
   values($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb)`,[ids.approval,ids.company,ids.location,ids.part,ids.actor,randomUUID(),hash(`approval-${suffix}`),JSON.stringify({partNumber:`TASK-${suffix}`}),JSON.stringify({receiver:'QA'})]);
  await client.query("insert into inventory_positions(id,company_id,location_id,code,name,kind,usage,can_store,is_pickable,created_by) values($1,$2,$3,'A-1','Aisle 1','bin','storage',true,true,$4)",[ids.position,ids.company,ids.location,ids.actor]);
  await client.query(`insert into inventory_position_count_sessions(id,company_id,location_id,position_id,status,created_by,idempotency_key,request_hash)
   values($1,$2,$3,$4,'needs_recount',$5,$6,$7)`,[ids.count,ids.company,ids.location,ids.position,ids.actor,`count-${suffix}`,hash(`count-${suffix}`)]);
  await client.query(`insert into inventory_serialized_units(id,company_id,location_id,receipt_id,receipt_line_id,unit_ordinal,serial_number,status,custody_holder_type,custody_location_id)
   values($1,$2,$3,$4,$5,1,$6,'removed','handoff',$3)`,[ids.unit,ids.company,ids.location,randomUUID(),randomUUID(),`SER-${suffix}`]);
  await client.query(`insert into inventory_reuse_cases(id,company_id,location_id,unit_id,usage_id,asset_id,original_workorder_id,removal_workorder_id,installation_status,status,removed_by_user_id,reason,ownership,ownership_evidence)
   values($1,$2,$3,$4,$5,$6,$7,$8,'installed','awaiting_handoff',$9,'Removed for QA','unknown','')`,[ids.reuse,ids.company,ids.location,ids.unit,randomUUID(),randomUUID(),randomUUID(),randomUUID(),ids.actor]);
  await client.query("insert into inventory_reuse_capability_grants(company_id,location_id,user_id,capability,granted_by_user_id) values($1,$2,$3,'receive',$3)",[ids.company,ids.location,ids.actor]);
  for(const status of custodyStates.filter((value)=>value!=='awaiting_handoff')){
   await client.query(`insert into inventory_serialized_units(id,company_id,location_id,receipt_id,receipt_line_id,unit_ordinal,serial_number,status,custody_holder_type,custody_location_id)
    values($1,$2,$3,$4,$5,1,$6,'removed','inventory_location',$3)`,[custodyUnits[status],ids.company,ids.location,randomUUID(),randomUUID(),`CUSTODY-${status}-${suffix}`]);
   await client.query(`insert into inventory_reuse_cases(id,company_id,location_id,unit_id,usage_id,asset_id,original_workorder_id,removal_workorder_id,installation_status,status,removed_by_user_id,received_by_user_id,reason,ownership,ownership_evidence,receipt_evidence)
    values($1,$2,$3,$4,$5,$6,$7,$8,'installed',$9,$10,$11,'Custody matrix','company','Receipt evidence','Physically received')`,[custodyCases[status],ids.company,ids.location,custodyUnits[status],randomUUID(),randomUUID(),randomUUID(),randomUUID(),status,ids.actor,ids.actor2]);
  }
  for(const [capability,userId] of Object.entries(custodyActors))await client.query('insert into inventory_reuse_capability_grants(company_id,location_id,user_id,capability,granted_by_user_id) values($1,$2,$3,$4,$5)',[ids.company,ids.location,userId,capability,ids.actor]);
  await client.query(`insert into inventory_serialized_units(id,company_id,location_id,receipt_id,receipt_line_id,unit_ordinal,serial_number,status,custody_holder_type,custody_location_id)
   values($1,$2,$3,$4,$5,1,$6,'removed','handoff',$3)`,[ids.otherUnit,ids.otherCompany,ids.otherLocation,randomUUID(),randomUUID(),`OTHER-SER-${suffix}`]);
  await client.query(`insert into inventory_reuse_cases(id,company_id,location_id,unit_id,usage_id,asset_id,original_workorder_id,removal_workorder_id,installation_status,status,removed_by_user_id,reason,ownership,ownership_evidence)
   values($1,$2,$3,$4,$5,$6,$7,$8,'installed','awaiting_handoff',$9,'Removed for mixed-role QA','unknown','')`,[ids.otherReuse,ids.otherCompany,ids.otherLocation,ids.otherUnit,randomUUID(),randomUUID(),randomUUID(),randomUUID(),ids.actor]);
  await client.query('commit');
 }catch(error){await client.query('rollback').catch(()=>{});throw error;}finally{client.release();}
 try{
  const stockBefore=await query('select (select count(*) from inventory_items where company_id=$1)::int items,(select count(*) from inventory_stock_movements where company_id=$1)::int movements',[ids.company]);
  const result=await listInventoryTaskQueue({companyIds:[ids.company],locationIds:[ids.location],actorId:ids.actor,actorRole:'office',page:1,view:'my_work'});
  const kinds=new Set(result.items.map((item)=>item.sourceType));
  for(const kind of ['damage_inspection','receipt_exception','missing_invoice','invoice_po_decision','no_po_approval','transfer_receipt','position_recount','removed_part_custody']) assert.equal(kinds.has(kind),true,`missing ${kind}`);
  const taskLink=(kind)=>new URL(result.items.find((item)=>item.sourceType===kind).deepLink,'http://inventory.test').searchParams;
  const damageLink=taskLink('damage_inspection');
  assert.equal(damageLink.get('inventorySection'),'tasks');assert.equal(damageLink.get('taskOwner'),'damage');assert.equal(damageLink.get('taskId'),ids.damage);assert.equal(damageLink.get('taskLocation'),ids.location);
  const transferLink=taskLink('transfer_receipt');
  assert.equal(transferLink.get('inventorySection'),'tasks');assert.equal(transferLink.get('taskOwner'),'transfer');assert.equal(transferLink.get('taskId'),ids.transfer);assert.equal(transferLink.get('taskLocation'),ids.location);
  const recountLink=taskLink('position_recount');
  assert.equal(recountLink.get('inventorySection'),'stock');assert.equal(recountLink.get('stockMode'),'location');assert.equal(recountLink.get('taskOwner'),'recount');assert.equal(recountLink.get('positionId'),ids.position);assert.equal(recountLink.get('taskLocation'),ids.location);
  const custodyLink=taskLink('removed_part_custody');
  assert.equal(custodyLink.get('inventorySection'),'tasks');assert.equal(custodyLink.get('taskOwner'),'custody');assert.equal(custodyLink.get('reuseCaseId'),ids.reuse);assert.equal(custodyLink.get('taskLocation'),ids.location);
  const custodyExpected={
   awaiting_handoff:['receive'],received_pending_review:['route','release','quarantine'],hold:['route','release','quarantine'],repair:['repair'],
   repair_complete_pending_review:['route','release','quarantine'],core_pending_return:['disposition'],scrap_pending_approval:['disposition'],quarantine:['route','quarantine'],
  };
  const custodyQueue=(actorId,view='all')=>listInventoryTaskQueue({companyIds:[ids.company],locationIds:[ids.location],actorId,sourceType:'removed_part_custody',page:1,view});
  const receiveQueue=await custodyQueue(ids.actor);
  assert.deepEqual(receiveQueue.items.map((item)=>item.sourceId),[custodyCases.awaiting_handoff]);
  assert.deepEqual(receiveQueue.items[0].capabilityOptions,custodyExpected.awaiting_handoff);
  assert.deepEqual(receiveQueue.items[0].owner.capabilityOptions,custodyExpected.awaiting_handoff);
  assert.deepEqual(receiveQueue.items[0].nextActionOptions,[{capability:'receive',label:'Receive removed part'}]);
  const expectedByCapability={route:['received_pending_review','hold','repair_complete_pending_review','quarantine'],release:['received_pending_review','hold','repair_complete_pending_review'],repair:['repair'],disposition:['core_pending_return','scrap_pending_approval'],quarantine:['received_pending_review','hold','repair_complete_pending_review','quarantine']};
  for(const [capability,statuses] of Object.entries(expectedByCapability)){
   const items=(await custodyQueue(custodyActors[capability])).items;
   assert.deepEqual(new Set(items.map((item)=>item.sourceId)),new Set(statuses.map((status)=>custodyCases[status])),`${capability} sees only matching custody states`);
   for(const item of items){const status=statuses.find((value)=>custodyCases[value]===item.sourceId);assert.deepEqual(item.capabilityOptions,custodyExpected[status]);}
  }
  const releaseOnly=(await custodyQueue(custodyActors.release)).items.find((item)=>item.sourceId===custodyCases.received_pending_review);
  assert.equal(releaseOnly.capability,'release');assert.equal(releaseOnly.nextAction,'Release or hold');assert.notEqual(releaseOnly.nextAction,'Inspect and route');
  const quarantineOnly=(await custodyQueue(custodyActors.quarantine)).items.find((item)=>item.sourceId===custodyCases.received_pending_review);
  assert.equal(quarantineOnly.capability,'quarantine');assert.equal(quarantineOnly.nextAction,'Resolve quarantine');assert.notEqual(quarantineOnly.nextAction,'Inspect and route');
  const releaseDetail=await readInventoryTask({companyId:ids.company,locationId:ids.location,actorId:custodyActors.release,actorRole:'office',sourceType:'removed_part_custody',sourceId:custodyCases.received_pending_review});
  assert.equal(releaseDetail.capability,'release');assert.equal(releaseDetail.nextAction,'Release or hold');
  assert.equal((await custodyQueue(ids.adminNoShop)).items.length,0,'Admin without an explicit matching custody grant is denied');
  const awaitingTask=receiveQueue.items[0];
  assert.equal(await readInventoryTask({companyId:ids.company,locationId:ids.location,actorId:ids.adminNoShop,actorRole:'admin',sourceType:'removed_part_custody',sourceId:awaitingTask.sourceId}),null);
  await assert.rejects(()=>mutateInventoryTaskAssignment({companyId:ids.company,locationId:ids.location,actorId:ids.adminNoShop,actorRole:'admin',action:'claim',sourceType:'removed_part_custody',sourceId:awaitingTask.sourceId,sourceVersion:awaitingTask.sourceVersion,expectedAssignmentVersion:0,idempotencyKey:`custody-admin-no-grant-${suffix}`,reason:'Admin cannot bypass custody grants'}),{code:'INVENTORY_TASK_FORBIDDEN'});
  const receivedTask=(await custodyQueue(custodyActors.route)).items.find((item)=>item.sourceId===custodyCases.received_pending_review);
  const custodyBase={companyId:ids.company,locationId:ids.location,actorId:custodyActors.route,actorRole:'office',sourceType:'removed_part_custody',sourceId:receivedTask.sourceId,sourceVersion:receivedTask.sourceVersion,reason:'Own the canonical custody action'};
  const assignedCustody=await mutateInventoryTaskAssignment({...custodyBase,action:'assign',assignedUserId:custodyActors.release,expectedAssignmentVersion:0,idempotencyKey:`custody-assign-${suffix}`});
  assert.equal(assignedCustody.task.assignedUser.userId,custodyActors.release);
  assert.equal(assignedCustody.task.capability,'route');assert.equal(assignedCustody.task.nextAction,'Route part');
  await assert.rejects(()=>mutateInventoryTaskAssignment({...custodyBase,action:'assign',assignedUserId:custodyActors.repair,expectedAssignmentVersion:1,idempotencyKey:`custody-wrong-target-${suffix}`}),{code:'INVENTORY_TASK_FORBIDDEN'});
  await query("update inventory_reuse_cases set status='repair',case_version=case_version+1,updated_at=now() where company_id=$1 and id=$2",[ids.company,receivedTask.sourceId]);
  await assert.rejects(()=>mutateInventoryTaskAssignment({...custodyBase,action:'unassign',expectedAssignmentVersion:1,idempotencyKey:`custody-stale-state-${suffix}`}),{code:'INVENTORY_TASK_SOURCE_STALE'});
  const recoverableCustody=(await custodyQueue(custodyActors.repair,'my_work')).items.find((item)=>item.sourceId===receivedTask.sourceId);
  assert.equal(recoverableCustody?.assignedUser?.userId,custodyActors.release,'state change makes the old capability owner recoverable');
  assert.deepEqual(recoverableCustody?.capabilityOptions,['repair']);
  assert.equal(await readInventoryTask({companyId:ids.company,locationId:ids.location,actorId:custodyActors.release,actorRole:'office',sourceType:'removed_part_custody',sourceId:receivedTask.sourceId}),null);
  assert.equal((await readInventoryTask({companyId:ids.company,locationId:ids.location,actorId:custodyActors.repair,actorRole:'office',sourceType:'removed_part_custody',sourceId:receivedTask.sourceId}))?.sourceId,receivedTask.sourceId);
  const recoveredCustody=await mutateInventoryTaskAssignment({...custodyBase,actorId:custodyActors.repair,action:'unassign',sourceVersion:recoverableCustody.sourceVersion,expectedAssignmentVersion:1,idempotencyKey:`custody-recover-${suffix}`});
  assert.equal(recoveredCustody.task.assignedUser,null);
  assert.equal(recoveredCustody.task.capability,'repair');assert.equal(recoveredCustody.task.nextAction,'Manage repair');
  await query(`insert into inventory_task_assignments(company_id,location_id,source_type,source_id,capability,required_role,assigned_user_id,assigned_by)
    values($1,$2,'removed_part_custody',$3,'route','office',$4,$4)`,[ids.company,ids.location,custodyCases.hold,custodyActors.release]);
  await query(`insert into product_module_access_rules(company_id,location_id,subject_type,user_id,module_key,access_mode,updated_by_user_id)
    values($1,$2,'user',$3,'workorders','read',$4)`,[ids.company,ids.location,custodyActors.release,ids.actor]);
  assert.equal((await custodyQueue(custodyActors.release)).items.length,0,'read-only Workorders access cannot expose actionable custody work');
  assert.equal(await readInventoryTask({companyId:ids.company,locationId:ids.location,actorId:custodyActors.release,actorRole:'office',sourceType:'removed_part_custody',sourceId:custodyCases.hold}),null);
  await assert.rejects(()=>mutateInventoryTaskAssignment({companyId:ids.company,locationId:ids.location,actorId:custodyActors.release,actorRole:'office',action:'claim',sourceType:'removed_part_custody',sourceId:custodyCases.hold,sourceVersion:'1',expectedAssignmentVersion:1,idempotencyKey:`custody-read-only-claim-${suffix}`,reason:'Read-only cannot claim'}),{code:'INVENTORY_TASK_FORBIDDEN'});
  await assert.rejects(()=>mutateInventoryTaskAssignment({companyId:ids.company,locationId:ids.location,actorId:custodyActors.route,actorRole:'office',action:'assign',assignedUserId:custodyActors.release,sourceType:'removed_part_custody',sourceId:custodyCases.quarantine,sourceVersion:'1',expectedAssignmentVersion:0,idempotencyKey:`custody-read-only-target-${suffix}`,reason:'Read-only cannot own'}),{code:'INVENTORY_TASK_FORBIDDEN'});
  const moduleRecoverable=(await custodyQueue(custodyActors.route,'my_work')).items.find((item)=>item.sourceId===custodyCases.hold);
  assert.equal(moduleRecoverable?.assignedUser?.userId,custodyActors.release,'module access removal makes custody ownership recoverable');
  await mutateInventoryTaskAssignment({companyId:ids.company,locationId:ids.location,actorId:custodyActors.route,actorRole:'office',action:'unassign',sourceType:'removed_part_custody',sourceId:custodyCases.hold,sourceVersion:moduleRecoverable.sourceVersion,expectedAssignmentVersion:1,idempotencyKey:`custody-module-recover-${suffix}`,reason:'Recover read-only ownership'});
  await query("update product_module_access_rules set access_mode='off',version=version+1 where company_id=$1 and location_id=$2 and user_id=$3 and module_key='workorders'",[ids.company,ids.location,custodyActors.release]);
  assert.equal((await custodyQueue(custodyActors.release)).items.length,0,'hidden Workorders access cannot expose custody work');
  await query("update product_module_access_rules set access_mode='full',version=version+1 where company_id=$1 and location_id=$2 and user_id=$3 and module_key='workorders'",[ids.company,ids.location,custodyActors.release]);
  assert.ok((await custodyQueue(custodyActors.release)).items.length>0,'full Workorders access restores matching custody work');
  const nonApprover=await listInventoryTaskQueue({companyIds:[ids.company],locationIds:[ids.location],actorId:ids.actor2,page:1,view:'all'});
  assert.equal(nonApprover.items.some((item)=>item.sourceType==='no_po_approval'),false,'non-approver must not see no-PO approval work');
  const roleApprover=await listInventoryTaskQueue({companyIds:[ids.company],locationIds:[ids.location],actorId:ids.roleApprover,page:1,view:'my_work'});
  assert.equal(roleApprover.items.some((item)=>item.sourceType==='no_po_approval'),true,'configured approver role must see no-PO approval work');
  const namedApprover=await listInventoryTaskQueue({companyIds:[ids.company],locationIds:[ids.location],actorId:ids.namedApprover,page:1,view:'my_work'});
  assert.equal(namedApprover.items.some((item)=>item.sourceType==='no_po_approval'),true,'configured named approver must see no-PO approval work');
  const namedApproverWithoutShop=await listInventoryTaskQueue({companyIds:[ids.company],locationIds:[ids.location],actorId:ids.officeNoShop,page:1,view:'all'});
  assert.equal(namedApproverWithoutShop.items.some((item)=>item.sourceType==='no_po_approval'),false,'named Office approver without current shop access must not see no-PO approval work');
  const noPo=result.items.find((item)=>item.sourceType==='no_po_approval');
  const noPoBase={companyId:ids.company,locationId:ids.location,actorRole:'office',sourceType:noPo.sourceType,sourceId:noPo.sourceId,sourceVersion:noPo.sourceVersion,expectedAssignmentVersion:0,reason:'Review no-PO arrival'};
  await assert.rejects(()=>mutateInventoryTaskAssignment({...noPoBase,action:'claim',actorId:ids.actor2,idempotencyKey:`no-po-nonapprover-${suffix}`}),{code:'INVENTORY_TASK_FORBIDDEN'});
  await assert.rejects(()=>mutateInventoryTaskAssignment({...noPoBase,action:'assign',actorId:ids.actor,actorRole:'admin',assignedUserId:ids.actor2,idempotencyKey:`no-po-assign-nonapprover-${suffix}`}),{code:'INVENTORY_TASK_FORBIDDEN'});
  await assert.rejects(()=>mutateInventoryTaskAssignment({...noPoBase,action:'claim',actorId:ids.officeNoShop,idempotencyKey:`no-po-no-shop-claim-${suffix}`}),{code:'INVENTORY_TASK_FORBIDDEN'});
  await assert.rejects(()=>mutateInventoryTaskAssignment({...noPoBase,action:'assign',actorId:ids.actor,actorRole:'admin',assignedUserId:ids.officeNoShop,idempotencyKey:`no-po-no-shop-assign-${suffix}`}),{code:'INVENTORY_TASK_FORBIDDEN'});
  await query(`insert into inventory_task_assignments(company_id,location_id,source_type,source_id,capability,required_role,assigned_user_id,assigned_by)
    values($1,$2,'no_po_approval',$3,'approve_no_po','office',$4,$4)`,[ids.company,ids.location,ids.approval,ids.namedApprover]);
  await query('update user_location_memberships set active=false where company_id=$1 and location_id=$2 and user_id=$3',[ids.company,ids.location,ids.namedApprover]);
  await assert.rejects(()=>mutateInventoryTaskAssignment({...noPoBase,action:'claim',actorId:ids.namedApprover,idempotencyKey:`no-po-removed-shop-claim-${suffix}`}),{code:'INVENTORY_TASK_FORBIDDEN'});
  const visiblePastInvalidAssignment=await listInventoryTaskQueue({companyIds:[ids.company],locationIds:[ids.location],actorId:ids.roleApprover,page:1,view:'my_work'});
  const recoverable=visiblePastInvalidAssignment.items.find((item)=>item.sourceId===ids.approval);
  assert.equal(recoverable?.assignedUser?.userId,ids.namedApprover,'ownership becomes recoverable after an Office approver loses shop access');
  assert.equal(recoverable?.actions.canUnassign,true);
  const unassignedNoPo=await mutateInventoryTaskAssignment({...noPoBase,action:'unassign',actorId:ids.actor,actorRole:'admin',expectedAssignmentVersion:1,idempotencyKey:`no-po-unassign-${suffix}`});
  assert.equal(unassignedNoPo.task.assignedUser,null);
  const claimedNoPo=await mutateInventoryTaskAssignment({...noPoBase,action:'claim',actorId:ids.actor,actorRole:'admin',expectedAssignmentVersion:2,idempotencyKey:`no-po-approver-${suffix}`});
  assert.equal(claimedNoPo.task.assignedUser.userId,ids.actor);
  await query("update inventory_purchase_approval_settings set approver_user_ids=$2,approver_roles=array['admin','office']::text[],version=version+1 where company_id=$1",[ids.company,[ids.namedApprover]]);
  const roleApproverWithoutShop=await listInventoryTaskQueue({companyIds:[ids.company],locationIds:[ids.location],actorId:ids.officeNoShop,page:1,view:'all'});
  assert.equal(roleApproverWithoutShop.items.some((item)=>item.sourceType==='no_po_approval'),false,'role-based Office approver without current shop access must not see no-PO approval work');
  await assert.rejects(()=>mutateInventoryTaskAssignment({...noPoBase,action:'claim',actorId:ids.officeNoShop,expectedAssignmentVersion:3,idempotencyKey:`no-po-role-no-shop-claim-${suffix}`}),{code:'INVENTORY_TASK_FORBIDDEN'});
  await assert.rejects(()=>mutateInventoryTaskAssignment({...noPoBase,action:'assign',actorId:ids.actor,actorRole:'admin',assignedUserId:ids.officeNoShop,expectedAssignmentVersion:3,idempotencyKey:`no-po-role-no-shop-assign-${suffix}`}),{code:'INVENTORY_TASK_FORBIDDEN'});
  const mixedBefore=await listInventoryTaskQueue({companyIds:[ids.company,ids.otherCompany],locationIds:[ids.location,ids.otherLocation],actorId:ids.actor,page:1,view:'my_work'});
  assert.equal(mixedBefore.items.some((item)=>item.sourceId===ids.otherReuse),false,'Admin in one company must not elevate Office in another company');
  await query("insert into inventory_reuse_capability_grants(company_id,location_id,user_id,capability,granted_by_user_id) values($1,$2,$3,'receive',$3)",[ids.otherCompany,ids.otherLocation,ids.actor]);
  const mixedAfter=await listInventoryTaskQueue({companyIds:[ids.company,ids.otherCompany],locationIds:[ids.location,ids.otherLocation],actorId:ids.actor,page:1,view:'my_work'});
  const grantedOtherReuse=mixedAfter.items.find((item)=>item.sourceId===ids.otherReuse);
  assert.equal(grantedOtherReuse?.actions.canClaim,true,'company-local reuse grant should enable the Office task');
  const missingInvoice=result.items.find((item)=>item.sourceType==='missing_invoice');
  const genericBase={locationId:ids.location,action:'claim',sourceType:missingInvoice.sourceType,sourceId:missingInvoice.sourceId,sourceVersion:missingInvoice.sourceVersion,expectedAssignmentVersion:0,reason:'Attach the missing invoice'};
  const adminNoShopContext={actor:{id:ids.adminNoShop,role:'admin'},companyIds:new Set([ids.company]),locationIds:new Set(),companyRoles:new Map([[ids.company,'admin']])};
  const officeNoShopContext={actor:{id:ids.officeNoShop,role:'office'},companyIds:new Set([ids.company]),locationIds:new Set(),companyRoles:new Map([[ids.company,'office']])};
  const actorContext={actor:{id:ids.actor,role:'admin'},companyIds:new Set([ids.company]),locationIds:new Set([ids.location]),companyRoles:new Map([[ids.company,'admin']])};
  const adminWithoutShopList=await getInventoryTaskQueue(new URLSearchParams({locationId:ids.location,view:'my_work'}),adminNoShopContext);
  assert.equal(adminWithoutShopList.items.some((item)=>item.sourceId===ids.receipt),true,'company Admin lists generic shop work without a location membership');
  await assert.rejects(()=>getInventoryTaskQueue(new URLSearchParams({locationId:ids.location,view:'my_work'}),officeNoShopContext),{code:'inventory_not_found'});
  await assert.rejects(()=>postInventoryTaskAssignment({...genericBase,idempotencyKey:`office-no-shop-claim-${suffix}`},officeNoShopContext),{code:'inventory_not_found'});
  await assert.rejects(()=>postInventoryTaskAssignment({...genericBase,action:'assign',assignedUserId:ids.officeNoShop,idempotencyKey:`office-no-shop-assign-${suffix}`},actorContext),{code:'INVENTORY_TASK_FORBIDDEN'});
  const adminClaim=await postInventoryTaskAssignment({...genericBase,idempotencyKey:`admin-no-shop-claim-${suffix}`},adminNoShopContext);
  assert.equal(adminClaim.task.assignedUser.userId,ids.adminNoShop);
  const adminUnassign=await postInventoryTaskAssignment({...genericBase,action:'unassign',expectedAssignmentVersion:1,idempotencyKey:`admin-no-shop-unassign-${suffix}`},adminNoShopContext);
  assert.equal(adminUnassign.task.assignedUser,null);
  const assignedAdmin=await postInventoryTaskAssignment({...genericBase,action:'assign',assignedUserId:ids.adminNoShop,expectedAssignmentVersion:2,idempotencyKey:`admin-no-shop-assign-${suffix}`},actorContext);
  assert.equal(assignedAdmin.task.assignedUser.userId,ids.adminNoShop);
  const finalAdminUnassign=await postInventoryTaskAssignment({...genericBase,action:'unassign',expectedAssignmentVersion:3,idempotencyKey:`admin-no-shop-final-unassign-${suffix}`},adminNoShopContext);
  assert.equal(finalAdminUnassign.task.assignedUser,null);
  assert.deepEqual((await query('select (select count(*) from inventory_items where company_id=$1)::int items,(select count(*) from inventory_stock_movements where company_id=$1)::int movements',[ids.company])).rows[0],stockBefore.rows[0]);
  const recount=result.items.find((item)=>item.sourceType==='position_recount');
  const input={companyId:ids.company,locationId:ids.location,actorId:ids.actor,actorRole:'office',action:'claim',sourceType:recount.sourceType,sourceId:recount.sourceId,sourceVersion:recount.sourceVersion,expectedAssignmentVersion:0,idempotencyKey:`claim-${suffix}`,reason:'Count this position'};
  const claimed=await mutateInventoryTaskAssignment(input);assert.equal(claimed.task.assignedUser.userId,ids.actor);assert.equal(claimed.task.assignmentVersion,1);
  assert.deepEqual(await mutateInventoryTaskAssignment(input),claimed,'same actor command replay must be stable');
  await assert.rejects(()=>mutateInventoryTaskAssignment({...input,reason:'Changed replay'}),{code:'INVENTORY_TASK_IDEMPOTENCY_CONFLICT'});
  await assert.rejects(()=>mutateInventoryTaskAssignment({...input,idempotencyKey:`stale-${suffix}`,expectedAssignmentVersion:0}),{code:'INVENTORY_TASK_ASSIGNMENT_STALE'});
  await assert.rejects(()=>mutateInventoryTaskAssignment({...input,action:'assign',assignedUserId:ids.inactive,idempotencyKey:`inactive-${suffix}`,expectedAssignmentVersion:1}),{code:'INVENTORY_TASK_FORBIDDEN'});
  await query("update inventory_position_count_sessions set version=version+1 where company_id=$1 and id=$2",[ids.company,ids.count]);
  await assert.rejects(()=>mutateInventoryTaskAssignment({...input,action:'unassign',idempotencyKey:`source-stale-${suffix}`,expectedAssignmentVersion:1}),{code:'INVENTORY_TASK_SOURCE_STALE'});
  const transfer=result.items.find((item)=>item.sourceType==='transfer_receipt');
  const sameReplay={companyId:ids.company,locationId:ids.location,actorId:ids.actor,actorRole:'office',action:'claim',sourceType:transfer.sourceType,sourceId:transfer.sourceId,sourceVersion:transfer.sourceVersion,expectedAssignmentVersion:0,idempotencyKey:`same-concurrent-${suffix}`,reason:'Receive this transfer'};
  const concurrentReplay=await Promise.all([mutateInventoryTaskAssignment(sameReplay),mutateInventoryTaskAssignment(sameReplay)]);
  assert.deepEqual(concurrentReplay[0],concurrentReplay[1],'concurrent identical actor commands must replay the same result');
  const damage=result.items.find((item)=>item.sourceType==='damage_inspection');
  const concurrentBase={companyId:ids.company,locationId:ids.location,actorRole:'office',action:'claim',sourceType:damage.sourceType,sourceId:damage.sourceId,sourceVersion:damage.sourceVersion,expectedAssignmentVersion:0,reason:'Claim damage'};
  await assert.rejects(()=>mutateInventoryTaskAssignment({...concurrentBase,actorId:ids.inactive,idempotencyKey:`inactive-claim-${suffix}`}),{code:'INVENTORY_TASK_FORBIDDEN'});
  await assert.rejects(()=>mutateInventoryTaskAssignment({...concurrentBase,companyId:ids.otherCompany,locationId:ids.otherLocation,actorId:ids.actor,idempotencyKey:`cross-tenant-${suffix}`}),{code:'inventory_not_found'});
  await assert.rejects(()=>mutateInventoryTaskAssignment({...concurrentBase,locationId:ids.origin,actorId:ids.actor,idempotencyKey:`wrong-shop-${suffix}`}),{code:'inventory_not_found'});
  const settled=await Promise.allSettled([
   mutateInventoryTaskAssignment({...concurrentBase,actorId:ids.actor,idempotencyKey:`concurrent-a-${suffix}`}),
   mutateInventoryTaskAssignment({...concurrentBase,actorId:ids.actor2,idempotencyKey:`concurrent-b-${suffix}`}),
  ]);
  assert.equal(settled.filter((entry)=>entry.status==='fulfilled').length,1);assert.equal(settled.filter((entry)=>entry.status==='rejected').length,1);
  for(const sourceType of ['receipt_exception','invoice_po_decision']){
   const source=result.items.find((item)=>item.sourceType===sourceType);
   const locked=await mutateInventoryTaskAssignment({companyId:ids.company,locationId:ids.location,actorId:ids.actor,actorRole:'office',action:'claim',sourceType,sourceId:source.sourceId,sourceVersion:source.sourceVersion,expectedAssignmentVersion:0,idempotencyKey:`source-owner-${sourceType}-${suffix}`,reason:`Own ${sourceType}`});
   assert.equal(locked.task.sourceVersion,source.sourceVersion,`${sourceType} stays on its locked source version`);
  }
  assert.equal((await query('select count(*)::int count from inventory_task_assignment_events where company_id=$1',[ids.company])).rows[0].count,14);
  // A stable transfer source ID follows the physical receiving owner across shops.
  const transferRead=(locationId)=>readInventoryTask({companyId:ids.company,locationId,actorId:ids.actor,actorRole:'admin',sourceType:'transfer_receipt',sourceId:ids.transfer});
  const beforeReturn=await transferRead(ids.location);
  assert.equal(beforeReturn.nextAction,'Receive at destination');
  const blocker=await getPool().connect();
  let pending;
  try{
   await blocker.query('begin');
   await blocker.query("update inventory_stock_tasks set transfer_state='returning',version=version+1 where company_id=$1 and id=$2",[ids.company,ids.transfer]);
   pending=mutateInventoryTaskAssignment({...sameReplay,action:'unassign',expectedAssignmentVersion:1,idempotencyKey:`transfer-transition-${suffix}`}).then(value=>({value}),error=>({error}));
   const deadline=Date.now()+3000;let waiting=false;
   while(Date.now()<deadline){
    waiting=Number((await query("select count(*)::int count from pg_stat_activity where wait_event_type='Lock' and state='active' and query ilike '%inventory_stock_tasks%'")).rows[0].count)>0;
    if(waiting)break;await new Promise(resolve=>setTimeout(resolve,10));
   }
   assert.equal(waiting,true,'assignment waits on canonical transfer owner');
   await blocker.query('commit');
   assert.equal((await pending).error?.code,'INVENTORY_TASK_SOURCE_STALE');
  }finally{await blocker.query('rollback').catch(()=>{});blocker.release();if(pending)await pending;}
  assert.equal(await transferRead(ids.location),null,'return task leaves destination queue');
  const returning=await transferRead(ids.origin);
  assert.equal(returning.id,beforeReturn.id);assert.equal(returning.assignedUser.userId,beforeReturn.assignedUser.userId);
  assert.equal(returning.assignmentVersion,beforeReturn.assignmentVersion);
  assert.equal(returning.nextAction,'Confirm source return');
  assert.equal(new URL(returning.deepLink,'http://inventory.test').searchParams.get('taskLocation'),ids.origin);
  await query("insert into inventory_transfer_discrepancies(company_id,task_id,kind,quantity,reason,holder,created_by) values($1,$2,'short',1,'Missing on arrival','Carrier',$3)",[ids.company,ids.transfer,ids.actor]);
  await query("update inventory_stock_tasks set transfer_state='completed',status='cancelled',completed_quantity=1,returned_quantity=1,version=version+1 where company_id=$1 and id=$2",[ids.company,ids.transfer]);
  const discrepancy=await transferRead(ids.location);
  assert.equal(discrepancy.id,beforeReturn.id);assert.equal(discrepancy.nextAction,'Resolve transfer discrepancy');assert.equal(discrepancy.role,'admin');
  assert.equal(new URL(discrepancy.deepLink,'http://inventory.test').searchParams.get('taskLocation'),ids.location);
  assert.equal(await transferRead(ids.origin),null);
  const officeList=await listInventoryTaskQueue({companyIds:[ids.company],locationIds:[ids.location],actorId:ids.actor2,page:1,view:'my_work'});
  assert.equal(officeList.items.some(item=>item.sourceId===ids.transfer),false,'office cannot claim Admin reconciliation');
  await assert.rejects(mutateInventoryTaskAssignment({...sameReplay,actorId:ids.actor2,sourceVersion:discrepancy.sourceVersion,expectedAssignmentVersion:1,action:'assign',assignedUserId:ids.actor2,idempotencyKey:`office-reconcile-${suffix}`}),{code:'INVENTORY_TASK_FORBIDDEN'});
  const queue=await listInventoryTaskQueue({companyIds:[ids.company],locationIds:[ids.location,ids.origin],actorId:ids.actor,page:1,view:'my_work'});
  assert.equal(queue.items.filter(item=>item.sourceId===ids.transfer).length,1);
  await query("update inventory_transfer_discrepancies set status='resolved',resolution_type='received_or_returned',resolution_reference='Returned to source',resolved_by=$3,resolved_at=now() where company_id=$1 and task_id=$2",[ids.company,ids.transfer,ids.actor]);
  await query('update inventory_stock_tasks set version=version+1 where company_id=$1 and id=$2',[ids.company,ids.transfer]);
  assert.equal(await transferRead(ids.location),null,'resolved transfer disappears');

  assert.deepEqual((await query('select (select count(*) from inventory_items where company_id=$1)::int items,(select count(*) from inventory_stock_movements where company_id=$1)::int movements',[ids.company])).rows[0],stockBefore.rows[0]);
 }finally{
  const cleanup=await getPool().connect();try{await cleanup.query('begin');await cleanup.query("set local session_replication_role='replica'");const companies=[ids.company,ids.otherCompany];for(const table of ['inventory_transfer_discrepancies','inventory_task_assignment_commands','inventory_task_assignment_events','inventory_task_assignments','inventory_reuse_capability_grants','inventory_reuse_cases','inventory_serialized_units','inventory_position_count_sessions','inventory_positions','inventory_direct_receipt_approval_events','inventory_direct_receipt_approval_requests','local_inventory_receipts','inventory_receipts','inventory_purchase_delivery_lines','inventory_purchase_deliveries','invoice_extraction_runs','inventory_stock_tasks','inventory_purchase_approval_settings','product_module_access_rules','parts_catalog','user_location_memberships','user_company_memberships','locations'])await cleanup.query(`delete from ${table} where company_id=any($1::uuid[])`,[companies]);await cleanup.query('delete from companies where id=any($1::uuid[])',[companies]);await cleanup.query('delete from user_profiles where id=any($1::uuid[])',[[ids.actor,ids.actor2,ids.namedApprover,ids.roleApprover,ids.adminNoShop,ids.officeNoShop,ids.inactive,...Object.values(custodyActors)]]);await cleanup.query('commit');}catch(error){await cleanup.query('rollback').catch(()=>{});throw error;}finally{cleanup.release();}
 }
});

test('custody assignment serializes behind the canonical case transition without returning a newer incompatible task', {skip:!enabled}, async()=>{
 const fixture=await createInventoryReuseFixture();
 const blocker=await getPool().connect();
 const base={companyId:fixture.companyId,locationId:fixture.locationId};
 const command=(action,actorId,extra={})=>({...base,action,capability:action,actorId,idempotencyKey:randomUUID(),requestHash:reuseDigest(randomUUID()),...extra});
 let transition=null;let claim=null;
 try{
  await configureInventoryReuse({...base,actorId:fixture.adminId,kind:'grant',userId:fixture.receiverId,capabilities:['receive','route'],reason:'Task assignment concurrency QA'});
  const removed=(await mutateInventoryReuse(command('remove',fixture.removerId,{usageId:fixture.usageId,reason:'Concurrency QA removal'}))).case;
  const received=(await mutateInventoryReuse(command('receive',fixture.receiverId,{caseId:removed.id,evidence:'Exact unit received for concurrency QA',expectedVersion:removed.caseVersion}))).case;
  const task=await readInventoryTask({...base,actorId:fixture.receiverId,actorRole:'office',sourceType:'removed_part_custody',sourceId:received.id});
  assert.equal(task.capability,'route');

  await blocker.query('begin');
  await blocker.query('select id from inventory_reuse_cases where company_id=$1 and id=$2 for update',[fixture.companyId,received.id]);
  transition=mutateInventoryReuse(command('release',fixture.releaseId,{caseId:received.id,decision:'hold',inspectionEvidence:'Canonical reviewer changed the route',reason:'Hold for review',expectedVersion:received.caseVersion}));
  await waitForBlockedCaseLocks(1);
  claim=mutateInventoryTaskAssignment({...base,actorId:fixture.receiverId,actorRole:'office',action:'claim',sourceType:'removed_part_custody',sourceId:received.id,sourceVersion:task.sourceVersion,expectedAssignmentVersion:0,idempotencyKey:`custody-race-${randomUUID()}`,reason:'Claim before reviewer transition'});
  await waitForBlockedCaseLocks(2);
  await blocker.query('commit');

  const transitioned=await transition;
  assert.equal(transitioned.case.status,'hold');
  await assert.rejects(claim,{code:'INVENTORY_TASK_SOURCE_STALE'});
  assert.equal((await query(`select count(*)::int count from inventory_task_assignments
    where company_id=$1 and source_type='removed_part_custody' and source_id=$2`,[fixture.companyId,received.id])).rows[0].count,0);

  const changedTask=await readInventoryTask({...base,actorId:fixture.receiverId,actorRole:'office',sourceType:'removed_part_custody',sourceId:received.id});
  assert.equal(changedTask.sourceVersion,String(transitioned.case.caseVersion));
  const changedReplayKey=`custody-race-replay-${randomUUID()}`;
  const claimed=await mutateInventoryTaskAssignment({...base,actorId:fixture.receiverId,actorRole:'office',action:'claim',sourceType:'removed_part_custody',sourceId:received.id,sourceVersion:changedTask.sourceVersion,expectedAssignmentVersion:0,idempotencyKey:changedReplayKey,reason:'Claim the current held case'});
  assert.equal(claimed.task.sourceVersion,changedTask.sourceVersion);
  assert.deepEqual(await mutateInventoryTaskAssignment({...base,actorId:fixture.receiverId,actorRole:'office',action:'claim',sourceType:'removed_part_custody',sourceId:received.id,sourceVersion:changedTask.sourceVersion,expectedAssignmentVersion:0,idempotencyKey:changedReplayKey,reason:'Claim the current held case'}),claimed);
 }
 finally{
  await blocker.query('rollback').catch(()=>{});blocker.release();
  await Promise.allSettled([transition,claim].filter(Boolean));
  await query('delete from inventory_task_assignment_commands where company_id=$1',[fixture.companyId]);
  await query('delete from inventory_task_assignment_events where company_id=$1',[fixture.companyId]);
  await query('delete from inventory_task_assignments where company_id=$1',[fixture.companyId]);
  await fixture.cleanup();
 }
});
