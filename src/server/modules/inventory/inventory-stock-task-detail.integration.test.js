import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { closePool, getPool, query } from '../../db/pool.js';
import { getStockTask, getStockTasks } from './inventory-stock-tasks.service.js';

const enabled=process.env.RUN_POSTGRES_INTEGRATION==='1';
after(async()=>{if(enabled)await closePool();});
const notFound=(error)=>error?.code==='inventory_not_found'&&error?.statusCode===404;

test('exact stock-task read finds off-page work and enforces tenant, shop and kind without writes',{skip:!enabled},async()=>{
 const suffix=randomUUID().replaceAll('-','');
 const ids=Object.fromEntries(['company','otherCompany','source','destination','unrelated','inactive','otherLocation','actor','part','otherPart','target','transfer','inactiveTask','otherTask'].map((key)=>[key,randomUUID()]));
 const damageIds=Array.from({length:26},()=>randomUUID());
 const context={actor:{id:ids.actor,role:'office'},companyIds:new Set([ids.company]),locationIds:new Set([ids.source,ids.destination,ids.unrelated,ids.inactive]),companyRoles:new Map([[ids.company,'office']])};
 const client=await getPool().connect();
 try{
  await client.query('begin');
  await client.query("insert into companies(id,slug,name) values($1,$2,'Exact task company'),($3,$4,'Other exact task company')",[ids.company,`exact-${suffix}`,ids.otherCompany,`other-exact-${suffix}`]);
  await client.query("insert into locations(id,company_id,name,active) values($1,$6,'Source',true),($2,$6,'Destination',true),($3,$6,'Unrelated',true),($4,$6,'Inactive',false),($5,$7,'Other tenant',true)",[ids.source,ids.destination,ids.unrelated,ids.inactive,ids.otherLocation,ids.company,ids.otherCompany]);
  await client.query("insert into user_profiles(id,display_name,active) values($1,'Exact task actor',true)",[ids.actor]);
  await client.query("insert into user_company_memberships(user_id,company_id,role,active) values($1,$2,'office',true)",[ids.actor,ids.company]);
  for(const locationId of [ids.source,ids.destination,ids.unrelated,ids.inactive])await client.query('insert into user_location_memberships(user_id,company_id,location_id,active) values($1,$2,$3,true)',[ids.actor,ids.company,locationId]);
  await client.query(`insert into parts_catalog(id,company_id,normalized_part_number,part_number,description,uom_code,tracking_mode) values
    ($1,$3,$4,$5,'Exact detail part','ea','quantity'),($2,$6,$7,$8,'Other exact detail part','ea','quantity')`,
  [ids.part,ids.otherPart,ids.company,`EXACT${suffix}`,`EXACT-${suffix}`,ids.otherCompany,`OTHER${suffix}`,`OTHER-${suffix}`]);
  for(let index=0;index<damageIds.length;index++)await client.query(`insert into inventory_stock_tasks(id,company_id,location_id,catalog_part_id,kind,status,quantity,uom_code,reason,holder,created_by,created_at)
    values($1,$2,$3,$4,'damage','inspection',1,'ea','Page fixture','QA',$5,now()-($6::text||' seconds')::interval)`,[damageIds[index],ids.company,ids.source,ids.part,ids.actor,index]);
  await client.query(`insert into inventory_stock_tasks(id,company_id,location_id,catalog_part_id,kind,status,quantity,uom_code,reason,holder,created_by,created_at)
    values($1,$2,$3,$4,'damage','released',1,'ea','Off-page closed fixture','QA',$5,now()-interval '1 day')`,[ids.target,ids.company,ids.source,ids.part,ids.actor]);
  await client.query(`insert into inventory_stock_tasks(id,company_id,location_id,destination_id,catalog_part_id,kind,status,quantity,uom_code,reason,holder,created_by)
    values($1,$2,$3,$4,$5,'transfer','in_transit',1,'ea','Destination fixture','Carrier',$6)`,[ids.transfer,ids.company,ids.source,ids.destination,ids.part,ids.actor]);
  await client.query(`insert into inventory_stock_tasks(id,company_id,location_id,catalog_part_id,kind,status,quantity,uom_code,reason,holder,created_by)
    values($1,$2,$3,$4,'damage','inspection',1,'ea','Inactive fixture','QA',$5)`,[ids.inactiveTask,ids.company,ids.inactive,ids.part,ids.actor]);
  await client.query(`insert into inventory_stock_tasks(id,company_id,location_id,catalog_part_id,kind,status,quantity,uom_code,reason,holder,created_by)
    values($1,$2,$3,$4,'damage','inspection',1,'ea','Other tenant fixture','QA',$5)`,[ids.otherTask,ids.otherCompany,ids.otherLocation,ids.otherPart,ids.actor]);
  await client.query('commit');
 }catch(error){await client.query('rollback').catch(()=>{});throw error;}finally{client.release();}
 try{
  const before=(await query(`select
    (select count(*)::int from inventory_stock_tasks) tasks,
    (select count(*)::int from inventory_stock_task_events) events,
    (select count(*)::int from inventory_stock_movements) movements,
    (select count(*)::int from inventory_workflow_commands) commands`)).rows[0];
  const page=await getStockTasks(new URLSearchParams({locationId:ids.source,kind:'damage',page:'1'}),context);
  assert.equal(page.items.length,25);assert.equal(page.hasMore,true);assert.equal(page.items.some((task)=>task.id===ids.target),false);
  const exact=await getStockTask(ids.target,new URLSearchParams({locationId:ids.source,kind:'damage'}),context);
  assert.equal(exact.task.id,ids.target);assert.equal(exact.task.kind,'damage');assert.equal(exact.task.status,'released');assert.deepEqual(exact.task.units,[]);assert.deepEqual(exact.task.events,[]);
  const transferAtSource=await getStockTask(ids.transfer,new URLSearchParams({locationId:ids.source,kind:'transfer'}),context);
  const transferAtDestination=await getStockTask(ids.transfer,new URLSearchParams({locationId:ids.destination,kind:'transfer'}),context);
  assert.equal(transferAtSource.task.id,ids.transfer);assert.equal(transferAtDestination.task.id,ids.transfer);
  await assert.rejects(()=>getStockTask(ids.target,new URLSearchParams({locationId:ids.source,kind:'transfer'}),context),notFound);
  await assert.rejects(()=>getStockTask(ids.transfer,new URLSearchParams({locationId:ids.unrelated,kind:'transfer'}),context),notFound);
  await assert.rejects(()=>getStockTask(ids.inactiveTask,new URLSearchParams({locationId:ids.inactive,kind:'damage'}),context),notFound);
  await assert.rejects(()=>getStockTask(ids.otherTask,new URLSearchParams({locationId:ids.otherLocation,kind:'damage'}),context),notFound);
  const after=(await query(`select
    (select count(*)::int from inventory_stock_tasks) tasks,
    (select count(*)::int from inventory_stock_task_events) events,
    (select count(*)::int from inventory_stock_movements) movements,
    (select count(*)::int from inventory_workflow_commands) commands`)).rows[0];
  assert.deepEqual(after,before,'exact and paged reads must not mutate task or stock evidence');
 }finally{
  const cleanup=await getPool().connect();try{await cleanup.query('begin');await cleanup.query("set local session_replication_role='replica'");for(const table of ['inventory_stock_task_units','inventory_stock_task_events','inventory_stock_tasks','parts_catalog','user_location_memberships','user_company_memberships','locations'])await cleanup.query(`delete from ${table} where company_id=any($1::uuid[])`,[[ids.company,ids.otherCompany]]);await cleanup.query('delete from companies where id=any($1::uuid[])',[[ids.company,ids.otherCompany]]);await cleanup.query('delete from user_profiles where id=$1',[ids.actor]);await cleanup.query('commit');}catch(error){await cleanup.query('rollback').catch(()=>{});throw error;}finally{cleanup.release();}
 }
});
