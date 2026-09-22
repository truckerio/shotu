import test from 'node:test';
import assert from 'node:assert/strict';
import { sendInventoryCommand,inventoryCommandCanBeEdited } from './inventory-command.js';
const request={locationId:'shop',idempotencyKey:'saved-key',action:'receive_transfer'};
test('Recovering a committed action does not repeat the write',async()=>{
 const calls=[];
 const result=await sendInventoryCommand({request,recover:true,url:'/write'},async(url,options)=>{calls.push({url,options});return {status:'posted',task:{id:'original'}};});
 assert.equal(result.task.id,'original');assert.equal(calls.length,1);assert.equal(calls[0].options,undefined);
});
test('An absent action can retry only its original payload',async()=>{
 const calls=[];
 await sendInventoryCommand({request,recover:true,url:'/write'},async(url,options)=>{calls.push({url,options});return calls.length===1?{status:'not_found'}:{task:{id:'posted'}};});
 assert.equal(calls.length,2);assert.deepEqual(JSON.parse(calls[1].options.body),request);
});
test('Unavailable recovery never writes and conflicts preserve saved commands',async()=>{
 let calls=0;await assert.rejects(sendInventoryCommand({request,recover:true,url:'/write'},async()=>{calls++;return {status:'unknown'};}));assert.equal(calls,1);
 assert.equal(inventoryCommandCanBeEdited({status:409,message:'This command was already used with different details.'}),false);
 assert.equal(inventoryCommandCanBeEdited({status:409,message:'Stock changed.'}),true);
 assert.equal(inventoryCommandCanBeEdited({status:503,message:'Connection lost'}),false);
});
