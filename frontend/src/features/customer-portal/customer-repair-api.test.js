import assert from 'node:assert/strict';
import test from 'node:test';
import { createRepairLink, emailRepairLink, loadRepairPortal, repairGrantFromLocation, repairHeaders, respondRepairEstimate, sendStaffRepairChat } from './customer-repair-api.js';

test('repair access secret is fragment only and requests use a dedicated header',()=>{
 assert.equal(repairGrantFromLocation({hash:'#customerRepair=secret',search:'?customerRepair=wrong'}),'secret');
 assert.equal(repairGrantFromLocation({hash:'',search:'?customerRepair=wrong'}),'');
 assert.deepEqual(repairHeaders('secret'),{'x-customer-repair-grant':'secret'});
 assert.throws(()=>repairHeaders(''),/unavailable/);
});
test('repair link, email, response and chat use exact scoped contracts',async()=>{
 const before=globalThis.fetch;const calls=[];
 globalThis.fetch=async(path,options)=>{calls.push({path,...options});return{ok:true,json:async()=>({})};};
 try{
  await createRepairLink({companyId:'company',locationId:'location',workorderId:'work/order',idempotencyKey:'same-key',expiresAt:'date'});
  assert.equal(calls[0].path,'/api/customer-repair/workorders/work%2Forder/links');assert.equal(JSON.parse(calls[0].body).workorderId,undefined);
  await emailRepairLink({grantId:'grant',workorderId:'work',companyId:'company',locationId:'location',recipientEmail:'test@example.com',rawToken:'secret',idempotencyKey:'send-key'});assert.equal(calls[1].path,'/api/customer-repair/links/grant/email');assert.equal(JSON.parse(calls[1].body).idempotencyKey,'send-key');
  await loadRepairPortal('secret');assert.equal(calls[2].headers['x-customer-repair-grant'],'secret');assert.ok(!calls[2].path.includes('secret'));
  await respondRepairEstimate('secret',{revisionId:'revision',response:'accepted',idempotencyKey:'response-key'});assert.equal(JSON.parse(calls[3].body).revisionId,'revision');
  await sendStaffRepairChat({companyId:'company',locationId:'location',workorderId:'work',body:'hello',idempotencyKey:'message-key'});assert.equal(calls[4].path,'/api/customer-repair/workorders/work/chat');assert.equal(JSON.parse(calls[4].body).companyId,'company');
 }finally{globalThis.fetch=before;}
});
