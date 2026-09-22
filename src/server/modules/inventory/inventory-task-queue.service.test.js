import assert from 'node:assert/strict';
import test from 'node:test';
import { getInventoryTaskQueue, postInventoryTaskAssignment } from './inventory-task-queue.service.js';

const companyId='11111111-1111-4111-8111-111111111111';
const locationId='22222222-2222-4222-8222-222222222222';
const actorId='33333333-3333-4333-8333-333333333333';
const sourceId='44444444-4444-4444-8444-444444444444';
const context={actor:{id:actorId,role:'office'},companyIds:new Set([companyId]),locationIds:new Set([locationId]),companyRoles:new Map([[companyId,'office']])};

test('task queue forwards actor-aware My work scope without mutation',async()=>{
 let received;
 const deepLink=`/?view=inventory&adminView=inventory&inventorySection=tasks&taskOwner=damage&taskId=${sourceId}&taskLocation=${locationId}`;
 const result=await getInventoryTaskQueue(new URLSearchParams(`locationId=${locationId}`),context,{
  resolveInventoryLocationScope:async()=>({companyId,locationId,companyIds:[companyId],locationIds:[locationId],effectiveRole:'office'}),
  listInventoryTaskQueue:async(input)=>{received=input;return{items:[{id:`damage_inspection:${sourceId}`,deepLink,actionTarget:{sourceType:'damage_inspection',sourceId,locationId,deepLink}}],page:1,pageSize:25,hasMore:false};},
 });
 assert.equal(received.view,'my_work');assert.equal(received.actorId,actorId);assert.deepEqual(received.rolesByCompany,{[companyId]:'office'});
 assert.equal(result.items[0].deepLink,deepLink);assert.equal(result.items[0].actionTarget.deepLink,deepLink);
});

test('all-shop queue preserves each company role instead of promoting one global role',async()=>{
 const adminCompany='55555555-5555-4555-8555-555555555555';
 const officeCompany='66666666-6666-4666-8666-666666666666';
 const adminLocation='77777777-7777-4777-8777-777777777777';
 const officeLocation='88888888-8888-4888-8888-888888888888';
 const mixed={actor:{id:actorId,role:'admin'},companyIds:new Set([adminCompany,officeCompany]),locationIds:new Set([officeLocation]),companyRoles:new Map([[adminCompany,'admin'],[officeCompany,'office']])};
 let received;
 await getInventoryTaskQueue(new URLSearchParams('view=my_work'),mixed,{
  query:async()=>({rows:[{id:adminLocation,company_id:adminCompany},{id:officeLocation,company_id:officeCompany}]}),
  listInventoryTaskQueue:async(input)=>(received=input,{items:[],page:1,pageSize:25,hasMore:false}),
 });
 assert.deepEqual(received.companyIds,[adminCompany,officeCompany]);
 assert.deepEqual(received.locationIds,[adminLocation,officeLocation]);
 assert.deepEqual(received.rolesByCompany,{[adminCompany]:'admin',[officeCompany]:'office'});
 assert.equal('actorRole' in received,false);
});

test('assignment commands preserve source and assignment versions',async()=>{
 let received;
 const body={action:'claim',locationId,sourceType:'position_recount',sourceId,sourceVersion:'3',expectedAssignmentVersion:0,idempotencyKey:'claim-command-001',reason:'I will recount this bin'};
 const result=await postInventoryTaskAssignment(body,context,{
  resolveInventoryLocationScope:async()=>({companyId,locationId,actorId,effectiveRole:'office'}),
  mutateInventoryTaskAssignment:async(input)=>{received=input;return{task:{id:`position_recount:${sourceId}`}};},
 });
 assert.deepEqual({...received,companyId:undefined,actorId:undefined,actorRole:undefined},{...body,companyId:undefined,actorId:undefined,actorRole:undefined});
 assert.equal(received.companyId,companyId);assert.equal(received.actorId,actorId);assert.equal(received.actorRole,'office');
 assert.equal(result.task.id,`position_recount:${sourceId}`);
});

test('assignment payload rejects raw backend source kinds and short replay keys',async()=>{
 await assert.rejects(()=>postInventoryTaskAssignment({action:'claim',locationId,sourceType:'damage',sourceId,sourceVersion:'1',expectedAssignmentVersion:0,idempotencyKey:'short',reason:'Take it'},context),{name:'ZodError'});
});
